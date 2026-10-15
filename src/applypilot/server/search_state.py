"""In-memory state for the web dashboard's on-demand pipeline run.

A "search" from the browser is really the whole discover -> enrich -> score
pipeline run end to end, driven by the same ~/.applypilot/searches.yaml the
CLI uses (tiered queries x locations, board list, exclude_titles, ...):
find new postings, fill in full descriptions and apply URLs, then assign
fit scores -- so the jobs table can show a fully rated list without a trip
to the CLI. The three stages run at the same time, each on its own thread:
enrich and score keep picking up whatever their upstream stage has written
to the DB so far (many postings already come with a full description from
discovery, so rating can start within seconds of the first query), instead
of waiting for the whole crawl to finish. `discover_done`/`enrich_done` in
the state dict say which stages have finished; `stage` is the earliest one
still running, so the frontend can show progress instead of one long spinner.

Single-process guard only — it prevents overlapping runs triggered from the
browser, but can't see a CLI-triggered `applypilot run discover` happening
in a separate OS process. SQLite's WAL mode + busy_timeout (database.py)
already makes concurrent writes safe either way, so an overlap just means
slower scraping, not corruption.
"""

import logging
import threading
import uuid
from datetime import datetime, timezone

from applypilot import database

log = logging.getLogger(__name__)

# Stage names in run order, plus "done" as the terminal state.
STAGES = ("discover", "enrich", "score", "done")

# How long enrich/score wait before checking the DB again when a pass found
# nothing to do and their upstream stage is still running (seconds). The wait
# ends early as soon as the upstream stage finishes.
_POLL_INTERVAL = 10

# Cap on how many non-fatal warnings (permanently-failed third-party calls --
# a LinkedIn/Glassdoor scrape or an LLM call that exhausted its retries) we
# keep around for the frontend. These don't stop the run; this just bounds
# memory for a run with a lot of individual failures.
_MAX_WARNINGS = 50

# Cap on how many per-query result entries (discover_log) we keep around for
# the frontend's live log view -- a large crawl can have hundreds of query x
# location combos.
_MAX_LOG_LINES = 200

_lock = threading.Lock()
_state: dict = {
    "running": False,
    "stage": None,
    "started_at": None,
    "finished_at": None,
    "queries": 0,
    "queries_total": 0,
    "new": 0,
    "existing": 0,
    "discover_errors": 0,
    "discover_by_site": {},
    "current_query": None,
    "current_location": None,
    "discover_log": [],
    "discover_done": False,
    "enriched": 0,
    "enrich_total": 0,
    "enrich_done": False,
    "scored": 0,
    "score_total": 0,
    "warnings": [],
    "error": None,
    "error_stage": None,
    # URLs of jobs newly inserted by the most recent run -- internal
    # bookkeeping only (not part of the public status payload) so the
    # dashboard's "discard" action can remove exactly this run's new rows
    # without touching anything already in the DB. Cleared once
    # discarded/confirmed.
    "new_urls": [],
    # id of this run's row in the `tasks` table (database.py) -- internal
    # bookkeeping only, not part of the public status payload. None until
    # start_search() assigns one.
    "task_id": None,
}


def _snapshot() -> dict:
    """The public status shape -- used both for get_status() and as the
    `payload` written to the tasks table on every progress tick, so there's
    one definition of "what this run's state looks like", not two."""
    with _lock:
        state = dict(_state)
    state.pop("new_urls", None)
    state.pop("task_id", None)
    return state


def get_status() -> dict:
    return _snapshot()


def _sync_to_db() -> None:
    """Mirror the current snapshot onto this run's tasks-table row so the
    Tasks page's history survives a finish or a server restart. A no-op if
    no run has ever started (task_id still None)."""
    with _lock:
        task_id = _state.get("task_id")
    if not task_id:
        return
    database.update_task(database.get_connection(), task_id, payload=_snapshot())


def start_search() -> bool:
    """Start a background discover -> enrich -> score run, driven entirely by
    the user's searches.yaml. Returns False if one is already running."""
    with _lock:
        if _state["running"]:
            return False
        task_id = uuid.uuid4().hex
        started_at = datetime.now(timezone.utc).isoformat()
        _state.update(
            running=True,
            stage="discover",
            started_at=started_at,
            finished_at=None,
            queries=0,
            queries_total=0,
            new=0,
            existing=0,
            discover_errors=0,
            discover_by_site={},
            current_query=None,
            current_location=None,
            discover_log=[],
            discover_done=False,
            enriched=0,
            enrich_total=0,
            enrich_done=False,
            scored=0,
            score_total=0,
            warnings=[],
            error=None,
            error_stage=None,
            new_urls=[],
            task_id=task_id,
        )

    database.create_task(
        database.get_connection(),
        id=task_id,
        type="search",
        status="running",
        started_at=started_at,
        payload=_snapshot(),
    )

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    return True


def _on_discover_progress(evt: dict) -> None:
    with _lock:
        _state["queries"] = evt["queries_done"]
        _state["queries_total"] = evt["queries_total"]
        _state["new"] = evt["new"]
        _state["existing"] = evt["existing"]
        _state["discover_errors"] = evt["errors"]
        _state["discover_by_site"] = evt["by_site"]
        _state["current_query"] = evt.get("current_query")
        _state["current_location"] = evt.get("current_location")
        log_entry = evt.get("log_entry")
        if log_entry:
            _state["discover_log"] = (_state["discover_log"] + [log_entry])[-_MAX_LOG_LINES:]
    _sync_to_db()


def _pass_progress(done_key: str, total_key: str):
    """Progress callback for one enrich/score pass. Each pass reports its own
    {"done", "total"} starting from 0, so add them on top of what earlier
    passes in this run already counted -- the totals grow as discovery keeps
    finding jobs."""
    with _lock:
        base = _state[done_key]

    def on_progress(evt: dict) -> None:
        with _lock:
            _state[done_key] = base + evt["done"]
            _state[total_key] = base + evt["total"]
        _sync_to_db()

    return on_progress


def _on_warning(message: str) -> None:
    """Shared across all three stages (and their threads): a single third-party call (a
    LinkedIn/Glassdoor scrape, an LLM extraction/scoring call, a detail-page
    fetch) permanently failed after exhausting its retries. Recorded for the
    frontend to surface, but never aborts the run -- the stage just moves on
    to the next item."""
    with _lock:
        _state["warnings"] = (_state["warnings"] + [message])[-_MAX_WARNINGS:]
    _sync_to_db()


def _current_stage() -> str:
    """Earliest stage still running. Caller must hold _lock."""
    if not _state["discover_done"]:
        return "discover"
    if not _state["enrich_done"]:
        return "enrich"
    return "score"


def _run_discover() -> None:
    from applypilot.discovery.jobspy import run_discovery

    discover_stats = run_discovery(on_progress=_on_discover_progress, on_warning=_on_warning)
    with _lock:
        _state["queries"] = discover_stats.get("queries", 0)
        _state["new"] = discover_stats.get("new", 0)
        _state["existing"] = discover_stats.get("existing", 0)
        _state["discover_errors"] = discover_stats.get("errors", 0)
        _state["discover_by_site"] = discover_stats.get("by_site", {})
        _state["new_urls"] = discover_stats.get("new_urls", [])


def _run_in_passes(
    run_pass,
    count_processed,
    done_key: str,
    total_key: str,
    upstream_done: threading.Event,
    stop: threading.Event,
) -> None:
    """Run one enrich/score pass after another until the upstream stage has
    finished. The upstream flag is read *before* each pass, so there is
    always one last pass after upstream finishes that picks up everything it
    wrote. Jobs that fail are still marked as attempted (detail_scraped_at /
    fit_score = 0), so a pass never picks the same job up twice."""
    while not stop.is_set():
        upstream_finished = upstream_done.is_set()
        stats = run_pass(on_progress=_pass_progress(done_key, total_key), on_warning=_on_warning)
        if upstream_finished:
            return
        if count_processed(stats) == 0:
            # Nothing new yet -- wait for upstream to write more, but wake up
            # right away if it finishes so the last pass isn't delayed.
            upstream_done.wait(timeout=_POLL_INTERVAL)


def _run_enrich(discover_done: threading.Event, stop: threading.Event) -> None:
    from applypilot.enrichment.detail import run_enrichment

    _run_in_passes(
        run_enrichment,
        lambda stats: stats.get("processed", 0),
        "enriched",
        "enrich_total",
        discover_done,
        stop,
    )


def _run_score(enrich_done: threading.Event, stop: threading.Event) -> None:
    from applypilot.scoring.scorer import run_scoring

    _run_in_passes(
        run_scoring,
        lambda stats: stats.get("scored", 0),
        "scored",
        "score_total",
        enrich_done,
        stop,
    )


def _run() -> None:
    # One event per stage, set when that stage's thread ends (even on error,
    # so the stages after it don't wait forever). `stop` is set on the first
    # error so the other stages quit after their current pass.
    discover_done = threading.Event()
    enrich_done = threading.Event()
    score_done = threading.Event()
    stop = threading.Event()

    def stage_thread(name: str, done_event: threading.Event, target, *args) -> threading.Thread:
        def body() -> None:
            try:
                target(*args)
            except Exception as e:
                log.error("Web pipeline run failed at stage '%s': %s", name, e, exc_info=True)
                with _lock:
                    first_error = _state["error"] is None
                if first_error:
                    _fail(name, str(e))
                stop.set()
            finally:
                if name in ("discover", "enrich"):
                    with _lock:
                        _state[f"{name}_done"] = True
                        _state["stage"] = _current_stage()
                    _sync_to_db()
                done_event.set()

        return threading.Thread(target=body, name=f"search-{name}", daemon=True)

    threads = [
        stage_thread("discover", discover_done, _run_discover),
        stage_thread("enrich", enrich_done, _run_enrich, discover_done, stop),
        stage_thread("score", score_done, _run_score, enrich_done, stop),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    with _lock:
        if _state["error"] is None:
            _state["stage"] = "done"
        _state["running"] = False
        _state["finished_at"] = datetime.now(timezone.utc).isoformat()
        task_id = _state.get("task_id")
        finished_at = _state["finished_at"]
        error = _state.get("error")
    if task_id:
        database.update_task(
            database.get_connection(),
            task_id,
            status="error" if error else "success",
            finished_at=finished_at,
            error=error,
            payload=_snapshot(),
        )


def _fail(stage: str | None, message: str) -> None:
    with _lock:
        _state["error"] = message
        _state["error_stage"] = stage


def get_new_urls() -> list[str]:
    """URLs of jobs newly inserted by the most recent run -- backs the
    overview page's results list (title, fit score, etc.)."""
    with _lock:
        return list(_state["new_urls"])


def discard_new_jobs() -> int:
    """Delete the jobs newly inserted by the most recent run, leaving
    everything already in the DB untouched. Returns the number of rows
    deleted (0 if a run is still in progress, or there's nothing left to
    discard -- e.g. already discarded/confirmed, or no new jobs this run)."""
    from applypilot.database import get_connection

    with _lock:
        if _state["running"]:
            return 0
        urls = _state["new_urls"]
        if not urls:
            return 0
        _state["new_urls"] = []

    conn = get_connection()
    placeholders = ",".join("?" for _ in urls)
    cursor = conn.execute(f"DELETE FROM jobs WHERE url IN ({placeholders})", urls)
    conn.commit()
    return cursor.rowcount


def confirm_new_jobs() -> None:
    """Mark the most recent run's new jobs as reviewed. They were already
    saved to the DB during discovery -- this just clears the discard-eligible
    set so a stray discard call can't remove them after the fact."""
    with _lock:
        _state["new_urls"] = []
