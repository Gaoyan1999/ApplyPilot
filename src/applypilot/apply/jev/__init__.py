"""Vendored fast browser-decision agent, adapted from browser-use/jev-ultrafast
(https://github.com/browser-use/jev-ultrafast, MIT, not published on PyPI --
see apply/jev_engine.py's module docstring for why this is vendored rather
than depended on).

One DOM snapshot -> one TypeSafe API call picks an operation (CLICK/
TYPE_TEXT/SELECT/SCROLL/DONE/BLOCKED) + target in one round trip -> a small
LLM only fires for TYPE_TEXT. Used by apply/jev_engine.py as ApplyPilot's
fast-path auto-apply engine; falls back to the full Claude Code agent
(apply/launcher.py) on anything it can't handle.

Changes from upstream:
- model.field_text() uses applypilot.llm + real applicant profile/resume/job
  context (set via model.set_applicant_context()) instead of jev's own
  DeepSeek-only, no-personal-info text helper -- upstream's version can
  never fill an applicant's actual details by design.
- browser.Browser.observe()'s post-action settle retry is extended from a
  fixed ~200ms budget to up to 15s with backoff -- upstream's window only
  covers in-page UI updates; real ATS forms navigate to a new page after
  "Apply"/"Continue", which the original budget can't wait out.
"""

from .agent import Agent

__all__ = ["Agent"]
