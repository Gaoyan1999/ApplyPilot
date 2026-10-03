"""LLM-powered pre-fill: resume text -> structured profile/search suggestions.

Both functions share one contract: never raise, degrade to an empty/partial
result on any LLM or parse failure. Callers (the webapp's onboarding/context
endpoints) always have a sensible fallback -- manual entry -- so a failure
here should never block setup.
"""

from __future__ import annotations

import logging

from applypilot.llm import get_client
from applypilot.scoring.tailor import extract_json

log = logging.getLogger(__name__)

# The profile sections an LLM extraction is allowed to produce.
# `personal` here is further filtered down to an allowlist of keys before
# being merged into profile.md -- see config.apply_profile_extraction --
# since the section also holds manual-only, sensitive fields (passwords)
# this function's prompt never asks the LLM for in the first place.
PROFILE_AI_SECTIONS = ("personal", "experience", "skills_boundary", "resume_facts")


def extract_profile_fields(resume_text: str) -> dict:
    """Ask the LLM to pre-fill profile fields from resume text.

    Returns a dict with (at least) the four sections above, each present as
    an empty dict/list on failure or on any field the LLM didn't find.
    """
    empty = {section: {} for section in PROFILE_AI_SECTIONS}

    prompt = f"""You are extracting structured facts from a candidate's resume text. Read the resume below and output ONLY a JSON object (no markdown fences, no extra text) with exactly this shape:

{{
  "personal": {{
    "full_name": "", "preferred_name": "", "email": "", "phone": "",
    "city": "", "province_state": "", "country": "", "postal_code": "",
    "address": "", "linkedin_url": "", "github_url": "", "portfolio_url": "", "website_url": ""
  }},
  "experience": {{
    "years_of_experience_total": "", "education_level": "",
    "current_title": "", "target_role": ""
  }},
  "skills_boundary": {{
    "programming_languages": [], "frameworks": [], "tools": []
  }},
  "resume_facts": {{
    "preserved_companies": [], "preserved_projects": [],
    "preserved_school": "", "real_metrics": []
  }}
}}

Rules:
- Use "" or [] for anything not clearly stated in the resume. Never invent facts.
- "target_role" is your best guess at the role this candidate is aiming for next, based on their most recent title and trajectory.
- "education_level" is one of: High School, Associate's, Bachelor's, Master's, PhD, Self-taught, or the closest match.
- "preserved_companies"/"preserved_projects" are company/project names to keep exactly as-is if this resume is ever tailored -- pick the ones a hiring manager would recognize or want to verify.
- "real_metrics" are concrete, verifiable numbers from the resume (e.g. "reduced latency 40%", "50k monthly users"), not vague claims.

RESUME:
{resume_text}
"""

    try:
        raw = get_client().ask(prompt, temperature=0.0, max_tokens=3000)
        data = extract_json(raw)
    except Exception as e:
        log.warning("AI profile extraction failed: %s", e)
        return empty

    for section in PROFILE_AI_SECTIONS:
        if not isinstance(data.get(section), dict):
            data[section] = {}
    return data


def suggest_search_config(resume_text: str, profile: dict) -> dict:
    """Ask the LLM to suggest target job title queries and titles to
    exclude, given the resume and the profile's experience section.

    Returns {"queries": [...], "exclude_titles": [...]} -- empty on failure,
    same "never raise" contract as extract_profile_fields.
    """
    exp = profile.get("experience", {})
    prompt = f"""Based on this candidate's resume and experience, suggest a job search configuration. Output ONLY a JSON object (no markdown fences, no extra text) with exactly this shape:

{{
  "queries": [
    {{"query": "Job Title", "tier": 1}}
  ],
  "exclude_titles": []
}}

Rules:
- Produce 3 to 6 "queries", ordered from most (tier 1) to least (tier 3) targeted. Tier 1 = exact title match to their current level/skills. Tier 2 = adjacent titles they're also qualified for. Tier 3 = broader/stretch titles.
- "exclude_titles" are title keywords to filter out as clearly not a fit (e.g. "Senior" if the candidate is entry-level, or an unrelated discipline that happens to share keywords with their field).
- Base this only on the resume and current/target role below — don't invent experience.

Current title: {exp.get('current_title', '')}
Target role: {exp.get('target_role', '')}
Years of experience: {exp.get('years_of_experience_total', '')}

RESUME:
{resume_text}
"""

    try:
        raw = get_client().ask(prompt, temperature=0.0, max_tokens=1024)
        data = extract_json(raw)
    except Exception as e:
        log.warning("AI search suggestion failed: %s", e)
        return {"queries": [], "exclude_titles": []}

    if not isinstance(data.get("queries"), list):
        data["queries"] = []
    if not isinstance(data.get("exclude_titles"), list):
        data["exclude_titles"] = []
    return data
