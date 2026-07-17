"""Cover letter generation: LLM-powered, profile-driven, with validation.

Generates concise, engineering-voice cover letters tailored to specific job
postings. All personal data (name, skills, achievements) comes from the user's
profile at runtime. No hardcoded personal information.
"""

import json
import logging
import re
import time
from datetime import datetime, timezone

from applypilot.config import COVER_LETTER_DIR, RESUME_PATH, load_profile, load_prompt_overrides
from applypilot.database import get_connection, get_jobs_by_stage
from applypilot.llm import get_client
from applypilot.scoring.validator import (
    BANNED_WORDS,
    LLM_LEAK_PHRASES,
    sanitize_text,
    validate_cover_letter,
)

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 5  # max cross-run retries before giving up


# ── Prompt Builder (profile-driven) ──────────────────────────────────────

# The user-editable part of the cover letter prompt (paragraph structure +
# voice). Customizable from the Settings page; falls back to this default
# when no override is stored. Placeholder tokens {{SCHOOL_HINT}},
# {{PROJECTS_HINT}}, {{METRICS_HINT}} are substituted with real profile data
# via plain string replacement (not str.format) so arbitrary user-edited text
# containing literal braces can't break substitution.
DEFAULT_COVER_LETTER_TEMPLATE = """STRUCTURE: 4 paragraphs. Under 300 words total. Every sentence must earn its place.

PARAGRAPH 1 — INTRO (2-3 sentences, reusable across applications): State who you are (school + field of study, from the resume), the exact role you're applying for, and one genuine reason this kind of work interests you. Keep this paragraph company-agnostic — it should read fine unchanged in a different application.{{SCHOOL_HINT}}

PARAGRAPH 2 — WHY THIS COMPANY (2-3 sentences, THE MOST IMPORTANT PARAGRAPH — this is what makes it not a mass-produced letter): Reference ONE specific, real detail pulled from the job description below — a product, a technical challenge, a team, an engineering practice, a stated priority — and say why it pulls you in. Every claim here must be traceable to something actually stated in the job description. If you can't find a specific detail to anchor on, pick the most concrete thing available rather than writing something generic.
NEVER use empty praise like "global impact," "prestigious," "industry leader," "great culture," or similar — these have no content and read as mass-produced.

PARAGRAPH 3 — WHY YOU (3-4 sentences): Pick TWO strengths and back each with ONE concrete example from the resume, most relevant to this job. Use real numbers.{{PROJECTS_HINT}}{{METRICS_HINT}} Do not just restate the resume. For each example, say what it demonstrates: the transferable skill, the impact you made, how you approached the problem, or how you drove the outcome.

PARAGRAPH 4 — CLOSING (1-2 sentences): Thank them for their time, state genuine interest in the role, and say you look forward to hearing from them. Confident and brief. Nothing else after this.

VOICE:
- Write like a real engineer emailing someone they respect. Not formal, not casual. Just direct.
- NEVER narrate or explain what you're doing. BAD: "This demonstrates my commitment to X." GOOD: Just state the fact and move on.
- NEVER hedge. BAD: "might address some of your challenges." GOOD: "solves the same problem your team is facing."
- Every sentence should contain either a number, a tool name, a company/product detail, or a specific outcome. If it doesn't, cut it.
- Read it out loud. If it sounds like a robot wrote it, rewrite it."""


def _build_cover_letter_prompt(profile: dict, template: str | None = None) -> str:
    """Build the cover letter system prompt from the user's profile.

    All personal data, skills, and sign-off name come from the profile. The
    paragraph-structure/voice portion comes from `template` (a Settings-page
    override) if given, else DEFAULT_COVER_LETTER_TEMPLATE. Banned words,
    the fabrication guard, and the output/sign-off contract are always
    appended by code, regardless of the template, so they can't be edited
    away.
    """
    personal = profile.get("personal", {})
    boundary = profile.get("skills_boundary", {})
    resume_facts = profile.get("resume_facts", {})

    # Preferred name for the sign-off (falls back to full name)
    sign_off_name = personal.get("preferred_name") or personal.get("full_name", "")

    # Flatten all allowed skills
    all_skills: list[str] = []
    for items in boundary.values():
        if isinstance(items, list):
            all_skills.extend(items)
    skills_str = ", ".join(all_skills) if all_skills else "the tools listed in the resume"

    # Real metrics from resume_facts
    real_metrics = resume_facts.get("real_metrics", [])
    preserved_projects = resume_facts.get("preserved_projects", [])

    # Build achievement examples for the prompt
    projects_hint = ""
    if preserved_projects:
        projects_hint = f"\nKnown projects to reference: {', '.join(preserved_projects)}"

    metrics_hint = ""
    if real_metrics:
        metrics_hint = f"\nReal metrics to use: {', '.join(real_metrics)}"

    # Build the full banned list from the validator so the prompt stays in sync
    # with what will actually be rejected — the validator checks all of these.
    all_banned = ", ".join(f'"{w}"' for w in BANNED_WORDS)
    leak_banned = ", ".join(f'"{p}"' for p in LLM_LEAK_PHRASES)

    # Education line for paragraph 1 (school only — major/field comes from the
    # resume text itself, which the model sees in the user message).
    preserved_school = resume_facts.get("preserved_school", "")
    school_hint = f"\nSchool to reference: {preserved_school}" if preserved_school else ""

    structure_section = (
        (template or DEFAULT_COVER_LETTER_TEMPLATE)
        .replace("{{SCHOOL_HINT}}", school_hint)
        .replace("{{PROJECTS_HINT}}", projects_hint)
        .replace("{{METRICS_HINT}}", metrics_hint)
    )

    return f"""Write a cover letter for {sign_off_name}. The goal is to get an interview.

{structure_section}

BANNED WORDS AND PHRASES (automated validator rejects ANY of these — do not use even once):
{all_banned}

ALSO BANNED (meta-commentary the validator catches):
{leak_banned}

BANNED PUNCTUATION: No em dashes (—) or en dashes (–). Use commas or periods.

FABRICATION = INSTANT REJECTION:
The candidate's real tools are ONLY: {skills_str}.
Do NOT mention ANY tool not in this list. If the job asks for tools not listed, talk about the work you did, not the tools.
Do NOT invent a recruiter's name, a person you spoke with, or any company detail not present in the job description below.

Sign off: just "{sign_off_name}"

Output ONLY the letter body — no date, no address block, no subject line, no "Here is the cover letter:" preamble, no notes after the sign-off. The date and any header formatting are added separately, outside your output.
Start DIRECTLY with "Dear Hiring Manager," and end with the name."""


# ── Helpers ──────────────────────────────────────────────────────────────

def _strip_preamble(text: str) -> str:
    """Remove LLM preamble before 'Dear Hiring Manager,' if present.

    Gemini and other models sometimes output "Here is the cover letter:" or
    similar meta-commentary before the actual letter text. Strip everything
    before the first occurrence of "Dear" so the validator's start-check passes.
    """
    dear_idx = text.lower().find("dear")
    if dear_idx > 0:
        return text[dear_idx:]
    return text


def _with_header_footer(letter: str, profile: dict) -> str:
    """Add the date above the letter and a contact line below the sign-off.

    Both are assembled from real data (today's date, the profile's own
    contact info) rather than generated by the LLM, so there's no risk of it
    inventing a recruiter's name or a company address it doesn't actually
    know. The greeting stays "Dear Hiring Manager," since no real recruiter
    name is available to the pipeline.
    """
    date_str = datetime.now(timezone.utc).strftime("%B %d, %Y")
    letter = f"{date_str}\n\n{letter}"

    personal = profile.get("personal", {})
    contact_parts = [p for p in (personal.get("email"), personal.get("phone")) if p]
    if contact_parts:
        letter = f"{letter}\n{' | '.join(contact_parts)}"

    return letter


# ── Core Generation ──────────────────────────────────────────────────────

def generate_cover_letter(
    resume_text: str, job: dict, profile: dict,
    max_retries: int = 3, validation_mode: str = "normal",
) -> str:
    """Generate a cover letter with fresh context on each retry + auto-sanitize.

    Same design as tailor_resume: fresh conversation per attempt, issues noted
    in the prompt, no conversation history stacking.

    Args:
        resume_text:      The candidate's resume text (base or tailored).
        job:              Job dict with title, site, location, full_description.
        profile:          User profile dict.
        max_retries:      Maximum retry attempts.
        validation_mode:  "strict", "normal", or "lenient".

    Returns:
        The cover letter text (best attempt even if validation failed).
    """
    job_text = (
        f"TITLE: {job['title']}\n"
        f"COMPANY: {job.get('company') or 'the company'}\n"
        f"LOCATION: {job.get('location', 'N/A')}\n\n"
        f"DESCRIPTION:\n{(job.get('full_description') or '')[:6000]}"
    )

    avoid_notes: list[str] = []
    letter = ""
    client = get_client()
    overrides = load_prompt_overrides()
    cl_prompt_base = _build_cover_letter_prompt(profile, overrides.get("cover_letter"))

    for attempt in range(max_retries + 1):
        # Fresh conversation every attempt
        prompt = cl_prompt_base
        if avoid_notes:
            prompt += "\n\n## AVOID THESE ISSUES:\n" + "\n".join(
                f"- {n}" for n in avoid_notes[-5:]
            )

        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": (
                f"RESUME:\n{resume_text}\n\n---\n\n"
                f"TARGET JOB:\n{job_text}\n\n"
                "Write the cover letter:"
            )},
        ]

        letter = client.chat(messages, max_tokens=1024, temperature=0.7)
        letter = sanitize_text(letter)  # auto-fix em dashes, smart quotes
        letter = _strip_preamble(letter)  # remove any "Here is the letter:" prefix

        validation = validate_cover_letter(letter, mode=validation_mode)
        if validation["passed"]:
            return _with_header_footer(letter, profile)

        avoid_notes.extend(validation["errors"])
        # Warnings never block — only hard errors trigger a retry
        log.debug(
            "Cover letter attempt %d/%d failed: %s",
            attempt + 1, max_retries + 1, validation["errors"],
        )

    return _with_header_footer(letter, profile)  # last attempt even if failed


# ── Save Helper (shared by batch + single-job paths) ──────────────────────

def _save_cover_letter(letter: str, job: dict) -> dict:
    """Write a generated letter to .txt + .pdf and return the paths.

    Args:
        letter: Generated cover letter text.
        job:    Job dict (needs "title" and "site" for the filename).

    Returns:
        {"text": str, "path": str, "pdf_path": str | None}
    """
    safe_title = re.sub(r"[^\w\s-]", "", job["title"])[:50].strip().replace(" ", "_")
    safe_site = re.sub(r"[^\w\s-]", "", job["site"])[:20].strip().replace(" ", "_")
    prefix = f"{safe_site}_{safe_title}"

    COVER_LETTER_DIR.mkdir(parents=True, exist_ok=True)
    cl_path = COVER_LETTER_DIR / f"{prefix}_CL.txt"
    cl_path.write_text(letter, encoding="utf-8")

    pdf_path = None
    try:
        from applypilot.scoring.pdf import convert_to_pdf
        pdf_path = str(convert_to_pdf(cl_path))
    except Exception:
        log.debug("PDF generation failed for %s", cl_path, exc_info=True)

    return {"text": letter, "path": str(cl_path), "pdf_path": pdf_path}


# ── Single-Job Entry Point (web dashboard "Generate cover letter" button) ─

def generate_cover_letter_for_job(url: str, validation_mode: str = "normal") -> dict:
    """Generate (or regenerate) a cover letter for one job on demand.

    Same LLM call as the batch path, just scoped to a single job and run
    synchronously so a web request can wait on the result.

    Args:
        url:             Job URL (primary key in the jobs table).
        validation_mode: "strict", "normal", or "lenient".

    Returns:
        {"text": str, "path": str, "pdf_path": str | None, "cover_letter_at": str}

    Raises:
        ValueError: If the job doesn't exist or has no description yet.
    """
    conn = get_connection()
    row = conn.execute("SELECT * FROM jobs WHERE url = ?", (url,)).fetchone()
    if row is None:
        raise ValueError(f"Job not found: {url}")

    job = dict(zip(row.keys(), row))
    if not job.get("full_description"):
        raise ValueError("Job has no description yet — run enrichment first.")

    profile = load_profile()
    resume_text = RESUME_PATH.read_text(encoding="utf-8")

    letter = generate_cover_letter(resume_text, job, profile, validation_mode=validation_mode)
    result = _save_cover_letter(letter, job)

    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE jobs SET cover_letter_path=?, cover_letter_at=?, "
        "cover_attempts=COALESCE(cover_attempts,0)+1 WHERE url=?",
        (result["path"], now, url),
    )
    conn.commit()

    result["cover_letter_at"] = now
    return result


# ── Batch Entry Point ────────────────────────────────────────────────────

def run_cover_letters(min_score: int = 7, limit: int = 20,
                      validation_mode: str = "normal") -> dict:
    """Generate cover letters for high-scoring jobs that have tailored resumes.

    Args:
        min_score:       Minimum fit_score threshold.
        limit:           Maximum jobs to process.
        validation_mode: "strict", "normal", or "lenient".

    Returns:
        {"generated": int, "errors": int, "elapsed": float}
    """
    profile = load_profile()
    resume_text = RESUME_PATH.read_text(encoding="utf-8")
    conn = get_connection()

    # Fetch jobs that have tailored resumes but no cover letter yet
    jobs = conn.execute(
        "SELECT * FROM jobs "
        "WHERE fit_score >= ? AND tailored_resume_path IS NOT NULL "
        "AND full_description IS NOT NULL "
        "AND (cover_letter_path IS NULL OR cover_letter_path = '') "
        "AND COALESCE(cover_attempts, 0) < ? "
        "ORDER BY fit_score DESC LIMIT ?",
        (min_score, MAX_ATTEMPTS, limit),
    ).fetchall()

    if not jobs:
        log.info("No jobs needing cover letters (score >= %d).", min_score)
        return {"generated": 0, "errors": 0, "elapsed": 0.0}

    # Convert rows to dicts
    if jobs and not isinstance(jobs[0], dict):
        columns = jobs[0].keys()
        jobs = [dict(zip(columns, row)) for row in jobs]

    COVER_LETTER_DIR.mkdir(parents=True, exist_ok=True)
    log.info(
        "Generating cover letters for %d jobs (score >= %d)...",
        len(jobs), min_score,
    )
    t0 = time.time()
    completed = 0
    results: list[dict] = []
    error_count = 0

    for job in jobs:
        completed += 1
        try:
            letter = generate_cover_letter(resume_text, job, profile,
                                          validation_mode=validation_mode)
            save_result = _save_cover_letter(letter, job)

            result = {
                "url": job["url"],
                "path": save_result["path"],
                "pdf_path": save_result["pdf_path"],
                "title": job["title"],
                "site": job["site"],
            }
            results.append(result)

            elapsed = time.time() - t0
            rate = completed / elapsed if elapsed > 0 else 0
            log.info(
                "%d/%d [OK] | %.1f jobs/min | %s",
                completed, len(jobs), rate * 60, result["title"][:40],
            )
        except Exception as e:
            result = {
                "url": job["url"], "title": job["title"], "site": job["site"],
                "path": None, "pdf_path": None, "error": str(e),
            }
            error_count += 1
            results.append(result)
            log.error("%d/%d [ERROR] %s -- %s", completed, len(jobs), job["title"][:40], e)

    # Persist to DB: increment attempt counter for ALL, save path only for successes
    now = datetime.now(timezone.utc).isoformat()
    saved = 0
    for r in results:
        if r.get("path"):
            conn.execute(
                "UPDATE jobs SET cover_letter_path=?, cover_letter_at=?, "
                "cover_attempts=COALESCE(cover_attempts,0)+1 WHERE url=?",
                (r["path"], now, r["url"]),
            )
            saved += 1
        else:
            conn.execute(
                "UPDATE jobs SET cover_attempts=COALESCE(cover_attempts,0)+1 WHERE url=?",
                (r["url"],),
            )
    conn.commit()

    elapsed = time.time() - t0
    log.info("Cover letters done in %.1fs: %d generated, %d errors", elapsed, saved, error_count)

    return {
        "generated": saved,
        "errors": error_count,
        "elapsed": elapsed,
    }
