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

import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path

from browser_harness.helpers import cdp

from applypilot import config
from applypilot.apply.captcha import detect as captcha_detect, solve as captcha_solve
from applypilot.apply.dashboard import append_transcript, get_state, update_state
from applypilot.apply.jev import Agent
from applypilot.apply.jev import agent as jev_agent_module
from applypilot.apply.jev.browser import StalePage
from applypilot.apply.jev.model import set_applicant_context

log = logging.getLogger(__name__)

MAX_STEPS = 60

# A freshly-opened modal/page can take a second or two to finish rendering its
# actual fields (LinkedIn's Easy Apply "Contact info" step, for example, often
# shows just the modal shell + close button at first). TypeSafe's own rules
# say to WAIT when a needed control isn't there yet, but the fast/cheap model
# sometimes picks BLOCKED (give up) instead, even at low confidence -- so give
# early low-confidence BLOCKED calls a few short retries before honoring them
# as final, rather than quitting on the very first one.
BLOCKED_GRACE_RETRIES = 3
BLOCKED_GRACE_SLEEP_S = 1.5


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


def _scroll_for_more(agent: Agent) -> bool:
    """Scroll one step down before honoring DONE. The snapshot only shows
    elements inside the viewport (see jev/snapshot.js), so on a long
    single-page form (e.g. Lever) the model sees every *visible* field filled
    and says DONE while the rest of the form is still below the fold.

    Returns True if the scroll brought new content into view (keep going),
    False if there's nothing more below or the page didn't change (DONE is
    real)."""
    page = agent.state["page"]
    scroll = next((a for a in page["actions"] if a["kind"] == "scroll" and a["delta"] > 0), None)
    if not scroll:
        return False
    agent.browser.act(scroll, page)
    new_page = agent.browser.observe(screenshot=agent.screenshots)
    # The DONE decision was never acted on -- drop it so the next predict()
    # starts clean from the scrolled page.
    agent.state.update(page=new_page, decision=None, status="ready")
    return new_page["fingerprint"] != page["fingerprint"]


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
    last_event = start  # for per-step deltas, same convention as launcher.run_job()
    os.environ["BU_CDP_URL"] = f"http://127.0.0.1:{port}"

    # browser_harness's daemon (apply/jev/browser.py's ensure_daemon()) is a
    # process-wide singleton, named "default" unless BU_NAME is set. It only
    # reads BU_CDP_URL the first time it ever starts -- every later call just
    # checks "is the daemon alive" and, if its *original* CDP connection is
    # still reachable (e.g. Chrome from an earlier ready_for_review/blocked
    # job that's deliberately left open, or any other browser-harness daemon
    # already running on this machine), silently keeps using that stale
    # attachment instead of this job's freshly-launched Chrome on `port` --
    # symptom: a blank new Chrome window (this job's, unused) plus a new tab
    # in whatever window the daemon was already attached to, which the agent
    # then drives blind. Force a fresh daemon so it re-reads BU_CDP_URL.
    # NOTE: not safe against a concurrent jev run on another worker -- this
    # will yank that job's live connection out from under it. Acceptable for
    # now since only one web_apply_worker actually runs jev-heavy traffic in
    # practice; revisit (give each worker its own BU_NAME) if that changes.
    from browser_harness import admin as bh_admin
    bh_admin.restart_daemon()

    worker_log = config.LOG_DIR / f"worker-{worker_id}.log"
    ts_header = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_header = (
        f"\n{'=' * 60}\n"
        f"[{ts_header}] {job['title']} @ {job.get('site', '')}\n"
        f"URL: {job.get('application_url') or job['url']}\n"
        f"Score: {job.get('fit_score', 'N/A')}/10\n"
        f"Engine: jev (fast path -- TypeSafe API, one call per DOM decision)\n"
        f"{'=' * 60}\n"
    )
    with open(worker_log, "a", encoding="utf-8") as lf:
        lf.write(log_header)
    append_transcript(worker_id, "Engine: jev (fast path -- TypeSafe API, one call per DOM decision)")

    def _log_step(desc: str) -> None:
        nonlocal last_event
        now = time.time()
        step_s = now - last_event
        last_event = now
        line = f"{desc} ({step_s:.1f}s)"
        with open(worker_log, "a", encoding="utf-8") as lf:
            lf.write(f"  >> {line}\n")
        append_transcript(worker_id, f">> {line}")
        ws = get_state(worker_id)
        cur_actions = ws.actions if ws else 0
        update_state(worker_id, actions=cur_actions + 1, last_action=line[:35])

    def _finish(status: str) -> tuple[str, int]:
        duration_ms = int((time.time() - start) * 1000)
        with open(worker_log, "a", encoding="utf-8") as lf:
            lf.write(f"  => {status} ({duration_ms}ms total, engine=jev)\n")
        return status, duration_ms

    # Full input/output for every model call this job makes (TypeSafe's
    # click/select/scroll decisions AND the text-fill LLM calls), one JSON
    # object per line -- for debugging exactly what jev saw and decided,
    # separate from the compact human-readable summary in worker_log above.
    debug_log_path = config.LOG_DIR / f"jev-debug-worker-{worker_id}.jsonl"

    def _log_api_call(kind: str, input_data, output_data, error: str | None = None) -> None:
        record = {
            "ts": datetime.now().isoformat(),
            "job_url": job.get("application_url") or job["url"],
            "kind": kind,
            "input": input_data,
            "output": output_data,
        }
        if error:
            record["error"] = error
        try:
            with open(debug_log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, default=str) + "\n")
        except Exception:
            log.debug("jev debug logging failed", exc_info=True)

    # field_text() is only reachable from inside jev_agent_module's own `act`
    # handling -- it imported the name at module load time (`from .model
    # import field_text`), so there's no parameter or return value in the
    # public Agent/command() API that exposes its input/output. Wrapping the
    # name in that module is the only way to see both without duplicating
    # jev's internal field_context()/action-lookup logic here.
    _original_field_text = jev_agent_module.field_text

    def _debug_field_text(context):
        try:
            text, helper = _original_field_text(context)
        except Exception as e:
            _log_api_call("field_text", context, None, error=str(e))
            raise
        _log_api_call("field_text", context, {"text": text, **helper})
        return text, helper

    jev_agent_module.field_text = _debug_field_text

    profile = config.load_profile()
    resume_text = _load_resume_text(resume_pdf_path)
    set_applicant_context(profile, resume_text, job)

    capsolver_key = os.environ.get("CAPSOLVER_API_KEY", "")

    goal = (
        f"Fill out this entire job application for '{job.get('title', 'this role')}' "
        "completely and accurately using the applicant's real profile and resume "
        "information (already provided to you). Answer any screening questions "
        "reasonably from that same information. Do NOT click the final Submit/Apply "
        "button -- stop once every required field is filled and correct. You only "
        "see the part of the page currently on screen: once every visible field "
        "is filled, SCROLL_DOWN to look for more fields before choosing DONE. "
        "Only choose DONE when scrolling down shows nothing new. This is "
        "often a multi-page/multi-step form: if every required field on the CURRENT "
        "page already has a value and nothing is missing, click Next/Continue "
        "immediately -- don't stop just because you're unsure a previously-filled "
        "value (e.g. an auto-imported work experience entry) is ideal. Getting the "
        "form filled out for the applicant's own final review matters more than "
        "judging whether earlier content is perfect."
    )

    uploaded = False
    blocked_grace_used = 0
    agent = Agent(job.get("application_url") or job["url"], goal)
    try:
        for step in range(1, MAX_STEPS + 1):
            detection = captcha_detect(agent.browser.evaluate)
            if detection:
                if capsolver_key and captcha_solve(agent.browser.evaluate, detection, capsolver_key):
                    log.info("Auto-solved %s captcha for %s", detection["type"], job["url"])
                    _log_step(f"captcha_solve {detection['type']}")
                    continue
                _activate_tab(agent)
                return _finish(f"blocked:captcha_{detection['type']}")

            if not uploaded and _has_file_input(agent):
                uploaded = _upload_resume(agent, resume_pdf_path)
                _log_step("upload_resume")

            try:
                state = agent.command("predict")
            except StalePage:
                continue  # command('predict') internally re-observes; retry next loop iteration

            decision = state["decision"]
            choice = decision["choice"]
            _log_api_call(
                "typesafe_decision",
                decision.get("request"),
                {
                    "choice": choice,
                    "operation": decision.get("operation"),
                    "target": decision.get("target"),
                    "confidence": decision.get("confidence"),
                    "raw_answers": decision.get("raw_answers"),
                    "model": decision.get("model"),
                    "usage": decision.get("usage"),
                    "latency_ms": decision.get("latency_ms"),
                },
            )
            # Surface *what* was clicked/filled/etc, not just its opaque index --
            # elements come from the request we sent TypeSafe (decision["request"]),
            # matched by the target index it chose (decision["target"]). This is
            # what actually shows a misclassified field (e.g. a text input only
            # offered as CLICK, never TYPE_TEXT) instead of just "CLICK -> e16".
            target_index = decision.get("target")
            elements = decision.get("request", {}).get("state", {}).get("elements", [])
            element = next((e for e in elements if e.get("index") == target_index), None)
            element_desc = (
                f" [{element.get('role', '?')} \"{element.get('label', '?')[:40]}\", "
                f"offers: {element.get('operations', [])}]"
                if element else ""
            )
            _log_step(
                f"{decision.get('operation', choice)} -> {choice}{element_desc} "
                f"(model: {decision.get('model', 'jev')}, latency {decision.get('latency_ms', 0)}ms)"
            )

            if choice == "BLOCKED" and blocked_grace_used < BLOCKED_GRACE_RETRIES:
                blocked_grace_used += 1
                _log_step(
                    f"grace-wait before honoring BLOCKED ({blocked_grace_used}/{BLOCKED_GRACE_RETRIES}, "
                    f"confidence {decision.get('confidence', 0):.2f})"
                )
                time.sleep(BLOCKED_GRACE_SLEEP_S)
                continue
            if choice != "BLOCKED":
                blocked_grace_used = 0

            if choice == "DONE":
                try:
                    scrolled = _scroll_for_more(agent)
                except StalePage:
                    continue
                if scrolled:
                    _log_step("DONE deferred: scrolled down to check for more fields")
                    continue

            if choice in ("DONE", "BLOCKED"):
                try:
                    state = agent.command("act", {"fingerprint": state["page"]["fingerprint"]})
                except StalePage:
                    continue
                if state["status"] == "done":
                    _activate_tab(agent)
                    return _finish("ready_for_review")
                _activate_tab(agent)
                return _finish("blocked:stuck")

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
                return _finish("blocked:needs_input")

        _activate_tab(agent)
        return _finish("blocked:max_steps_exceeded")
    except Exception:
        # Genuine infrastructure failure (daemon/TypeSafe unreachable, etc.) --
        # nothing useful to show the user, so close this tab and let the
        # caller fall back to a fresh Claude-engine attempt.
        agent.close()
        raise
    finally:
        jev_agent_module.field_text = _original_field_text
