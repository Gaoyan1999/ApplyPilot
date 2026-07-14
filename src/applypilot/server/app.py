"""FastAPI backend for the ApplyPilot web dashboard.

Read-only v1: serves job/pipeline state from the SQLite database to the
React frontend in ../../webapp. No write endpoints, no auth (local-only
tool). Live updates are done via client-side polling, not WebSockets.
"""

import sys
import threading
import webbrowser
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from rich.console import Console

from applypilot.config import load_web_search_defaults, save_web_search_defaults
from applypilot.database import get_connection, get_stats
from applypilot.server import search_state
from applypilot.server.stages import STAGE_ORDER, compute_stage

console = Console()

app = FastAPI(title="ApplyPilot Dashboard")

# Curated job fields returned to the frontend — excludes internal/unused
# columns (strategy, agent_id, last_attempted_at, apply_duration_ms,
# apply_task_id, verification_confidence).
_JOB_FIELDS = [
    "url", "title", "site", "location", "salary",
    "fit_score", "score_reasoning",
    "application_url", "full_description",
    "discovered_at", "scored_at",
    "tailored_at", "tailor_attempts",
    "cover_letter_at", "cover_attempts",
    "applied_at", "apply_status", "apply_error", "apply_attempts",
    "detail_error",
]


@app.get("/api/status")
def get_status() -> dict:
    conn = get_connection()
    stats = get_stats(conn)

    high_fit = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE fit_score >= 7"
    ).fetchone()[0]

    rows = conn.execute("SELECT * FROM jobs").fetchall()
    columns = rows[0].keys() if rows else []
    stage_counts = {label: 0 for label in STAGE_ORDER}
    for row in rows:
        job = dict(zip(columns, row))
        stage_counts[compute_stage(job)] += 1

    return {
        "total": stats["total"],
        "with_description": stats["with_description"],
        "pending_detail": stats["pending_detail"],
        "detail_errors": stats["detail_errors"],
        "scored": stats["scored"],
        "unscored": stats["unscored"],
        "high_fit": high_fit,
        "tailored": stats["tailored"],
        "untailored_eligible": stats["untailored_eligible"],
        "tailor_exhausted": stats["tailor_exhausted"],
        "with_cover_letter": stats["with_cover_letter"],
        "cover_exhausted": stats["cover_exhausted"],
        "applied": stats["applied"],
        "apply_errors": stats["apply_errors"],
        "ready_to_apply": stats["ready_to_apply"],
        "score_distribution": [
            {"score": s, "count": c} for s, c in stats["score_distribution"]
        ],
        "by_site": [{"site": s, "count": c} for s, c in stats["by_site"]],
        "stage_counts": stage_counts,
    }


@app.get("/api/jobs")
def get_jobs() -> list[dict]:
    conn = get_connection()
    rows = conn.execute("SELECT * FROM jobs ORDER BY discovered_at DESC").fetchall()
    if not rows:
        return []

    columns = rows[0].keys()
    jobs = [dict(zip(columns, row)) for row in rows]

    result = []
    for job in jobs:
        out = {field: job.get(field) for field in _JOB_FIELDS}
        out["stage"] = compute_stage(job)
        result.append(out)
    return result


class SearchRunRequest(BaseModel):
    query: str
    location: str
    remote: bool = False
    sites: list[str] = ["indeed", "linkedin"]
    hours_old: int = 168


@app.get("/api/search/form")
def get_search_form() -> dict:
    return load_web_search_defaults()


@app.post("/api/search/run", status_code=202)
def run_search(body: SearchRunRequest) -> dict:
    save_web_search_defaults(body.model_dump())

    started = search_state.start_search(
        body.query, body.location, body.sites, body.remote, body.hours_old
    )
    if not started:
        raise HTTPException(status_code=409, detail="A search is already running")

    return search_state.get_status()


@app.get("/api/search/status")
def get_search_status() -> dict:
    return search_state.get_status()


def _resolve_static_dir() -> Path | None:
    """Find the built frontend (webapp/dist), if it exists.

    Checks a packaged location first (for a future PyPI release), then
    falls back to the repo-root-relative webapp/dist used in local dev.
    """
    packaged = Path(__file__).parent / "static"
    if packaged.is_dir():
        return packaged

    repo_dist = Path(__file__).resolve().parents[3] / "webapp" / "dist"
    if repo_dist.is_dir():
        return repo_dist

    return None


_static_dir = _resolve_static_dir()
if _static_dir is not None:
    # Registered last: Starlette matches routes in registration order, so
    # the /api/* handlers above must be defined before this catch-all
    # mount, otherwise the mount would shadow them.
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="frontend")


def run_server(host: str = "127.0.0.1", port: int = 8420, open_browser: bool = True) -> None:
    """Start the dashboard server, requiring a built frontend."""
    import uvicorn

    if _static_dir is None:
        console.print(
            "[red]Frontend not built.[/red] Run "
            "[bold]cd webapp && npm install && npm run build[/bold] first."
        )
        sys.exit(1)

    url = f"http://{host}:{port}"
    console.print(f"[green]Serving ApplyPilot dashboard at {url}[/green]")

    if open_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    uvicorn.run(app, host=host, port=port, log_level="warning")
