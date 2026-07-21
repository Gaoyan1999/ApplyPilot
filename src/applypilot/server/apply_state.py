"""In-memory state for a single-job, web-triggered auto-submit run.

Mirrors search_state.py's shape (lock + dict + background thread), but
scoped to one job at a time rather than a whole pipeline run. Live
per-action progress (status/last_action/actions) is read straight from
apply.dashboard's WorkerState -- already headless (a plain dataclass, no
Rich dependency), so there's no separate progress tracking to maintain here.

The actual outcome (applied vs. failed, and why) lives in the jobs table,
written by launcher.mark_result() -- callers should re-fetch the job (GET
/api/jobs/{url}) once `running` flips back to False rather than trusting
anything in this module for the final result. This module only tracks
enough to drive the "is something running, and what's it doing right now"
poll.

Single-flight only -- one auto-submit run at a time, same simplification
search_state.py already makes for the discover/enrich/score pipeline.
"""

import logging
import threading
from datetime import datetime, timezone

from applypilot.apply import dashboard, launcher
from applypilot.database import get_connection

log = logging.getLogger(__name__)

# Web-triggered runs always use worker slot 0 -- single-flight means there's
# never more than one in-flight run, so a fixed slot is enough.
_WORKER_ID = 0

_lock = threading.Lock()
_state: dict = {
    "running": False,
    "url": None,
    "started_at": None,
    "finished_at": None,
    "error": None,
}


def get_status() -> dict:
    with _lock:
        state = dict(_state)
    ws = dashboard.get_state(_WORKER_ID)
    state["status"] = ws.status if ws else None
    state["last_action"] = ws.last_action if ws else None
    state["actions"] = ws.actions if ws else 0
    state["transcript"] = list(ws.transcript) if ws else []
    return state


def start_apply(url: str, model: str = "haiku") -> bool:
    """Start a background auto-submit run for one job. Returns False if a
    run is already in progress (single-flight guard)."""
    with _lock:
        if _state["running"]:
            return False
        _state.update(
            running=True,
            url=url,
            started_at=datetime.now(timezone.utc).isoformat(),
            finished_at=None,
            error=None,
        )

    thread = threading.Thread(target=_run, args=(url, model), daemon=True)
    thread.start()
    return True


def _describe_no_op(url: str) -> str:
    """worker_loop() returns (0, 0) both when it genuinely applied to
    nothing AND when acquire_job() couldn't claim the row at all (already
    in_progress, already applied, exhausted attempts, or a manual-ATS site
    acquire_job silently marks apply_status='manual'). Re-read the row to
    give the user a specific reason instead of a silent no-op."""
    conn = get_connection()
    row = conn.execute(
        "SELECT apply_status, apply_error, applied_at FROM jobs WHERE url = ?",
        (url,),
    ).fetchone()
    if row is None:
        return "Job not found."
    if row["applied_at"]:
        return "Already applied."
    if row["apply_status"] == "manual":
        return "This site isn't supported for auto-submit (manual application required)."
    if row["apply_status"] == "in_progress":
        return "Already locked by another run that didn't finish cleanly."
    if row["apply_status"] == "failed" and row["apply_error"]:
        return f"Already marked failed: {row['apply_error']}"
    return "Could not start -- job may not be ready for auto-apply yet."


def _run(url: str, model: str) -> None:
    dashboard.init_worker(_WORKER_ID)
    # A previous run's second-Ctrl+C-equivalent (cancel()) may have left this
    # set; main() clears it for the same reason on every CLI invocation.
    launcher._stop_event.clear()
    try:
        applied, failed = launcher.worker_loop(
            worker_id=_WORKER_ID,
            limit=1,
            target_url=url,
            min_score=0,
            headless=False,
            model=model,
            dry_run=False,
        )
        if applied == 0 and failed == 0:
            with _lock:
                _state["error"] = _describe_no_op(url)
    except Exception as e:
        log.error("Web auto-submit failed for %s: %s", url, e, exc_info=True)
        with _lock:
            _state["error"] = str(e)
    finally:
        with _lock:
            _state["running"] = False
            _state["finished_at"] = datetime.now(timezone.utc).isoformat()


def cancel() -> bool:
    """Best-effort cancel of the in-flight run -- mirrors launcher.py's
    second-Ctrl+C handling: kill the tracked claude subprocess, which makes
    run_job() return "skipped" and worker_loop()'s own cleanup tear down
    Chrome for this worker. Returns whether a run was actually in progress."""
    with _lock:
        was_running = _state["running"]

    launcher._stop_event.set()
    with launcher._claude_lock:
        for _wid, proc in list(launcher._claude_procs.items()):
            if proc.poll() is None:
                launcher._kill_process_tree(proc.pid)

    return was_running
