"""Job fit scoring: LLM-powered evaluation of candidate-job match quality.

Scores jobs on a 1-10 scale by comparing the user's resume against each
job description. All personal data is loaded at runtime from the user's
profile and resume file.
"""

import json
import logging
import re
import time
from collections.abc import Callable
from datetime import datetime, timezone

from applypilot.config import RESUME_PATH, load_profile, load_prompt_overrides
from applypilot.database import get_connection, get_jobs_by_stage
from applypilot.llm import get_client

log = logging.getLogger(__name__)


# ── Scoring Prompt ────────────────────────────────────────────────────────

# The user-editable part of the scoring prompt (the fit rubric). Customizable
# from the Settings page; falls back to this default when no override is
# stored. The response-format contract is always appended by code (see
# _build_score_prompt) since _parse_score_response depends on it exactly.
DEFAULT_SCORING_TEMPLATE = """SCORING CRITERIA:
- 9-10: Perfect match. Candidate has direct experience in nearly all required skills and qualifications.
- 7-8: Strong match. Candidate has most required skills, minor gaps easily bridged.
- 5-6: Moderate match. Candidate has some relevant skills but missing key requirements.
- 3-4: Weak match. Significant skill gaps, would need substantial ramp-up.
- 1-2: Poor match. Completely different field or experience level.

IMPORTANT FACTORS:
- Weight technical skills heavily (programming languages, frameworks, tools)
- Consider transferable experience (automation, scripting, API work)
- Factor in the candidate's project experience
- Be realistic about experience level vs. job requirements (years of experience, seniority)"""


def _build_score_prompt(template: str | None = None) -> str:
    """Build the job fit scoring prompt.

    The rubric comes from `template` (a Settings-page override) if given,
    else DEFAULT_SCORING_TEMPLATE. The response-format contract is always
    appended by code, regardless of the template, since it can't be edited
    away without breaking `_parse_score_response`.
    """
    rubric = template or DEFAULT_SCORING_TEMPLATE
    return f"""You are a job fit evaluator. Given a candidate's resume and a job description, score how well the candidate fits the role.

{rubric}

RESPOND IN EXACTLY THIS FORMAT (no other text):
SCORE: [1-10]
KEYWORDS: [comma-separated ATS keywords from the job description that match or could match the candidate]
REASONING: [One concise sentence, no filler. If the score is low, name the specific gap causing it -- you may briefly credit a relevant strength first (e.g. with an em dash), but end on the actual disqualifying reason, not a vague summary. Example: "Strong full-stack engineering experience -- especially in TypeScript, Java, Vue/React, and AI-integrated document systems -- but lacks the 5+ years of professional Python experience on large distributed systems this role requires." If the score is high, just state why the candidate fits -- don't dwell on minor gaps.]"""


def _parse_score_response(response: str) -> dict:
    """Parse the LLM's score response into structured data.

    Args:
        response: Raw LLM response text.

    Returns:
        {"score": int, "keywords": str, "reasoning": str}
    """
    score = 0
    keywords = ""
    reasoning = response

    for line in response.split("\n"):
        line = line.strip()
        if line.startswith("SCORE:"):
            try:
                score = int(re.search(r"\d+", line).group())
                score = max(1, min(10, score))
            except (AttributeError, ValueError):
                score = 0
        elif line.startswith("KEYWORDS:"):
            keywords = line.replace("KEYWORDS:", "").strip()
        elif line.startswith("REASONING:"):
            reasoning = line.replace("REASONING:", "").strip()

    return {"score": score, "keywords": keywords, "reasoning": reasoning}


def score_job(resume_text: str, job: dict, score_prompt: str) -> dict:
    """Score a single job against the resume.

    Args:
        resume_text: The candidate's full resume text.
        job: Job dict with keys: title, site, location, full_description.
        score_prompt: The scoring system prompt, built once per batch via
            _build_score_prompt() (includes any Settings-page override).

    Returns:
        {"score": int, "keywords": str, "reasoning": str}
    """
    job_text = (
        f"TITLE: {job['title']}\n"
        f"COMPANY: {job.get('company') or 'the company'}\n"
        f"LOCATION: {job.get('location', 'N/A')}\n\n"
        f"DESCRIPTION:\n{(job.get('full_description') or '')[:6000]}"
    )

    messages = [
        {"role": "system", "content": score_prompt},
        {"role": "user", "content": f"RESUME:\n{resume_text}\n\n---\n\nJOB POSTING:\n{job_text}"},
    ]

    try:
        client = get_client()
        response = client.chat(messages, max_tokens=512, temperature=0.2)
        return _parse_score_response(response)
    except Exception as e:
        log.error("LLM error scoring job '%s': %s", job.get("title", "?"), e)
        return {"score": 0, "keywords": "", "reasoning": f"LLM error: {e}"}


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
            is still scored 0 and the run continues; this just reports it.

    Returns:
        {"scored": int, "errors": int, "elapsed": float, "distribution": list}
    """
    resume_text = RESUME_PATH.read_text(encoding="utf-8")
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
    overrides = load_prompt_overrides()
    score_prompt = _build_score_prompt(overrides.get("scoring"))

    for job in jobs:
        result = score_job(resume_text, job, score_prompt)
        result["url"] = job["url"]
        completed += 1

        if result["score"] == 0:
            errors += 1
            if on_warning and result.get("reasoning", "").startswith("LLM error:"):
                on_warning(f"Scoring failed for '{job.get('title', '?')[:60]}': {result['reasoning']}")

        results.append(result)

        log.info(
            "[%d/%d] score=%d  %s",
            completed, len(jobs), result["score"], job.get("title", "?")[:60],
        )
        if on_progress:
            on_progress({"done": completed, "total": len(jobs)})

    # Write scores to DB
    now = datetime.now(timezone.utc).isoformat()
    for r in results:
        conn.execute(
            "UPDATE jobs SET fit_score = ?, score_reasoning = ?, scored_at = ? WHERE url = ?",
            (r["score"], f"{r['keywords']}\n{r['reasoning']}", now, r["url"]),
        )
    conn.commit()

    elapsed = time.time() - t0
    log.info("Done: %d scored in %.1fs (%.1f jobs/sec)", len(results), elapsed, len(results) / elapsed if elapsed > 0 else 0)

    # Score distribution
    dist = conn.execute("""
        SELECT fit_score, COUNT(*) FROM jobs
        WHERE fit_score IS NOT NULL
        GROUP BY fit_score ORDER BY fit_score DESC
    """).fetchall()
    distribution = [(row[0], row[1]) for row in dist]

    return {
        "scored": len(results),
        "errors": errors,
        "elapsed": elapsed,
        "distribution": distribution,
    }
