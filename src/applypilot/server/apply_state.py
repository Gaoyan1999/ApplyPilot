"""In-memory state for web-triggered auto-submit runs.

A pool of N independent slots (config.DEFAULTS["web_apply_workers"]), each
mirroring launcher.py's worker_id-parameterized Chrome/CDP-port/browser
profile machinery already used by the CLI's multi-worker batch mode -- this
just exposes that same machinery to the web UI, so several auto-submits can
run in parallel instead of being globally single-flight the way a single
hardcoded worker slot would force them to be.

Each slot mirrors the old single-slot shape (running/url/started_at/
finished_at/error) plus `pending_review`: True once a run finishes in
ready_for_review/blocked and its Chrome window is deliberately left open
(see launcher.py's worker_loop finally-block) for the user to act on. A
pending_review slot stays occupied -- unavailable to start_apply() -- until
dismiss() closes that Chrome and frees it. This is deliberate: leaving
Chrome open is how the user reviews/finishes the job, and a second job
can't safely reuse that same slot's browser profile while it's still live.

Live per-action progress (status/last_action/actions/transcript) is read
straight from apply.dashboard's WorkerState, keyed by the same slot id --
already headless (a plain dataclass, no Rich dependency), so there's no
separate progress tracking to maintain here.

The actual outcome (ready_for_review/blocked/failed, and why) lives in the
jobs table, written by launcher.mark_result() -- callers should re-fetch the
job (GET /api/jobs/{url}) once a slot's `running` flips back to False rather
than trusting anything in this module for the final result. This module only
tracks enough to drive the "what's running/awaiting review, and what's it
doing" poll.
"""

import logging
import threading
from datetime import datetime, timezone

from applypilot import config
from applypilot.apply import chrome, dashboard, launcher
from applypilot.database import get_connection

log = logging.getLogger(__name__)

_NUM_SLOTS = config.DEFAULTS["web_apply_workers"]

_lock = threading.Lock()
_slots: dict[int, dict] = {
    i: {
        "running": False,
        "pending_review": False,
        "url": None,
        "started_at": None,
        "finished_at": None,
        "error": None,
        # Set by cancel() right before it kills the job's subprocess, consumed
        # by _run() once worker_loop() returns. Needed because a cancelled
        # job's Chrome is deliberately left open (see launcher.py) but its
        # apply_status reverts to NULL via release_lock() rather than going
        # through mark_result() -- so the ready_for_review/blocked apply_status
        # check alone would miss this case and wrongly free the slot while its
        # Chrome (and browser profile dir) is still alive on it.
        "was_cancelled": False,
    }
    for i in range(_NUM_SLOTS)
}


def _slot_status(slot_id: int, slot: dict) -> dict:
    """Shape one slot's bookkeeping dict + its live WorkerState into the
    public status payload."""
    status = dict(slot)
    status.pop("was_cancelled", None)
    status["slot_id"] = slot_id
    ws = dashboard.get_state(slot_id)
    status["status"] = ws.status if ws else None
    status["last_action"] = ws.last_action if ws else None
    status["actions"] = ws.actions if ws else 0
    status["transcript"] = list(ws.transcript) if ws else []
    status["job_title"] = ws.job_title if ws else None
    status["job_company"] = ws.company if ws else None
    status["screenshot"] = ws.screenshot if ws else None
    return status


def get_status(url: str | None = None) -> dict:
    """Return the status of whichever slot is running/holding `url`. If no
    slot matches (never started, already dismissed, or a different job
    entirely), reports idle rather than leaking another job's error/
    transcript into the caller's view."""
    with _lock:
        match = next(
            ((i, dict(s)) for i, s in _slots.items() if url is not None and s["url"] == url),
            None,
        )
    if match is None:
        return {
            "running": False,
            "url": url,
            "started_at": None,
            "finished_at": None,
            "error": None,
            "status": None,
            "last_action": None,
            "actions": 0,
            "transcript": [],
            "screenshot": None,
        }
    slot_id, slot = match
    return _slot_status(slot_id, slot)


def get_all_statuses() -> list[dict]:
    """One entry per occupied slot (running OR awaiting review) -- backs the
    Tasks dashboard's list of in-flight/pending-review auto-applies."""
    with _lock:
        occupied = [(i, dict(s)) for i, s in _slots.items() if s["running"] or s["pending_review"]]
    return [_slot_status(i, s) for i, s in occupied]


def start_apply(url: str, model: str = "haiku") -> int | None:
    """Start a background auto-submit run for one job in the first free slot
    (not running and not awaiting review). Returns the slot id it landed in,
    or None if every slot is currently busy, or if `url` already owns a
    running/pending_review slot elsewhere -- acquire_job() only checks the
    job row's own apply_status, not this module's in-memory slot registry,
    so without this check a second trigger on an already-ready_for_review/
    blocked job could spin up a completely separate Chrome for the same job
    while the first one is still sitting open."""
    with _lock:
        already_active = any(
            s["url"] == url and (s["running"] or s["pending_review"]) for s in _slots.values()
        )
        if already_active:
            return None
        free_id = next(
            (i for i, s in _slots.items() if not s["running"] and not s["pending_review"]),
            None,
        )
        if free_id is None:
            return None
        _slots[free_id].update(
            running=True,
            url=url,
            started_at=datetime.now(timezone.utc).isoformat(),
            finished_at=None,
            error=None,
            was_cancelled=False,
        )

    thread = threading.Thread(target=_run, args=(free_id, url, model), daemon=True)
    thread.start()
    return free_id


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
    if row["apply_status"] in ("failed", "blocked") and row["apply_error"]:
        return f"Already marked {row['apply_status']}: {row['apply_error']}"
    return "Could not start -- job may not be ready for auto-apply yet."


def _run(slot_id: int, url: str, model: str) -> None:
    dashboard.init_worker(slot_id)
    pending_review = False
    try:
        applied, failed = launcher.worker_loop(
            worker_id=slot_id,
            limit=1,
            target_url=url,
            min_score=0,
            headless=False,
            model=model,
        )
        # worker_loop's (applied, failed) counters don't distinguish
        # ready_for_review from a real no-op, or blocked from either --
        # the job row is the source of truth for which of those happened.
        conn = get_connection()
        row = conn.execute(
            "SELECT apply_status FROM jobs WHERE url = ?", (url,)
        ).fetchone()
        apply_status = row["apply_status"] if row else None
        with _lock:
            was_cancelled = _slots[slot_id]["was_cancelled"]
        if was_cancelled:
            # Cancelled mid-run: release_lock() reset apply_status to NULL
            # (never went through mark_result()), but Chrome was deliberately
            # left open for inspection -- that still occupies the slot.
            pending_review = True
        elif apply_status in ("ready_for_review", "blocked"):
            pending_review = True
        elif applied == 0 and failed == 0:
            with _lock:
                _slots[slot_id]["error"] = _describe_no_op(url)
    except Exception as e:
        log.error("Web auto-submit failed for %s (slot %d): %s", url, slot_id, e, exc_info=True)
        with _lock:
            _slots[slot_id]["error"] = str(e)
    finally:
        with _lock:
            _slots[slot_id]["running"] = False
            _slots[slot_id]["finished_at"] = datetime.now(timezone.utc).isoformat()
            _slots[slot_id]["pending_review"] = pending_review
            _slots[slot_id]["was_cancelled"] = False


def cancel(url: str) -> bool:
    """Best-effort cancel of the run holding `url` -- kills that slot's
    tracked claude subprocess, which makes run_job() return "skipped". The
    Chrome window is deliberately left open (marked per-slot via
    launcher._mark_keep_chrome_on_cancel) so the user can see what state the
    application was in when they cancelled. Returns whether a run was
    actually in progress for that url. Only touches the one slot -- other
    concurrently running auto-submits are unaffected."""
    with _lock:
        slot_id = next(
            (i for i, s in _slots.items() if s["url"] == url and s["running"]),
            None,
        )
        if slot_id is None:
            return False
        _slots[slot_id]["was_cancelled"] = True

    launcher._mark_keep_chrome_on_cancel(slot_id)
    with launcher._claude_lock:
        proc = launcher._claude_procs.get(slot_id)
        if proc and proc.poll() is None:
            launcher._kill_process_tree(proc.pid)
    return True


def dismiss(url: str) -> bool:
    """Free the slot holding `url` once it's sitting in ready_for_review/
    blocked with its Chrome window intentionally left open -- closes that
    Chrome and frees the slot for a future start_apply(). Returns False if
    no slot is holding `url` in pending_review state (still running, no
    matching slot, or already dismissed)."""
    with _lock:
        slot_id = next(
            (i for i, s in _slots.items() if s["url"] == url and s["pending_review"]),
            None,
        )
        if slot_id is None:
            return False
        _slots[slot_id]["pending_review"] = False

    chrome.close_worker_chrome(slot_id)
    return True
