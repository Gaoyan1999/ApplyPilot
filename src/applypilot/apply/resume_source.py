"""Resolve which resume PDF to use when auto-applying to a job.

Two sources, tried in order:
  1. The per-job LLM-tailored resume (jobs.tailored_resume_path), if one
     exists and its PDF sibling is actually present on disk.
  2. The user's CV library (config.list_cvs()) -- no tailoring involved,
     just picking the best-matching existing file via scoring.cv_match.

Kept out of apply/launcher.py so it's independently testable (a temp
CV_DIR is all that's needed -- no Chrome, no subprocess, no DB).
"""

from pathlib import Path

from applypilot.config import CV_DIR, list_cvs
from applypilot.scoring.cv_match import match_cv


def resolve_resume(job: dict) -> Path | None:
    """Return the resume PDF path to use for `job`, or None if nothing is
    available (no tailored resume, and no CV in the library -- or no CV
    the matcher could hand back)."""
    tailored_path = job.get("tailored_resume_path")
    if tailored_path:
        tailored_pdf = Path(tailored_path).with_suffix(".pdf")
        if tailored_pdf.exists():
            return tailored_pdf

    cvs = list_cvs()
    if not cvs:
        return None

    chosen = match_cv(job, cvs)
    pdf_path = CV_DIR / f"{chosen['name']}.pdf"
    return pdf_path if pdf_path.exists() else None
