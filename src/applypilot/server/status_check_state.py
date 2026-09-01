"""In-memory state for a web-triggered "check job status" scan.

Same lock + dict + background-thread shape as apply_state.py and
search_state.py, but scoped to a single global sweep over a caller-supplied
job list rather than one job (apply_state) or a multi-stage pipeline
(search_state). Single-flight only -- one scan at a time.
"""

import logging
import threading
from datetime import datetime, timezone

log = logging.getLogger(__name__)

_MAX_LOG_LINES = 200
_MAX_WARNINGS = 50

_lock = threading.Lock()
_stop_event = threading.Event()
_state: dict = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "checked": 0,
    "total": 0,
    "closed_found": 0,
    "current": None,
    "log": [],
    "warnings": [],
    "error": None,
}


def get_status() -> dict:
    with _lock:
        return dict(_state)


def start_status_check(jobs: list[dict]) -> bool:
    """Start a background status-check scan over `jobs` (each a
    {"url", "title", "company"} dict -- the caller has already resolved
    which jobs match, e.g. via the same filters as the jobs table). Returns
    False if one is already running (single-flight guard)."""
    with _lock:
        if _state["running"]:
            return False
        _state.update(
            running=True,
            started_at=datetime.now(timezone.utc).isoformat(),
            finished_at=None,
            checked=0,
            total=len(jobs),
            closed_found=0,
            current=None,
            log=[],
            warnings=[],
            error=None,
        )
    _stop_event.clear()

    thread = threading.Thread(target=_run, args=(jobs,), daemon=True)
    thread.start()
    return True


def cancel() -> bool:
    """Best-effort cancel: signals the scan loop to stop before its next job.
    Returns whether a scan was actually in progress."""
    with _lock:
        was_running = _state["running"]
    _stop_event.set()
    return was_running


def _on_progress(evt: dict) -> None:
    with _lock:
        _state["checked"] = evt["done"]
        _state["total"] = evt["total"]
        _state["current"] = evt["current"]
        entry = {**evt["current"], "result": evt["result"]}
        _state["log"] = (_state["log"] + [entry])[-_MAX_LOG_LINES:]
        if evt["result"] == "closed":
            _state["closed_found"] += 1


def _on_warning(message: str) -> None:
    with _lock:
        _state["warnings"] = (_state["warnings"] + [message])[-_MAX_WARNINGS:]


def _run(jobs: list[dict]) -> None:
    from applypilot.status_check import run_status_check

    try:
        run_status_check(
            jobs,
            on_progress=_on_progress,
            on_warning=_on_warning,
            stop_event=_stop_event,
        )
    except Exception as e:
        log.error("Web status-check run failed: %s", e, exc_info=True)
        with _lock:
            _state["error"] = str(e)
    finally:
        with _lock:
            _state["running"] = False
            _state["finished_at"] = datetime.now(timezone.utc).isoformat()
