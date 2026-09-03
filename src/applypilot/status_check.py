"""Rechecks previously-discovered job postings to catch ones that have since
closed -- LinkedIn in particular pulls postings down within a day or two, and
today the only place ApplyPilot ever learns a posting is gone is as a side
effect of actually attempting to apply to it. This lets the user sweep
whatever set of pending jobs they've filtered down to (same filters as the
jobs table) and mark the closed ones without wasting an apply attempt on
them first.

Detection is deterministic (HTTP status + known "closed" phrases in the
rendered page), not an LLM call -- unlike enrichment/detail.py's cascade,
this doesn't need a description, just a yes/no on whether the posting is
still live, so a phrase match is enough and keeps this tier-independent.

LinkedIn only renders its "No longer accepting applications" banner in
place of the Apply button, and the Apply button itself is a signed-in-only
element -- an anonymous visitor gets a "Sign in" prompt there regardless of
whether the posting is actually still open. So a bare, cookie-less
Playwright context (what this used before) can never see that phrase for
LinkedIn: it's not that the phrase is missing, it's that the whole panel is
swapped out before the phrase would ever appear. To see the real status we
reuse the same signed-in Chrome profile the apply pipeline uses (cloned
from the user's real Chrome profile the first time either one runs).
"""

import logging
import threading
import time
from collections.abc import Callable

from playwright.sync_api import sync_playwright

from applypilot.apply.chrome import setup_worker_profile
from applypilot.database import get_connection

log = logging.getLogger(__name__)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# Dedicated worker slot for this module's Chrome profile -- kept separate
# from the numeric IDs (0-9) apply workers use so a status-check scan can
# never contend with an in-progress apply run for the same profile dir.
_PROFILE_WORKER_ID = 99

# HTTP-level signals that the posting is simply gone.
PERMANENT_FAILURES = {404, 410, 451}

# Phrases checked (case-insensitive) against the rendered page's visible
# text -- covers sites like LinkedIn that return HTTP 200 for a closed
# posting and client-render an error/expired message instead.
CLOSED_PATTERNS = [
    "no longer accepting applications",
    "this job is no longer available",
    "job posting has expired",
    "this position has been filled",
    "no longer accepting job applications",
    "job not found",
    "职位已删除",
    "职位发布已删除",
    "无法加载页面",
    "该职位不再接受申请",
    "招聘信息已下线",
]


def _check_one(page, url: str) -> dict:
    """Visit one job URL and decide whether the posting looks closed.

    Returns {"result": "closed" | "open" | "error", "reason": str | None}.
    No retries here -- a transient failure is just reported as an error; the
    next scheduled run naturally retries it.
    """
    try:
        resp = page.goto(url, timeout=45000)
        if resp and resp.status in PERMANENT_FAILURES:
            return {"result": "closed", "reason": f"HTTP {resp.status}"}

        page.wait_for_load_state("domcontentloaded", timeout=15000)
        try:
            page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass

        body_text = page.inner_text("body").lower()
        for pattern in CLOSED_PATTERNS:
            if pattern in body_text:
                return {"result": "closed", "reason": pattern}

        return {"result": "open", "reason": None}
    except Exception as e:
        return {"result": "error", "reason": str(e)[:200]}


def run_status_check(
    jobs: list[dict],
    on_progress: Callable[[dict], None] | None = None,
    on_warning: Callable[[str], None] | None = None,
    stop_event: threading.Event | None = None,
) -> dict:
    """Rechecks each of `jobs` (each a {"url", "title", "company"} dict --
    the caller has already resolved which jobs to check, e.g. via the same
    filters as the jobs table) and marks the closed ones. Returns
    {"checked": int, "closed_found": int, "errors": int}."""
    conn = get_connection()

    stats = {"checked": 0, "closed_found": 0, "errors": 0}
    if not jobs:
        return stats

    profile_dir = setup_worker_profile(_PROFILE_WORKER_ID)

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(profile_dir), headless=True, user_agent=UA,
        )
        page = context.pages[0] if context.pages else context.new_page()

        try:
            for i, job in enumerate(jobs):
                if stop_event is not None and stop_event.is_set():
                    break

                url, title, company = job["url"], job["title"], job["company"]
                outcome = _check_one(page, url)
                stats["checked"] += 1

                if outcome["result"] == "closed":
                    stats["closed_found"] += 1
                    conn.execute("UPDATE jobs SET user_action = 'closed' WHERE url = ?", (url,))
                    conn.commit()
                elif outcome["result"] == "error":
                    stats["errors"] += 1
                    if on_warning:
                        on_warning(f"{(title or url)[:60]}: {outcome['reason']}")

                if on_progress:
                    on_progress(
                        {
                            "done": i + 1,
                            "total": len(jobs),
                            "current": {"url": url, "title": title, "company": company},
                            "result": outcome["result"],
                        }
                    )

                time.sleep(0.5)
        finally:
            context.close()

    return stats
