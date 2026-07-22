"""CV selection: pick the best-matching master resume from the user's CV
library for a given job.

This is NOT tailoring -- no resume content is rewritten or generated, only
selected. Follows scorer.py's pattern: one LLM call with a strict response
format, parsed tolerantly, degrading to a safe fallback rather than raising
on any LLM/parse failure.
"""

import logging

from applypilot.config import read_cv_text
from applypilot.llm import get_client

log = logging.getLogger(__name__)

# How much of each CV's extracted text to include per candidate in the
# matching prompt -- enough for the LLM to judge relevance, small enough
# that a handful of CVs stays well within a reasonable token budget.
_CV_TEXT_EXCERPT_CHARS = 1500


def _build_match_prompt(cvs: list[dict]) -> str:
    return f"""You are matching a candidate to the single best resume from their CV library for one job posting.

You will be given a JOB POSTING and a list of CANDIDATE CVs, each with a name and an excerpt of its content. Pick the CV whose content best fits the job. If none of them are a great fit, still pick the closest one -- you must always choose one.

Known CV names: {", ".join(cv["name"] for cv in cvs)}

RESPOND IN EXACTLY THIS FORMAT (no other text):
CV: [exact name of the chosen CV, copied verbatim from the list above]
REASONING: [one concise sentence on why this CV fits best]"""


def _parse_match_response(response: str, cvs_by_lower_name: dict[str, dict]) -> dict | None:
    """Parse a CV-match response. Returns the matched CV dict, or None if
    the response didn't name a recognized CV."""
    for line in response.split("\n"):
        line = line.strip()
        if line.startswith("CV:"):
            name = line.replace("CV:", "").strip().strip("[]").strip()
            return cvs_by_lower_name.get(name.lower())
    return None


def match_cv(job: dict, cvs: list[dict]) -> dict:
    """Pick the best-matching CV for `job` from `cvs`.

    Args:
        job: Job dict with keys: title, site, location, full_description.
        cvs: Non-empty list of CV dicts from config.list_cvs(). Callers
             should not call this with an empty list -- there is no "no
             CVs" return value here, only "which of these CVs fits best."

    Returns:
        The chosen CV dict (same shape as an item from config.list_cvs()).
        Never raises -- falls back to the first CV (cvs[0], per
        list_cvs()'s stable alphabetical sort) on any LLM error or an
        unrecognized/unparseable response, since a CV genuinely exists and
        picking *a* resume is better than picking none.
    """
    cvs_by_lower_name = {cv["name"].lower(): cv for cv in cvs}

    candidates_text = "\n\n".join(
        f"NAME: {cv['name']}\nEXCERPT:\n{read_cv_text(cv['name'])[:_CV_TEXT_EXCERPT_CHARS] or '(no extracted text available)'}"
        for cv in cvs
    )
    job_text = (
        f"TITLE: {job.get('title', '')}\n"
        f"COMPANY: {job.get('site') or 'the company'}\n"
        f"LOCATION: {job.get('location', 'N/A')}\n\n"
        f"DESCRIPTION:\n{(job.get('full_description') or '')[:4000]}"
    )

    messages = [
        {"role": "system", "content": _build_match_prompt(cvs)},
        {"role": "user", "content": f"JOB POSTING:\n{job_text}\n\n---\n\nCANDIDATE CVS:\n{candidates_text}"},
    ]

    try:
        client = get_client()
        response = client.chat(messages, max_tokens=256, temperature=0.0)
        chosen = _parse_match_response(response, cvs_by_lower_name)
        if chosen is not None:
            return chosen
        log.warning("CV match response didn't name a known CV for job '%s'; falling back to first CV", job.get("title", "?"))
    except Exception as e:
        log.error("LLM error matching CV for job '%s': %s", job.get("title", "?"), e)

    return cvs[0]
