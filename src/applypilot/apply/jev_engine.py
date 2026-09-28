"""Fast-path auto-apply engine using the vendored jev agent (apply/jev/).

One DOM snapshot -> one TypeSafe API call per decision, instead of a full
Claude Code turn per click. `run_job_jev()` has the same return contract as
launcher.run_job() -- 'ready_for_review', 'blocked:<reason>' -- so it plugs
into worker_loop()'s existing dispatch with no changes to mark_result() or
the DB/API layers already built for those two states.

Design principle: mistakes here are OK, because nothing gets submitted
automatically either way (see prompt.py -- the agent always stops before
Submit) and the user reviews before clicking it themselves. So almost every
way this can get stuck maps to 'blocked' -- leave the tab open, bring it to
the front, let the user finish it by hand (including solving a captcha
CapSolver couldn't) -- rather than trying to be clever about recovering.
The ONLY case that raises (for worker_loop to catch and fall back to the
full Claude engine) is a genuine infrastructure failure with no partially-
filled page worth showing anyone: the browser-harness daemon or the
TypeSafe API being unreachable.

Jev's Agent deliberately runs in a *background* tab (not the browser's
visible tab, so it doesn't steal focus mid-run) -- so when handing off to
the user, this module explicitly activates that tab via
`Target.activateTarget`, otherwise they'd have no way to find it.
"""

import logging
import os
import time
from pathlib import Path

from browser_harness.helpers import cdp

from applypilot import config
from applypilot.apply.captcha import detect as captcha_detect, solve as captcha_solve
from applypilot.apply.jev import Agent
from applypilot.apply.jev.browser import StalePage
from applypilot.apply.jev.model import set_applicant_context

log = logging.getLogger(__name__)

MAX_STEPS = 60


def _load_resume_text(resume_pdf_path: Path) -> str:
    txt_path = Path(resume_pdf_path).with_suffix(".txt")
    return txt_path.read_text(encoding="utf-8") if txt_path.exists() else ""


def _has_file_input(agent: Agent) -> bool:
    return bool(agent.browser.evaluate("!!document.querySelector('input[type=file]')"))


def _upload_resume(agent: Agent, resume_pdf_path: Path) -> bool:
    """DOM.setFileInputFiles on the first visible file input -- deterministic,
    no LLM. Jev's own snapshot filters file inputs out of the action space
    entirely, so this must happen as a side-call, never through the agent's
    own decision loop.

    Known gap: only handles a single resume upload, not a separate cover
    letter field -- acceptable given the user review step catches this."""
    session = agent.browser.session
    doc = cdp("DOM.getDocument", session_id=session, depth=-1)
    node_id = cdp(
        "DOM.querySelector",
        session_id=session,
        nodeId=doc["root"]["nodeId"],
        selector="input[type=file]",
    )["nodeId"]
    if not node_id:
        return False
    cdp("DOM.setFileInputFiles", session_id=session, files=[str(resume_pdf_path)], nodeId=node_id)
    return True


def _activate_tab(agent: Agent) -> None:
    """Bring Jev's background tab to the front -- it's invisible by design
    until now (see module docstring)."""
    try:
        cdp("Target.activateTarget", targetId=agent.browser.target)
    except Exception:
        log.warning("Could not activate jev's tab for review", exc_info=True)


def run_job_jev(job: dict, port: int, resume_pdf_path: Path, worker_id: int = 0,
                model: str = "sonnet") -> tuple[str, int]:
    """Attempt to fill `job`'s application via the fast jev engine.

    Args:
        job: Job dict (same shape launcher.acquire_job() returns).
        port: CDP port of a Chrome instance the caller already launched
            (see launcher.launch_chrome()) -- this does NOT launch its own
            Chrome, it attaches to that one via BU_CDP_URL.
        resume_pdf_path: Already-resolved resume PDF (see
            apply.resume_source.resolve_resume).
        worker_id: Unused by jev itself (no per-worker state here beyond the
            Chrome connection) -- kept for call-site parity with run_job().
        model: Unused -- jev's text step uses applypilot.llm's own configured
            provider, independent of the Claude CLI model choice. Kept for
            call-site parity with run_job().

    Returns:
        (status_string, duration_ms), same contract as launcher.run_job():
        'ready_for_review', or 'blocked:<reason>'.

    Raises:
        Exception: on a genuine infrastructure failure (daemon/API
            unreachable) with no useful partial state to show the user --
            caller should fall back to run_job() (the Claude engine).
    """
    start = time.time()
    os.environ["BU_CDP_URL"] = f"http://127.0.0.1:{port}"

    profile = config.load_profile()
    resume_text = _load_resume_text(resume_pdf_path)
    set_applicant_context(profile, resume_text, job)

    capsolver_key = os.environ.get("CAPSOLVER_API_KEY", "")

    goal = (
        f"Fill out this entire job application for '{job.get('title', 'this role')}' "
        "completely and accurately using the applicant's real profile and resume "
        "information (already provided to you). Answer any screening questions "
        "reasonably from that same information. Do NOT click the final Submit/Apply "
        "button -- stop once every required field is filled and correct."
    )

    uploaded = False
    agent = Agent(job.get("application_url") or job["url"], goal)
    try:
        for step in range(1, MAX_STEPS + 1):
            detection = captcha_detect(agent.browser.evaluate)
            if detection:
                if capsolver_key and captcha_solve(agent.browser.evaluate, detection, capsolver_key):
                    log.info("Auto-solved %s captcha for %s", detection["type"], job["url"])
                    continue
                _activate_tab(agent)
                duration_ms = int((time.time() - start) * 1000)
                return f"blocked:captcha_{detection['type']}", duration_ms

            if not uploaded and _has_file_input(agent):
                uploaded = _upload_resume(agent, resume_pdf_path)

            try:
                state = agent.command("predict")
            except StalePage:
                continue  # command('predict') internally re-observes; retry next loop iteration

            choice = state["decision"]["choice"]

            if choice in ("DONE", "BLOCKED"):
                try:
                    state = agent.command("act", {"fingerprint": state["page"]["fingerprint"]})
                except StalePage:
                    continue
                duration_ms = int((time.time() - start) * 1000)
                if state["status"] == "done":
                    _activate_tab(agent)
                    return "ready_for_review", duration_ms
                _activate_tab(agent)
                return "blocked:stuck", duration_ms

            try:
                agent.command("act", {"fingerprint": state["page"]["fingerprint"]})
            except StalePage:
                continue
            except ValueError as e:
                # field_text() raised: it couldn't determine a value from the
                # applicant's real profile/resume -- exactly the "needs the
                # applicant's own judgment" case, same spirit as prompt.py's
                # RESULT:BLOCKED for the Claude engine.
                log.info("jev needs input on %s: %s", job["url"], e)
                _activate_tab(agent)
                duration_ms = int((time.time() - start) * 1000)
                return "blocked:needs_input", duration_ms

        _activate_tab(agent)
        duration_ms = int((time.time() - start) * 1000)
        return "blocked:max_steps_exceeded", duration_ms
    except Exception:
        # Genuine infrastructure failure (daemon/TypeSafe unreachable, etc.) --
        # nothing useful to show the user, so close this tab and let the
        # caller fall back to a fresh Claude-engine attempt.
        agent.close()
        raise
