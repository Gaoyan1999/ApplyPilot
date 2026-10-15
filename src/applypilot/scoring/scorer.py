"""Job fit scoring: LLM-powered evaluation of candidate-job match quality.

Grades jobs green / yellow / red by comparing the user's resume, plus relevant
fields from the user's profile (work authorization, location, availability,
etc.), against each job description. All personal data is loaded at runtime
from the user's profile and resume file.
"""

import json
import logging
import re
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from applypilot.config import get_primary_resume_text, load_profile, load_prompts
from applypilot.database import get_connection, get_jobs_by_stage, score_from_grade
from applypilot.llm import get_client

log = logging.getLogger(__name__)

# Cap on the combined knowledge-base context, mirroring the job description
# truncation below -- folder summaries are expected to stay well under this
# on their own; this is just a safety net.
KNOWLEDGE_BASE_CHAR_LIMIT = 6000


# ── Scoring Prompt ────────────────────────────────────────────────────────

def _build_score_prompt(template: str) -> str:
    """Build the job fit scoring prompt.

    The rubric comes from `template` -- the live text in
    ~/.applypilot/prompts/scoring.md (see config.load_prompts). The
    response-format contract is always appended by code, regardless of the
    template, since it can't be edited away without breaking
    `_parse_score_response`.
    """
    return f"""You are a job fit evaluator. Given a candidate's resume and a job description, grade how well the candidate fits the role.

{template}

RESPOND IN EXACTLY THIS FORMAT (no other text):
GRADE: [GREEN, YELLOW or RED]
KEYWORDS: [comma-separated ATS keywords from the job description that match or could match the candidate]
CRITERIA: [One requirement per line, each prefixed with MET or GAP followed by " | " then a short (under 10 words) label naming that specific requirement. List the 2-5 requirements that most drove the grade -- the ones a candidate would actually want to know about, not every minor detail. Example:
MET | 5+ years backend engineering
MET | Python & distributed systems
GAP | No healthcare/HIPAA domain experience]"""


def _build_candidate_context(profile: dict) -> str:
    """Format the user's profile as extra context for the LLM scorer.

    Resume text alone doesn't carry structured facts a job posting's stated
    requirements might hinge on -- citizenship/PR/visa status, location,
    availability, salary range -- so without this the LLM has no way to
    check those requirements against the candidate at all.

    `personal.password` is a credential and never belongs in an LLM prompt.
    `eeo_voluntary` (gender, race, veteran/disability status) is excluded on
    principle: those are protected characteristics and must never factor
    into a job-fit grade.
    """
    excluded_sections = {"eeo_voluntary"}
    lines = []
    for section, fields in profile.items():
        if section in excluded_sections or not isinstance(fields, dict):
            continue
        for key, value in fields.items():
            if section == "personal" and key == "password":
                continue
            if isinstance(value, list):
                value = ", ".join(str(v) for v in value)
            if not value:
                continue
            lines.append(f"{key.replace('_', ' ')}: {value}")
    if profile.get("summary"):
        lines.append(f"summary:\n{profile['summary']}")
    return "\n".join(lines)


def _load_knowledge_base(kb_dir: str) -> str:
    """Load folder-level summaries from the user's personal knowledge base.

    The knowledge base is a set of Markdown notes (e.g. an Obsidian vault
    folder) organized as topic subfolders -- projects, courses, prepared
    interview answers, etc. -- documenting things a resume and profile.md
    are too compact to hold. Rather than reading every note (unbounded,
    grows without limit), only each subfolder's own `index.md` is read: a
    short, hand-maintained summary of what that folder contains. New
    subfolders are picked up automatically as long as they have an
    `index.md`.

    Returns "" if `kb_dir` is unset or doesn't exist -- the knowledge base
    is opt-in, same as `candidate_context` in `score_job`.
    """
    if not kb_dir:
        return ""
    base = Path(kb_dir)
    if not base.is_dir():
        return ""

    sections = []
    for index_path in sorted(base.glob("*/index.md")):
        raw = index_path.read_text(encoding="utf-8")
        # Strip HTML comments -- unfilled template placeholders (e.g. an
        # index.md the user hasn't written a real summary into yet) are
        # authored as "<!-- ... -->" instructions to the human, not content
        # for the LLM. Without this, an empty folder still injects its
        # placeholder prompt text as if it were real signal.
        content = re.sub(r"<!--.*?-->", "", raw, flags=re.DOTALL).strip()
        # A folder whose index.md is still just the template skeleton
        # (frontmatter + headings, no prose written in) has nothing to
        # say -- skip it entirely rather than adding an empty section.
        body = re.sub(r"^---\n.*?\n---\n", "", content, flags=re.DOTALL)
        body = re.sub(r"^#{1,6}.*$", "", body, flags=re.MULTILINE).strip()
        if body:
            sections.append(f"## {index_path.parent.name}\n{content}")

    return "\n\n".join(sections)[:KNOWLEDGE_BASE_CHAR_LIMIT]


def _parse_score_response(response: str) -> dict:
    """Parse the LLM's score response into structured data.

    Args:
        response: Raw LLM response text.

    Returns:
        {"grade": "green" | "yellow" | "red" | None, "keywords": str,
         "met": list[str], "gaps": list[str]}. grade is None when the
        response has no recognizable GRADE line.
    """
    grade = None
    keywords = ""
    met: list[str] = []
    gaps: list[str] = []
    in_criteria = False

    for raw_line in response.split("\n"):
        line = raw_line.strip()
        if line.startswith("GRADE:"):
            in_criteria = False
            match = re.search(r"\b(GREEN|YELLOW|RED)\b", line.upper())
            grade = match.group(1).lower() if match else None
        elif line.startswith("KEYWORDS:"):
            in_criteria = False
            keywords = line.replace("KEYWORDS:", "").strip()
        elif line.startswith("CRITERIA:"):
            in_criteria = True
            line = line.replace("CRITERIA:", "").strip()
            if not line:
                continue
        if in_criteria and "|" in line:
            label, _, text = line.partition("|")
            label = label.strip().upper()
            text = text.strip()
            if not text:
                continue
            if label == "MET":
                met.append(text)
            elif label == "GAP":
                gaps.append(text)

    return {"grade": grade, "keywords": keywords, "met": met, "gaps": gaps}


def score_job(
    resume_text: str,
    job: dict,
    score_prompt: str,
    candidate_context: str = "",
    knowledge_base: str = "",
) -> dict:
    """Score a single job against the resume.

    Args:
        resume_text: The candidate's full resume text.
        job: Job dict with keys: title, site, location, full_description.
        score_prompt: The scoring system prompt, built once per batch via
            _build_score_prompt() (includes any Settings-page override).
        candidate_context: Formatted profile fields (work authorization,
            location, availability, etc.) via _build_candidate_context().
            Optional so callers that don't have a profile loaded (e.g. quick
            ad-hoc scoring) still work.
        knowledge_base: Folder-level summaries from the user's personal
            knowledge base via _load_knowledge_base(). Optional, same as
            candidate_context.

    Returns:
        Same shape as _parse_score_response(); grade is None on LLM error.
    """
    job_text = (
        f"TITLE: {job['title']}\n"
        f"COMPANY: {job.get('company') or 'the company'}\n"
        f"LOCATION: {job.get('location', 'N/A')}\n\n"
        f"DESCRIPTION:\n{(job.get('full_description') or '')[:6000]}"
    )

    user_content = f"RESUME:\n{resume_text}"
    if candidate_context:
        user_content += f"\n\nCANDIDATE PROFILE:\n{candidate_context}"
    if knowledge_base:
        user_content += f"\n\nKNOWLEDGE BASE:\n{knowledge_base}"
    user_content += f"\n\n---\n\nJOB POSTING:\n{job_text}"

    messages = [
        {"role": "system", "content": score_prompt},
        {"role": "user", "content": user_content},
    ]

    try:
        client = get_client()
        response = client.chat(messages, max_tokens=512, temperature=0.2)
        return _parse_score_response(response)
    except Exception as e:
        log.error("LLM error scoring job '%s': %s", job.get("title", "?"), e)
        return {"grade": None, "keywords": "", "met": [], "gaps": [f"LLM error: {e}"]}


def run_scoring(
    limit: int = 0,
    rescore: bool = False,
    on_progress: Callable[[dict], None] | None = None,
    on_warning: Callable[[str], None] | None = None,
) -> dict:
    """Score unscored jobs that have full descriptions.

    Args:
        limit: Maximum number of jobs to score in this run.
        rescore: If True, re-score all jobs (not just unscored ones).
        on_progress: Optional callback invoked after every job with
            {"done": int, "total": int}.
        on_warning: Optional callback invoked when the LLM call for a job
            fails (after its own internal retries -- see `llm.py`). The job
            is left ungraded and the run continues; this just reports it.

    Returns:
        {"scored": int, "errors": int, "elapsed": float, "distribution": list}
    """
    resume_text = get_primary_resume_text()
    profile = load_profile()
    candidate_context = _build_candidate_context(profile)
    knowledge_base = _load_knowledge_base(profile.get("knowledge_base_dir", ""))
    conn = get_connection()

    if rescore:
        query = "SELECT * FROM jobs WHERE full_description IS NOT NULL"
        if limit > 0:
            query += f" LIMIT {limit}"
        jobs = conn.execute(query).fetchall()
    else:
        jobs = get_jobs_by_stage(conn=conn, stage="pending_score", limit=limit)

    if not jobs:
        log.info("No unscored jobs with descriptions found.")
        return {"scored": 0, "errors": 0, "elapsed": 0.0, "distribution": []}

    # Convert sqlite3.Row to dicts if needed
    if jobs and not isinstance(jobs[0], dict):
        columns = jobs[0].keys()
        jobs = [dict(zip(columns, row)) for row in jobs]

    log.info("Scoring %d jobs sequentially...", len(jobs))
    t0 = time.time()
    completed = 0
    errors = 0
    results: list[dict] = []
    prompts = load_prompts()
    score_prompt = _build_score_prompt(prompts["scoring"])

    for job in jobs:
        result = score_job(resume_text, job, score_prompt, candidate_context, knowledge_base)
        result["url"] = job["url"]
        completed += 1

        # Save each grade as soon as it's in, so the jobs table fills in live
        # (the web search rates jobs while discovery is still running) and a
        # crash mid-run doesn't throw away the grades already paid for.
        # score_reasoning stores JSON: {"met": [...], "gaps": [...]} so the UI
        # can render a checklist instead of a free-text sentence.
        conn.execute(
            "UPDATE jobs SET fit_score = ?, fit_grade = ?, score_reasoning = ?, scored_at = ? WHERE url = ?",
            (
                score_from_grade(result["grade"]),
                result["grade"],
                json.dumps({"met": result["met"], "gaps": result["gaps"]}),
                datetime.now(timezone.utc).isoformat(),
                result["url"],
            ),
        )
        conn.commit()

        if result["grade"] is None:
            errors += 1
            gaps = result.get("gaps") or []
            if on_warning and gaps and gaps[0].startswith("LLM error:"):
                on_warning(f"Scoring failed for '{job.get('title', '?')[:60]}': {gaps[0]}")

        results.append(result)

        log.info(
            "[%d/%d] grade=%s  %s",
            completed, len(jobs), result["grade"] or "-", job.get("title", "?")[:60],
        )
        if on_progress:
            on_progress({"done": completed, "total": len(jobs)})

    elapsed = time.time() - t0
    log.info("Done: %d scored in %.1fs (%.1f jobs/sec)", len(results), elapsed, len(results) / elapsed if elapsed > 0 else 0)

    # Grade distribution
    dist = conn.execute("""
        SELECT fit_grade, COUNT(*) FROM jobs
        WHERE fit_grade IS NOT NULL
        GROUP BY fit_grade
    """).fetchall()
    distribution = [(row[0], row[1]) for row in dist]

    return {
        "scored": len(results),
        "errors": errors,
        "elapsed": elapsed,
        "distribution": distribution,
    }
