"""FastAPI backend for the ApplyPilot web dashboard.

Mostly read-only: serves job/pipeline state from the SQLite database to the
React frontend in ../../webapp. The only writes are editing searches.yaml
(/api/search/config), editing prompt template overrides (/api/prompts), and
triggering a discover -> enrich -> score run (/api/search/run). No auth
(local-only tool). Live updates are done via client-side polling, not
WebSockets.
"""

import logging
import os
import sys
import threading
import webbrowser
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from rich.console import Console

from applypilot.config import (
    CV_DIR,
    ENV_PATH,
    PROFILE_PATH,
    apply_profile_extraction,
    delete_cv,
    ensure_dirs,
    get_context_status,
    get_primary_cv_name,
    get_prompt_seed,
    get_tier,
    list_cvs,
    load_env,
    load_profile,
    load_prompts,
    load_search_config,
    parse_profile_markdown,
    profile_exists,
    profile_skeleton_markdown,
    read_cv_text,
    read_profile_markdown,
    safe_cv_name,
    save_cv,
    save_profile,
    save_profile_markdown,
    save_prompts,
    save_search_config,
    set_primary_cv,
)
from applypilot.database import (
    delete_task,
    get_connection,
    get_stats,
    init_db,
    list_tasks,
    reconcile_orphaned_tasks,
    search_jobs,
)
from applypilot import llm
from applypilot.profile_ai import extract_profile_fields, suggest_search_config
from applypilot.search_config import SearchYamlConfig
from applypilot.server import apply_state, search_state, status_check_state
from applypilot.server.stages import STAGE_ORDER, USER_ACTIONS, compute_stage

# Configures the root logger so applypilot.* loggers (e.g. discovery.jobspy)
# actually emit -- needed when this module is loaded directly by `uvicorn
# applypilot.server.app:app` rather than via the CLI, since applypilot.cli
# (the only other place that calls basicConfig) never gets imported in that
# path. No-op if a handler is already configured (e.g. by the CLI).
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%H:%M:%S",
)

_NEEDS_LLM_KEY_DETAIL = (
    "This requires an LLM API key. Set it on the Context page, or set "
    "GEMINI_API_KEY / OPENAI_API_KEY / LLM_URL."
)

console = Console()

app = FastAPI(title="ApplyPilot Dashboard")

# The dashboard is otherwise read-only and assumes some other command (a
# discovery/enrichment run) already created the schema --
# but the dashboard can also be the very first thing run against a DB, or
# against one created before a column was added. Run the migration here too
# so /api/jobs and friends never hit "no such column".
init_db()

# Any task row still 'running' at this point belongs to a Python thread from
# a previous process that's gone -- there's no way to resume it, so mark it
# failed instead of leaving it stuck showing "running" forever.
reconcile_orphaned_tasks()

# Curated job fields returned to the frontend — excludes internal/unused
# columns (strategy, agent_id, last_attempted_at, apply_duration_ms,
# apply_task_id, verification_confidence). Detail fetches (single job) get
# the full set including full_description; list/search results omit it --
# it's not needed for table rows and keeping it out shrinks page payloads.
_JOB_DETAIL_FIELDS = [
    "url", "title", "company", "site", "job_type", "location", "salary",
    "fit_score", "score_reasoning",
    "application_url", "full_description",
    "discovered_at", "scored_at",
    "tailored_at", "tailor_attempts",
    "cover_letter_path", "cover_letter_at", "cover_attempts",
    "applied_at", "apply_status", "apply_error", "apply_attempts",
    "detail_error", "user_action", "dismissed", "starred",
]
_JOB_LIST_FIELDS = [f for f in _JOB_DETAIL_FIELDS if f != "full_description"]


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
        "ready_for_review": stats["ready_for_review"],
        "blocked": stats["blocked"],
        "ready_to_apply": stats["ready_to_apply"],
        "score_distribution": [
            {"score": s, "count": c} for s, c in stats["score_distribution"]
        ],
        "by_site": [{"site": s, "count": c} for s, c in stats["by_site"]],
        "by_job_type": [{"job_type": t, "count": c} for t, c in stats["by_job_type"]],
        "by_user_action": [{"user_action": a, "count": c} for a, c in stats["by_user_action"]],
        "stage_counts": stage_counts,
    }


@app.get("/api/jobs/search")
def api_search_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    q: str = "",
    job_type: list[str] = Query([]),
    job_type_mode: str = Query("is", pattern="^(is|is_not)$"),
    user_action: list[str] = Query([]),
    user_action_mode: str = Query("is", pattern="^(is|is_not)$"),
    include_dismissed: bool = False,
    starred_only: bool = False,
    discovered_after: str | None = Query(None, pattern="^\\d{4}-\\d{2}-\\d{2}$"),
    discovered_before: str | None = Query(None, pattern="^\\d{4}-\\d{2}-\\d{2}$"),
    score_min: int | None = Query(None),
    score_max: int | None = Query(None),
    sort_by: str = Query(
        "discovered_at",
        pattern="^(title|company|site|location|job_type|fit_score|discovered_at)$",
    ),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
) -> dict:
    conn = get_connection()
    jobs, total = search_jobs(
        conn,
        q=q,
        job_type=job_type,
        job_type_mode=job_type_mode,
        user_action=user_action,
        user_action_mode=user_action_mode,
        include_dismissed=include_dismissed,
        starred_only=starred_only,
        discovered_after=discovered_after,
        discovered_before=discovered_before,
        score_min=score_min,
        score_max=score_max,
        sort_by=sort_by,
        sort_dir=sort_dir,
        page=page,
        page_size=page_size,
    )

    items = []
    for job in jobs:
        out = {field: job.get(field) for field in _JOB_LIST_FIELDS}
        out["dismissed"] = bool(out.get("dismissed"))
        out["starred"] = bool(out.get("starred"))
        out["stage"] = compute_stage(job)
        items.append(out)

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total else 0,
    }


class UserActionBody(BaseModel):
    user_action: str | None = None
    dismissed: bool | None = None
    starred: bool | None = None


@app.patch("/api/jobs/{url:path}")
def update_job_user_action(url: str, body: UserActionBody) -> dict:
    """Partial update of a job's manual annotations.

    Only fields actually present in the request body are touched -- e.g. a
    request with just `{"dismissed": true}` leaves `user_action` untouched,
    and vice versa. `user_action`, `dismissed`, and `starred` are independent:
    a job can be dismissed and/or starred regardless of whatever user_action
    it also has, or none.
    """
    fields_set = body.model_fields_set
    if "user_action" in fields_set and body.user_action is not None and body.user_action not in USER_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"user_action must be one of {USER_ACTIONS} or null",
        )
    if not fields_set:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates: dict[str, object] = {}
    if "user_action" in fields_set:
        updates["user_action"] = body.user_action
    if "dismissed" in fields_set:
        updates["dismissed"] = 1 if body.dismissed else 0
    if "starred" in fields_set:
        updates["starred"] = 1 if body.starred else 0

    set_clause = ", ".join(f"{col} = ?" for col in updates)
    conn = get_connection()
    cursor = conn.execute(
        f"UPDATE jobs SET {set_clause} WHERE url = ?", (*updates.values(), url)
    )
    conn.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Job not found")

    response: dict[str, object] = {"url": url}
    if "user_action" in updates:
        response["user_action"] = updates["user_action"]
    if "dismissed" in updates:
        response["dismissed"] = bool(updates["dismissed"])
    if "starred" in updates:
        response["starred"] = bool(updates["starred"])
    return response


@app.get("/api/jobs/{url:path}/cover-letter")
def get_job_cover_letter(url: str) -> dict:
    conn = get_connection()
    row = conn.execute(
        "SELECT cover_letter_path FROM jobs WHERE url = ?", (url,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    path = row["cover_letter_path"]
    if not path or not Path(path).exists():
        return {"text": None}

    return {"text": Path(path).read_text(encoding="utf-8")}


@app.post("/api/jobs/{url:path}/cover-letter")
def generate_job_cover_letter(url: str) -> dict:
    if get_tier() < 2:
        raise HTTPException(status_code=400, detail=_NEEDS_LLM_KEY_DETAIL)

    from applypilot.scoring.cover_letter import generate_cover_letter_for_job

    try:
        return generate_cover_letter_for_job(url)
    except ValueError as e:
        status_code = 404 if "not found" in str(e) else 400
        raise HTTPException(status_code=status_code, detail=str(e)) from e


@app.get("/api/jobs/{url:path}/cover-letter/pdf")
def download_job_cover_letter_pdf(url: str):
    """Download the generated cover letter PDF (see scoring.cover_letter).

    Registered before the general GET /api/jobs/{url:path} route below, for
    the same reason as the other /cover-letter routes -- otherwise that
    catch-all pattern would swallow this path too.
    """
    conn = get_connection()
    row = conn.execute(
        "SELECT cover_letter_path FROM jobs WHERE url = ?", (url,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    txt_path = row["cover_letter_path"]
    if not txt_path:
        raise HTTPException(status_code=404, detail="No cover letter generated yet")

    pdf_path = Path(txt_path).with_suffix(".pdf")
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Cover letter PDF not found")

    return FileResponse(pdf_path, media_type="application/pdf", filename=pdf_path.name)


def _require_tier3() -> None:
    """Inline tier-3 check for the API path -- config.check_tier() prints to
    the console and raises SystemExit, which isn't appropriate for a request
    handler, so this builds the same "what's missing" message as an
    HTTPException instead."""
    if get_tier() >= 3:
        return

    import shutil

    from applypilot.config import get_chrome_path

    missing = []
    if get_tier() < 2:
        missing.append(
            "an LLM API key -- set it on the Context page, or set GEMINI_API_KEY / OPENAI_API_KEY / LLM_URL"
        )
    if not shutil.which("claude"):
        missing.append("Claude Code CLI -- install from https://claude.ai/code")
    try:
        get_chrome_path()
    except FileNotFoundError:
        missing.append("Chrome/Chromium -- install or set CHROME_PATH")

    detail = "Auto-submit requires Full Auto-Apply (Tier 3)."
    if missing:
        detail += " Missing: " + "; ".join(missing)
    raise HTTPException(status_code=400, detail=detail)


@app.post("/api/jobs/{url:path}/auto-submit", status_code=202)
def start_job_auto_submit(url: str) -> dict:
    """Kick off a background Claude Code session that fills out this one
    job's application in a visible Chrome window (it stops short of
    clicking Submit -- see apply/prompt.py). Runs in whichever web
    auto-submit slot is free; multiple jobs can be in flight at once (see
    server/apply_state.py)."""
    _require_tier3()

    conn = get_connection()
    row = conn.execute(
        "SELECT tailored_resume_path, applied_at FROM jobs WHERE url = ?", (url,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not row["tailored_resume_path"] and not list_cvs():
        raise HTTPException(
            status_code=400,
            detail="No resume available -- add a CV in the CV library or tailor a resume for this job first.",
        )
    if row["applied_at"]:
        raise HTTPException(status_code=400, detail="This job has already been applied to.")

    if apply_state.start_apply(url) is None:
        raise HTTPException(
            status_code=409,
            detail="All auto-submit slots are busy or awaiting your review -- dismiss one from the Tasks dashboard first.",
        )

    return apply_state.get_status(url)


@app.get("/api/jobs/{url:path}/auto-submit/status")
def get_job_auto_submit_status(url: str) -> dict:
    return apply_state.get_status(url)


@app.get("/api/auto-submit/status")
def get_all_auto_submit_statuses() -> list[dict]:
    """All slots currently running or awaiting review -- backs
    JobPreviewModal's per-job polling. See GET /api/tasks for the Tasks
    dashboard's persisted history view."""
    return apply_state.get_all_statuses()


@app.post("/api/jobs/{url:path}/auto-submit/cancel")
def cancel_job_auto_submit(url: str) -> dict:
    return {"cancelled": apply_state.cancel(url)}


@app.post("/api/jobs/{url:path}/auto-submit/dismiss")
def dismiss_job_auto_submit(url: str) -> dict:
    """Close the Chrome window left open for a ready_for_review/blocked job
    and free its slot for a future auto-submit."""
    return {"dismissed": apply_state.dismiss(url)}


@app.get("/api/tasks")
def get_tasks(limit: int = Query(200, ge=1, le=1000)) -> list[dict]:
    """Persisted history of search runs, status checks, and auto-applies,
    newest first -- backs the Tasks dashboard. Unlike the individual
    /api/search/status, /api/status-check/status, and /api/auto-submit/status
    endpoints (each only ever knows about "the current/last run"), this
    reads from the `tasks` table so finished and past runs stick around
    instead of disappearing the moment a slot frees up or a new run starts.

    A still-`running` auto_apply row gets its live transcript/actions
    merged in from apply_state's in-memory WorkerState (not written to the
    DB continuously -- see apply_state.get_live_payload) so the row keeps
    updating in real time during the run, same as before."""
    tasks = list_tasks(get_connection(), limit=limit)
    for task in tasks:
        if task["type"] == "auto_apply" and task["status"] == "running":
            slot_id = task["payload"].get("slot_id")
            live = apply_state.get_live_payload(slot_id) if slot_id is not None else None
            if live:
                task["payload"] = {**task["payload"], **live}
    return tasks


@app.delete("/api/tasks/{task_id}")
def remove_task(task_id: str) -> dict:
    conn = get_connection()
    row = conn.execute("SELECT status FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if row["status"] == "running":
        raise HTTPException(status_code=400, detail="Can't delete a task that's still running")
    return {"deleted": delete_task(conn, task_id)}


_MAX_CV_BYTES = 10 * 1024 * 1024  # 10MB


@app.get("/api/cvs")
def api_list_cvs() -> list[dict]:
    return list_cvs()


@app.post("/api/cvs", status_code=201)
async def api_upload_cv(file: UploadFile = File(...), name: str = Form("")) -> dict:
    if file.content_type != "application/pdf" and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    data = await file.read()
    if len(data) > _MAX_CV_BYTES:
        raise HTTPException(status_code=400, detail="File too large (10MB limit).")
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    cv_name = name.strip() or Path(file.filename or "resume").stem
    ensure_dirs()
    try:
        return save_cv(cv_name, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.delete("/api/cvs/{name}")
def api_delete_cv(name: str) -> dict:
    try:
        deleted = delete_cv(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not deleted:
        raise HTTPException(status_code=404, detail="CV not found")
    return {"deleted": True}


@app.post("/api/cvs/{name}/primary")
def api_set_primary_cv(name: str) -> dict:
    try:
        set_primary_cv(name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"primary": safe_cv_name(name)}


@app.get("/api/cvs/{name}/file")
def api_get_cv_file(name: str):
    try:
        safe_name = safe_cv_name(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    pdf_path = CV_DIR / f"{safe_name}.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="CV not found")
    return FileResponse(pdf_path, media_type="application/pdf", filename=pdf_path.name)


# ---------------------------------------------------------------------------
# Context / setup -- replaces the old CLI wizard (applypilot init). One
# status model (get_context_status) powers both the "nothing configured
# yet" onboarding view and the ongoing gap checklist in the webapp.
# ---------------------------------------------------------------------------

class ProfileMarkdownBody(BaseModel):
    text: str


class KnowledgeBaseBody(BaseModel):
    dir: str = ""


class ProfileExtractBody(BaseModel):
    cv_name: str | None = None


class SearchSuggestBody(BaseModel):
    cv_name: str | None = None


class SetupEnvBody(BaseModel):
    url: str
    model: str
    # Blank keeps the key already saved -- the GET below never sends it back.
    api_key: str = ""


@app.get("/api/context/status")
def api_context_status() -> dict:
    return get_context_status()


@app.get("/api/profile")
def api_get_profile() -> dict:
    if not profile_exists():
        raise HTTPException(status_code=404, detail="Profile not found")
    return load_profile()


@app.get("/api/profile/markdown")
def api_get_profile_markdown() -> dict:
    """Raw Profile.md text for the Context page editor -- a starter skeleton
    when no profile exists yet, so it can be written by hand without a CV."""
    exists = profile_exists()
    return {
        "text": read_profile_markdown() if exists else profile_skeleton_markdown(),
        "exists": exists,
        "path": str(PROFILE_PATH),
    }


@app.put("/api/profile/markdown")
def api_put_profile_markdown(body: ProfileMarkdownBody) -> dict:
    try:
        save_profile_markdown(body.text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return api_get_profile_markdown()


def _resume_text_for(cv_name: str | None) -> str:
    name = cv_name or get_primary_cv_name()
    if not name:
        raise HTTPException(status_code=400, detail="No CV available -- upload one first.")
    text = read_cv_text(name)
    if not text:
        raise HTTPException(status_code=400, detail=f"'{name}' has no extracted text (scanned PDF?).")
    return text


def _raw_profile() -> dict:
    """The profile as stored -- unlike load_profile(), the summary keeps its
    "<!-- ... -->" template hints so a rewrite doesn't drop them."""
    return parse_profile_markdown(read_profile_markdown()) if profile_exists() else {}


@app.post("/api/profile/extract")
def api_extract_profile(body: ProfileExtractBody) -> dict:
    if get_tier() < 2:
        raise HTTPException(status_code=400, detail=_NEEDS_LLM_KEY_DETAIL)

    resume_text = _resume_text_for(body.cv_name)
    extracted = extract_profile_fields(resume_text)
    save_profile(apply_profile_extraction(_raw_profile(), extracted))
    return load_profile()


@app.put("/api/knowledge-base")
def api_put_knowledge_base(body: KnowledgeBaseBody) -> dict:
    profile = _raw_profile()
    profile["knowledge_base_dir"] = body.dir.strip()
    save_profile(profile)
    return get_context_status()


@app.post("/api/search/suggest")
def api_suggest_search(body: SearchSuggestBody) -> dict:
    if get_tier() < 2:
        raise HTTPException(status_code=400, detail=_NEEDS_LLM_KEY_DETAIL)

    resume_text = _resume_text_for(body.cv_name)
    profile = load_profile() if profile_exists() else {}
    return suggest_search_config(resume_text, profile)


# Every key the LLM provider can come from (llm._detect_provider). Saving
# from the dashboard always writes the generic LLM_URL / LLM_API_KEY /
# LLM_MODEL trio and drops the older provider-specific keys.
_LLM_ENV_KEYS = ("GEMINI_API_KEY", "OPENAI_API_KEY", "LLM_URL", "LLM_API_KEY", "LLM_MODEL")


def _current_llm_config() -> tuple[str, str, str]:
    """(url, model, api_key) the app is using now, or blanks if none."""
    load_env()
    try:
        return llm._detect_provider()
    except RuntimeError:
        return "", "", ""


def _mask_secret(value: str) -> str:
    """Only the last 4 characters ever leave the server, so a form can show
    which key is saved without exposing it."""
    if not value:
        return ""
    return "*" * 12 + (value[-4:] if len(value) > 8 else "")


def _write_env_keys(remove: tuple[str, ...], values: dict[str, str]) -> None:
    """Rewrite ~/.applypilot/.env: drop every key in `remove`, then append the
    non-empty `values`. All other lines (other services' keys) are kept."""
    kept = []
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            if "=" in line and line.split("=", 1)[0].strip() in remove:
                continue
            kept.append(line)
    for key in remove:
        os.environ.pop(key, None)

    lines = [line for line in kept if line.strip()] or ["# ApplyPilot configuration"]
    lines.append("")
    lines += [f"{key}={value}" for key, value in values.items() if value]
    lines.append("")

    ensure_dirs()
    ENV_PATH.write_text("\n".join(lines), encoding="utf-8")
    load_env()


@app.get("/api/setup/env")
def api_get_setup_env() -> dict:
    url, model, api_key = _current_llm_config()
    return {"url": url, "model": model, "has_api_key": bool(api_key), "api_key_masked": _mask_secret(api_key)}


@app.post("/api/setup/env")
def api_setup_env(body: SetupEnvBody) -> dict:
    url, model = body.url.strip().rstrip("/"), body.model.strip()
    if not url:
        raise HTTPException(status_code=400, detail="LLM URL is required")
    if not model:
        raise HTTPException(status_code=400, detail="Model is required")
    api_key = body.api_key.strip() or _current_llm_config()[2]

    _write_env_keys(_LLM_ENV_KEYS, {"LLM_URL": url, "LLM_MODEL": model, "LLM_API_KEY": api_key})
    llm.reset_client()
    return get_context_status()


class JevKeyBody(BaseModel):
    api_key: str


@app.get("/api/setup/jev")
def api_get_setup_jev() -> dict:
    load_env()
    key = os.environ.get("TYPESAFE_API_KEY", "")
    return {"has_api_key": bool(key), "api_key_masked": _mask_secret(key)}


@app.put("/api/setup/jev")
def api_put_setup_jev(body: JevKeyBody) -> dict:
    """Set the TypeSafe key (jev apply engine). Blank removes it, which sends
    auto-apply back to the Claude Code engine."""
    _write_env_keys(("TYPESAFE_API_KEY",), {"TYPESAFE_API_KEY": body.api_key.strip()})
    return api_get_setup_jev()


@app.post("/api/setup/llm-test")
def api_test_llm() -> dict:
    """Send one tiny prompt to the saved LLM provider and report the result."""
    load_env()
    return llm.test_connection()


@app.post("/api/setup/jev-test")
def api_test_jev() -> dict:
    """Send one minimal request to TypeSafe (the jev apply engine's API)."""
    from applypilot.apply.jev.model import test_connection

    load_env()
    return test_connection()


@app.get("/api/jobs/{url:path}")
def get_job(url: str) -> dict:
    """Fetch one job's full detail, including full_description.

    Used by the preview panel -- list/search results omit full_description
    to keep page payloads small, so the panel fetches it here on open.
    Registered after the more specific /cover-letter routes above so those
    match first (this path pattern would otherwise swallow them too).
    """
    conn = get_connection()
    row = conn.execute("SELECT * FROM jobs WHERE url = ?", (url,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    job = dict(zip(row.keys(), row))
    out = {field: job.get(field) for field in _JOB_DETAIL_FIELDS}
    out["dismissed"] = bool(out.get("dismissed"))
    out["starred"] = bool(out.get("starred"))
    out["stage"] = compute_stage(job)
    return out


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


def _public_search_config(cfg: SearchYamlConfig) -> dict:
    """Shape a full searches.yaml config down to the fields the web editor manages."""
    return {
        "queries": [q.model_dump() for q in cfg.queries],
        "locations": [loc.model_dump() for loc in cfg.locations],
        "exclude_titles": cfg.exclude_titles,
        "boards": cfg.boards,
        "defaults": {
            "results_per_site": cfg.defaults.results_per_site,
            "hours_old": cfg.defaults.hours_old,
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


class PromptsBody(BaseModel):
    cover_letter: str = ""
    tailoring: str = ""
    scoring: str = ""


def _effective_prompts() -> dict:
    """Shape the live prompts (~/.applypilot/prompts/*.md) into the Settings-page payload."""
    prompts = load_prompts()
    return {
        key: {
            "text": text,
            "default": get_prompt_seed(key),
            "is_custom": text != get_prompt_seed(key),
        }
        for key, text in prompts.items()
    }


@app.get("/api/prompts")
def get_prompts() -> dict:
    return _effective_prompts()


@app.put("/api/prompts")
def put_prompts(body: PromptsBody) -> dict:
    save_prompts(body.model_dump())
    return _effective_prompts()


@app.post("/api/search/run", status_code=202)
def run_search() -> dict:
    # The chained discover -> enrich -> score run needs an LLM key (Tier 2)
    # even though "discover" alone would work at Tier 1.
    if get_tier() < 2:
        raise HTTPException(
            status_code=400,
            detail=(
                "Search now includes AI scoring and requires an LLM API key. "
                "Set it on the Context page, or set GEMINI_API_KEY / OPENAI_API_KEY / LLM_URL."
            ),
        )

    started = search_state.start_search()
    if not started:
        raise HTTPException(status_code=409, detail="A search is already running")

    return search_state.get_status()


@app.get("/api/search/status")
def get_search_status() -> dict:
    return search_state.get_status()


@app.get("/api/search/new-jobs")
def get_search_new_jobs() -> list[dict]:
    """Full job records (title, fit score, etc.) for the most recently
    completed run's newly-found jobs -- backs the overview page's results
    list. Ordered by fit score so the best matches surface first."""
    urls = search_state.get_new_urls()
    if not urls:
        return []

    conn = get_connection()
    placeholders = ",".join("?" for _ in urls)
    rows = conn.execute(
        f"SELECT * FROM jobs WHERE url IN ({placeholders}) ORDER BY fit_score DESC", urls
    ).fetchall()
    if not rows:
        return []

    columns = rows[0].keys()
    jobs = [dict(zip(columns, row)) for row in rows]

    result = []
    for job in jobs:
        out = {field: job.get(field) for field in _JOB_LIST_FIELDS}
        out["dismissed"] = bool(out.get("dismissed"))
        out["starred"] = bool(out.get("starred"))
        out["stage"] = compute_stage(job)
        result.append(out)
    return result


@app.post("/api/search/discard-new")
def discard_new_search_results() -> dict:
    """Delete the jobs newly found by the most recently completed run,
    leaving everything else in the DB untouched."""
    deleted = search_state.discard_new_jobs()
    return {"deleted": deleted}


@app.post("/api/search/confirm")
def confirm_new_search_results() -> dict:
    """Acknowledge the most recently completed run's new jobs. They're
    already saved (discovery writes straight to the DB) -- this just closes
    the window for discarding them."""
    search_state.confirm_new_jobs()
    return {"ok": True}


class JobFilterBody(BaseModel):
    """Same filters as GET /api/jobs/search (job_type/user_action/discovered
    range/score/starred) -- lets the status-check scan operate on exactly
    the set of jobs the user has filtered the table down to, rather than a
    separate ad hoc scope."""

    q: str = ""
    job_type: list[str] = []
    job_type_mode: str = "is"
    user_action: list[str] = []
    user_action_mode: str = "is"
    include_dismissed: bool = False
    starred_only: bool = False
    discovered_after: str | None = None
    discovered_before: str | None = None
    score_min: int | None = None
    score_max: int | None = None


def _status_check_candidates(body: JobFilterBody) -> list[dict]:
    """Jobs matching the given filters, narrowed to ones worth rechecking --
    not yet applied to, and not already marked closed."""
    conn = get_connection()
    jobs, _ = search_jobs(
        conn,
        q=body.q,
        job_type=body.job_type,
        job_type_mode=body.job_type_mode,
        user_action=body.user_action,
        user_action_mode=body.user_action_mode,
        include_dismissed=body.include_dismissed,
        starred_only=body.starred_only,
        discovered_after=body.discovered_after,
        discovered_before=body.discovered_before,
        score_min=body.score_min,
        score_max=body.score_max,
        sort_by="discovered_at",
        sort_dir="desc",
        page=1,
        page_size=100_000,
    )
    return [j for j in jobs if not j.get("applied_at") and j.get("user_action") != "closed"]


@app.post("/api/status-check/candidates")
def preview_status_check_candidates(body: JobFilterBody) -> dict:
    """How many jobs would this scan actually check -- shown before the user
    commits, since the filters can match more jobs than are actually
    pending (already-applied/closed jobs are silently excluded)."""
    return {"count": len(_status_check_candidates(body))}


@app.post("/api/status-check/run", status_code=202)
def run_status_check(body: JobFilterBody) -> dict:
    """Rechecks pending jobs matching the given filters and marks any that
    have closed. Playwright-only, no LLM call -- unlike /api/search/run,
    this needs no tier check."""
    candidates = _status_check_candidates(body)
    jobs = [{"url": j["url"], "title": j.get("title"), "company": j.get("company")} for j in candidates]

    if not status_check_state.start_status_check(jobs):
        raise HTTPException(status_code=409, detail="A status check is already running")

    return status_check_state.get_status()


@app.get("/api/status-check/status")
def get_status_check_status() -> dict:
    return status_check_state.get_status()


@app.post("/api/status-check/cancel")
def cancel_status_check() -> dict:
    return {"cancelled": status_check_state.cancel()}


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
