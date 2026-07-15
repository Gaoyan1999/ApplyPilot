"""In-memory state for the web dashboard's on-demand quick search.

A "search" from the browser is really the whole discover -> enrich -> score
pipeline run end to end: find new postings, fill in full descriptions and
apply URLs, then assign fit scores -- so the jobs table can show a fully
rated list without a trip to the CLI. Each stage runs in turn on a single
background thread; `stage` in the state dict tracks which one is active so
the frontend can show progress instead of one long spinner.

Single-process guard only — it prevents overlapping quick-searches
triggered from the browser, but can't see a CLI-triggered
`applypilot run discover` happening in a separate OS process. SQLite's
WAL mode + busy_timeout (database.py) already makes concurrent writes
safe either way, so an overlap just means slower scraping, not
corruption.
"""

import logging
import threading
from datetime import datetime, timezone

log = logging.getLogger(__name__)

# Stage names in run order, plus "done" as the terminal state.
STAGES = ("discover", "enrich", "score", "done")

_lock = threading.Lock()
_state: dict = {
    "running": False,
    "stage": None,
    "started_at": None,
    "finished_at": None,
    "found": 0,
    "total": 0,
    "enriched": 0,
    "scored": 0,
    "error": None,
    "error_stage": None,
    "query": None,
    "location": None,
}


def get_status() -> dict:
    with _lock:
        return dict(_state)


def start_search(query: str, location: str, sites: list[str], remote: bool, hours_old: int = 168) -> bool:
    """Start a background discover -> enrich -> score run. Returns False if one is already running."""
    with _lock:
        if _state["running"]:
            return False
        _state.update(
            running=True,
            stage="discover",
            started_at=datetime.now(timezone.utc).isoformat(),
            finished_at=None,
            found=0,
            total=0,
            enriched=0,
            scored=0,
            error=None,
            error_stage=None,
            query=query,
            location=location,
        )

    thread = threading.Thread(target=_run, args=(query, location, sites, remote, hours_old), daemon=True)
    thread.start()
    return True


def _run(query: str, location: str, sites: list[str], remote: bool, hours_old: int) -> None:
    from applypilot.discovery.jobspy import search_jobs
    from applypilot.enrichment.detail import run_enrichment
    from applypilot.scoring.scorer import run_scoring

    try:
        result = search_jobs(query, location, sites=sites, remote_only=remote, hours_old=hours_old)
        if "error" in result:
            _fail("discover", result["error"])
            return
        with _lock:
            _state["found"] = result.get("new", 0)
            _state["total"] = result.get("total", 0)

        with _lock:
            _state["stage"] = "enrich"
        enrich_stats = run_enrichment()
        with _lock:
            _state["enriched"] = enrich_stats.get("ok", 0) + enrich_stats.get("partial", 0)

        with _lock:
            _state["stage"] = "score"
        score_stats = run_scoring()
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
