"""Per-job pipeline stage labeling for the web dashboard.

Mirrors the stage-boundary predicates already defined in
`applypilot.database.get_jobs_by_stage` and `get_stats`, so labels shown
in the web UI stay consistent with the rest of the codebase.
"""

STAGE_ORDER = [
    "Discovered",
    "Enriched",
    "Scored",
    "Tailored",
    "Cover Letter Ready",
    "Applying",
    "Applied",
    "Failed",
]

MAX_ATTEMPTS = 5

# Manual, user-assigned label on a job -- independent of the auto-computed
# pipeline `stage` above. Stored in the `user_action` column.
#
# Two groups: pre-application reminders (things the user still needs to do),
# and post-application tracking (for jobs applied to manually, outside the
# automated Chrome apply pipeline -- which has its own separate apply_status/
# applied_at fields feeding into `compute_stage` above).
USER_ACTIONS = [
    "not_for_me", "need_tailor", "need_auto_apply",
    "applied", "interviewing", "offer", "rejected", "closed",
]


def compute_stage(job: dict) -> str:
    """Return the current pipeline stage label for a job row."""
    if job.get("applied_at"):
        return "Applied"
    if job.get("apply_status") == "failed" or job.get("apply_error"):
        return "Failed"
    if job.get("apply_status") == "in_progress":
        return "Applying"
    if job.get("cover_letter_path"):
        return "Cover Letter Ready"
    if (job.get("cover_attempts") or 0) >= MAX_ATTEMPTS and not job.get("cover_letter_path"):
        return "Failed"
    if job.get("tailored_resume_path"):
        return "Tailored"
    if (job.get("tailor_attempts") or 0) >= MAX_ATTEMPTS and not job.get("tailored_resume_path"):
        return "Failed"
    if job.get("fit_score") is not None:
        return "Scored"
    if job.get("detail_error"):
        return "Failed"
    if job.get("full_description"):
        return "Enriched"
    return "Discovered"
