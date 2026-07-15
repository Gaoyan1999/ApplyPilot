"""FastAPI backend for the ApplyPilot web dashboard.

Mostly read-only: serves job/pipeline state from the SQLite database to the
React frontend in ../../webapp. The only writes are editing searches.yaml
(/api/search/config) and triggering a discover -> enrich -> score run
(/api/search/run). No auth (local-only tool). Live updates are done via
client-side polling, not WebSockets.
"""

import sys
import threading
import webbrowser
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from rich.console import Console

from applypilot.config import get_tier, load_search_config, save_search_config
from applypilot.database import get_connection, get_stats
from applypilot.server import search_state
from applypilot.server.stages import STAGE_ORDER, compute_stage

console = Console()

app = FastAPI(title="ApplyPilot Dashboard")

# Curated job fields returned to the frontend — excludes internal/unused
# columns (strategy, agent_id, last_attempted_at, apply_duration_ms,
# apply_task_id, verification_confidence).
_JOB_FIELDS = [
    "url", "title", "site", "job_type", "location", "salary",
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
        "by_job_type": [{"job_type": t, "count": c} for t, c in stats["by_job_type"]],
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


class SearchQuery(BaseModel):
    query: str
    tier: int = 1


class SearchLocation(BaseModel):
    location: str
    remote: bool = False


class SearchConfigDefaults(BaseModel):
    results_per_site: int = 100
    hours_old: int = 72


class SearchConfigBody(BaseModel):
    queries: list[SearchQuery] = []
    locations: list[SearchLocation] = []
    exclude_titles: list[str] = []
    boards: list[str] = []
    defaults: SearchConfigDefaults = SearchConfigDefaults()


def _public_search_config(cfg: dict) -> dict:
    """Shape a full searches.yaml dict down to the fields the web editor manages."""
    defaults = cfg.get("defaults", {})
    return {
        "queries": cfg.get("queries", []),
        "locations": cfg.get("locations", []),
        "exclude_titles": cfg.get("exclude_titles", []),
        "boards": cfg.get("boards", []),
        "defaults": {
            "results_per_site": defaults.get("results_per_site", 100),
            "hours_old": defaults.get("hours_old", 72),
        },
    }


@app.get("/api/search/config")
def get_search_config() -> dict:
    try:
        cfg = load_search_config()
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return _public_search_config(cfg)


@app.put("/api/search/config")
def put_search_config(body: SearchConfigBody) -> dict:
    saved = save_search_config(body.model_dump())
    return _public_search_config(saved)


@app.post("/api/search/run", status_code=202)
def run_search() -> dict:
    # The chained discover -> enrich -> score run needs an LLM key (Tier 2)
    # even though "discover" alone would work at Tier 1.
    if get_tier() < 2:
        raise HTTPException(
            status_code=400,
            detail=(
                "Search now includes AI scoring and requires an LLM API key. "
                "Run 'applypilot init' or set GEMINI_API_KEY / OPENAI_API_KEY / LLM_URL."
            ),
        )

    started = search_state.start_search()
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
