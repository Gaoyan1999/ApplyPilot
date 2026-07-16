"""In-memory state for the web dashboard's on-demand pipeline run.

A "search" from the browser is really the whole discover -> enrich -> score
pipeline run end to end, driven by the same ~/.applypilot/searches.yaml the
CLI uses (tiered queries x locations, board list, exclude_titles, ...):
find new postings, fill in full descriptions and apply URLs, then assign
fit scores -- so the jobs table can show a fully rated list without a trip
to the CLI. Each stage runs in turn on a single background thread; `stage`
in the state dict tracks which one is active so the frontend can show
progress instead of one long spinner.

Single-process guard only — it prevents overlapping runs triggered from the
browser, but can't see a CLI-triggered `applypilot run discover` happening
in a separate OS process. SQLite's WAL mode + busy_timeout (database.py)
already makes concurrent writes safe either way, so an overlap just means
slower scraping, not corruption.
"""

import logging
import threading
from datetime import datetime, timezone

log = logging.getLogger(__name__)

# Stage names in run order, plus "done" as the terminal state.
STAGES = ("discover", "enrich", "score", "done")

# Cap on how many non-fatal warnings (permanently-failed third-party calls --
# a LinkedIn/Glassdoor scrape or an LLM call that exhausted its retries) we
# keep around for the frontend. These don't stop the run; this just bounds
# memory for a run with a lot of individual failures.
_MAX_WARNINGS = 50

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
    "enriched": 0,
    "enrich_total": 0,
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
}


def get_status() -> dict:
    with _lock:
        state = dict(_state)
    state.pop("new_urls", None)
    return state


def start_search() -> bool:
    """Start a background discover -> enrich -> score run, driven entirely by
    the user's searches.yaml. Returns False if one is already running."""
    with _lock:
        if _state["running"]:
            return False
        _state.update(
            running=True,
            stage="discover",
            started_at=datetime.now(timezone.utc).isoformat(),
            finished_at=None,
            queries=0,
            queries_total=0,
            new=0,
            existing=0,
            discover_errors=0,
            discover_by_site={},
            enriched=0,
            enrich_total=0,
            scored=0,
            score_total=0,
            warnings=[],
            error=None,
            error_stage=None,
            new_urls=[],
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


def _on_enrich_progress(evt: dict) -> None:
    with _lock:
        _state["enriched"] = evt["done"]
        _state["enrich_total"] = evt["total"]


def _on_score_progress(evt: dict) -> None:
    with _lock:
        _state["scored"] = evt["done"]
        _state["score_total"] = evt["total"]


def _on_warning(message: str) -> None:
    """Shared across all three stages: a single third-party call (a
    LinkedIn/Glassdoor scrape, an LLM extraction/scoring call, a detail-page
    fetch) permanently failed after exhausting its retries. Recorded for the
    frontend to surface, but never aborts the run -- the stage just moves on
    to the next item."""
    with _lock:
        _state["warnings"] = (_state["warnings"] + [message])[-_MAX_WARNINGS:]


def _run() -> None:
    from applypilot.discovery.jobspy import run_discovery
    from applypilot.enrichment.detail import run_enrichment
    from applypilot.scoring.scorer import run_scoring

    try:
        discover_stats = run_discovery(on_progress=_on_discover_progress, on_warning=_on_warning)
        with _lock:
            _state["queries"] = discover_stats.get("queries", 0)
            _state["new"] = discover_stats.get("new", 0)
            _state["existing"] = discover_stats.get("existing", 0)
            _state["discover_errors"] = discover_stats.get("errors", 0)
            _state["discover_by_site"] = discover_stats.get("by_site", {})
            _state["new_urls"] = discover_stats.get("new_urls", [])

        with _lock:
            _state["stage"] = "enrich"
        enrich_stats = run_enrichment(on_progress=_on_enrich_progress, on_warning=_on_warning)
        with _lock:
            _state["enriched"] = enrich_stats.get("ok", 0) + enrich_stats.get("partial", 0)

        with _lock:
            _state["stage"] = "score"
        score_stats = run_scoring(on_progress=_on_score_progress, on_warning=_on_warning)
        with _lock:
            _state["scored"] = score_stats.get("scored", 0)

        with _lock:
            _state["stage"] = "done"
    except Exception as e:
        # Best-effort stage attribution: whatever _state["stage"] was when we
        # entered this run is where it broke.
        with _lock:
            failed_stage = _state["stage"]
        log.error("Web pipeline run failed at stage '%s': %s", failed_stage, e, exc_info=True)
        _fail(failed_stage, str(e))
        return
    finally:
        with _lock:
            _state["running"] = False
            _state["finished_at"] = datetime.now(timezone.utc).isoformat()


def _fail(stage: str | None, message: str) -> None:
    with _lock:
        _state["error"] = message
        _state["error_stage"] = stage


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
