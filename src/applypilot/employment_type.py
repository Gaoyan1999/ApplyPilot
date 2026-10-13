"""Maps messy source-specific job-type/employment-type strings (and, as a
last resort, job titles) onto the strict 5-value taxonomy used throughout
ApplyPilot: full_time / intern / graduate / contract / unknown.
"""

import re

JOB_TYPES: tuple[str, ...] = ("full_time", "intern", "graduate", "contract", "unknown")

_INTERN_KEYWORDS = ("internship", "intern", "summer", "co-op", "coop")
_GRADUATE_KEYWORDS = ("graduate", "newgrad")
_CONTRACT_KEYWORDS = ("contract", "contractor", "temporary", "temp", "perdiem", "per-diem", "per_diem")
_FULL_TIME_KEYWORDS = ("fulltime", "permanent")

_TITLE_INTERN_RE = re.compile(r"\b(intern(ship)?|co-?op)\b", re.IGNORECASE)
# "Graduate Program(me)", "Graduate Software Engineer", "New Grad", "Grad Developer".
# \b keeps "Undergraduate" / "Postgraduate" out.
_TITLE_GRADUATE_RE = re.compile(r"\b(graduate|grad)\b", re.IGNORECASE)
_TITLE_CONTRACT_RE = re.compile(r"\b(contract(or)?)\b", re.IGNORECASE)


def classify_native_job_type(raw: str | None) -> str | None:
    """Classify a native job-type/employment-type string (JobSpy's comma-joined
    tokens, Workday's `timeType` text, or schema.org `employmentType`).

    Returns one of the 5 values whenever `raw` is non-empty (e.g. "part_time"
    resolves definitively to "unknown" -- the source told us it isn't one of
    the other 4 buckets, so no title fallback should run).
    Returns None only when `raw` itself is missing/empty, signaling "no
    native signal at all" to the caller.
    """
    if not raw or not raw.strip():
        return None
    compact = re.sub(r"[\s_-]+", "", raw.lower())
    if any(k in compact for k in _INTERN_KEYWORDS):
        return "intern"
    if any(k in compact for k in _GRADUATE_KEYWORDS):
        return "graduate"
    if any(k in compact for k in _CONTRACT_KEYWORDS):
        return "contract"
    if any(k in compact for k in _FULL_TIME_KEYWORDS):
        return "full_time"
    return "unknown"


def classify_title_job_type(title: str | None) -> str:
    """Cheap keyword fallback for sources with no native field at all."""
    if not title:
        return "unknown"
    if _TITLE_INTERN_RE.search(title):
        return "intern"
    if _TITLE_GRADUATE_RE.search(title):
        return "graduate"
    if _TITLE_CONTRACT_RE.search(title):
        return "contract"
    return "unknown"


def classify_job_type(native: str | None, title: str | None = None) -> str:
    """Entry point for every discovery call site. A title that clearly reads
    as an internship (e.g. "Software Engineer Intern") always wins, since
    sources frequently mark internship postings as "full_time" in their
    native employment-type field (meaning full-time hours, not employment
    category). Graduate programs get the same treatment, checked after
    intern. Otherwise native signal (even if it maps to "unknown") wins
    over the title fallback."""
    if title and _TITLE_INTERN_RE.search(title):
        return "intern"
    if title and _TITLE_GRADUATE_RE.search(title):
        return "graduate"
    native_result = classify_native_job_type(native)
    if native_result is not None:
        return native_result
    return classify_title_job_type(title)
