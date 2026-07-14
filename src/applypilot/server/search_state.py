"""In-memory state for the web dashboard's on-demand quick search.

Single-process guard only — it prevents overlapping quick-searches
triggered from the browser, but can't see a CLI-triggered
`applypilot run discover` happening in a separate OS process. SQLite's
WAL mode + busy_timeout (database.py) already makes concurrent writes
safe either way, so an overlap just means slower scraping, not
corruption.
"""

import threading
from datetime import datetime, timezone

_lock = threading.Lock()
_state: dict = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "found": 0,
    "total": 0,
    "error": None,
    "query": None,
    "location": None,
}


def get_status() -> dict:
    with _lock:
        return dict(_state)


def start_search(query: str, location: str, sites: list[str], remote: bool) -> bool:
    """Start a background quick search. Returns False if one is already running."""
    with _lock:
        if _state["running"]:
            return False
        _state.update(
            running=True,
            started_at=datetime.now(timezone.utc).isoformat(),
            finished_at=None,
            found=0,
            total=0,
            error=None,
            query=query,
            location=location,
        )

    thread = threading.Thread(target=_run, args=(query, location, sites, remote), daemon=True)
    thread.start()
    return True


def _run(query: str, location: str, sites: list[str], remote: bool) -> None:
    from applypilot.discovery.jobspy import search_jobs

    try:
        result = search_jobs(query, location, sites=sites, remote_only=remote)
        with _lock:
            if "error" in result:
                _state["error"] = result["error"]
            else:
                _state["found"] = result.get("new", 0)
                _state["total"] = result.get("total", 0)
    except Exception as e:
        with _lock:
            _state["error"] = str(e)
    finally:
        with _lock:
            _state["running"] = False
            _state["finished_at"] = datetime.now(timezone.utc).isoformat()
