"""Deterministic CAPTCHA detect/solve/inject via the CapSolver REST API.

Extracted from apply/prompt.py's CAPTCHA section: that section hands Claude
exact, verbatim JS + CapSolver HTTP calls to run one step at a time. There is
no actual LLM judgment in the flow itself -- it's a fixed 3-step sequence
(createTask -> poll -> inject), so it's reusable as plain Python needing no
LLM at all. Used by apply/jev_engine.py; apply/prompt.py's in-prompt version
for the Claude engine is untouched.

Callers supply an `evaluate(js: str) -> Any` function that runs `js` in the
target page and returns its result (e.g. a CDP Runtime.evaluate wrapper) --
this module has no browser-connection opinion of its own.
"""

import logging
import time
from typing import Callable

import httpx

log = logging.getLogger(__name__)

Evaluate = Callable[[str], object]

CAPSOLVER_BASE = "https://api.capsolver.com"

# Deliberately stricter than prompt.py's CAPTCHA DETECT section: that version
# also matches on bare script-tag presence ("maybe a captcha"), which is fine
# when an LLM sanity-checks the result but produces false positives here --
# e.g. Lever loads the hCaptcha script defensively on every page even when no
# challenge ever renders. This version only matches an actual, currently
# visible widget element -- confirmed against a real Lever form, where the
# script-tag heuristic falsely triggered a block within 2 seconds (before a
# single navigation completed) and this version does not.
_DETECT_JS = """(() => {
  const visible = e => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
  const r = {};
  const url = window.location.href;
  const hc = document.querySelector('.h-captcha, [data-hcaptcha-sitekey]');
  if (visible(hc)) { r.type = 'hcaptcha'; r.sitekey = hc.dataset.sitekey || hc.dataset.hcaptchaSitekey; }
  if (!r.type) {
    const cf = document.querySelector('.cf-turnstile, [data-turnstile-sitekey]');
    if (visible(cf)) {
      r.type = 'turnstile'; r.sitekey = cf.dataset.sitekey || cf.dataset.turnstileSitekey;
      if (cf.dataset.action) r.action = cf.dataset.action;
      if (cf.dataset.cdata) r.cdata = cf.dataset.cdata;
    }
  }
  if (!r.type) {
    const rc = document.querySelector('.g-recaptcha');
    if (visible(rc)) { r.type = 'recaptchav2'; r.sitekey = rc.dataset.sitekey; }
  }
  if (!r.type) {
    const fc = document.querySelector('#FunCaptcha, [data-pkey], .funcaptcha');
    if (visible(fc)) { r.type = 'funcaptcha'; r.sitekey = fc.dataset.pkey; }
  }
  if (r.type) { r.url = url; return r; }
  return null;
})()"""

_TASK_TYPE = {
    "hcaptcha": "HCaptchaTaskProxyLess",
    "recaptchav2": "ReCaptchaV2TaskProxyLess",
    "recaptchav3": "ReCaptchaV3TaskProxyLess",
    "turnstile": "AntiTurnstileTaskProxyLess",
    "funcaptcha": "FunCaptchaTaskProxyLess",
}

_INJECT_JS = {
    "recaptchav2": """(token => {
  document.querySelectorAll('[name="g-recaptcha-response"]').forEach(el => { el.value = token; el.style.display = 'block'; });
  if (window.___grecaptcha_cfg) {
    const clients = window.___grecaptcha_cfg.clients;
    for (const key in clients) {
      const walk = (obj, d) => {
        if (d > 4 || !obj) return;
        for (const k in obj) {
          if (typeof obj[k] === 'function' && k.length < 3) try { obj[k](token); } catch(e) {}
          else if (typeof obj[k] === 'object') walk(obj[k], d+1);
        }
      };
      walk(clients[key], 0);
    }
  }
  return 'injected';
})(%(token)s)""",
    "hcaptcha": """(token => {
  const ta = document.querySelector('[name="h-captcha-response"], textarea[name*="hcaptcha"]');
  if (ta) ta.value = token;
  document.querySelectorAll('iframe[data-hcaptcha-response]').forEach(f => f.setAttribute('data-hcaptcha-response', token));
  const cb = document.querySelector('[data-hcaptcha-widget-id]');
  if (cb && window.hcaptcha) try { window.hcaptcha.getResponse(cb.dataset.hcaptchaWidgetId); } catch(e) {}
  return 'injected';
})(%(token)s)""",
    "turnstile": """(token => {
  const inp = document.querySelector('[name="cf-turnstile-response"], input[name*="turnstile"]');
  if (inp) inp.value = token;
  if (window.turnstile) try { const w = document.querySelector('.cf-turnstile'); if (w) window.turnstile.getResponse(w); } catch(e) {}
  return 'injected';
})(%(token)s)""",
    "funcaptcha": """(token => {
  const inp = document.querySelector('#FunCaptcha-Token, input[name="fc-token"]');
  if (inp) inp.value = token;
  if (window.ArkoseEnforcement) try { window.ArkoseEnforcement.setConfig({data: {blob: token}}) } catch(e) {}
  return 'injected';
})(%(token)s)""",
}

_INJECT_JS["recaptchav3"] = _INJECT_JS["recaptchav2"]


def detect(evaluate: Evaluate) -> dict | None:
    """Returns a detection dict ({"type", "sitekey", "url", ...}) or None if
    no CAPTCHA widget is present. "turnstile_script_only" means the
    Cloudflare script loaded but no widget rendered yet -- caller should wait
    ~3s and re-detect rather than treating it as a real CAPTCHA."""
    return evaluate(_DETECT_JS)


def solve(evaluate: Evaluate, detected: dict, capsolver_key: str) -> bool:
    """Runs createTask -> poll -> inject against CapSolver. Returns True once
    a token was successfully injected into the page. Returns False if
    CapSolver itself reports an error (errorId > 0) or times out -- caller
    should treat that as a genuine block, not retry blindly."""
    captcha_type = detected["type"]
    if captcha_type == "turnstile_script_only" or captcha_type not in _TASK_TYPE:
        return False

    task: dict = {
        "type": _TASK_TYPE[captcha_type],
        "websiteURL": detected["url"],
        "websiteKey": detected.get("sitekey"),
    }
    if captcha_type == "turnstile":
        metadata = {}
        if detected.get("action"):
            metadata["action"] = detected["action"]
        if detected.get("cdata"):
            metadata["cdata"] = detected["cdata"]
        if metadata:
            task["metadata"] = metadata
    if captcha_type == "recaptchav3":
        task["pageAction"] = "submit"

    with httpx.Client(timeout=30) as client:
        create = client.post(
            f"{CAPSOLVER_BASE}/createTask", json={"clientKey": capsolver_key, "task": task}
        ).json()
        if create.get("errorId", 1) != 0:
            log.warning("CapSolver createTask failed: %s", create.get("errorDescription"))
            return False
        task_id = create["taskId"]

        solution = None
        for _ in range(10):
            time.sleep(3)
            result = client.post(
                f"{CAPSOLVER_BASE}/getTaskResult",
                json={"clientKey": capsolver_key, "taskId": task_id},
            ).json()
            if result.get("errorId", 1) != 0:
                log.warning("CapSolver getTaskResult failed: %s", result.get("errorDescription"))
                return False
            if result.get("status") == "ready":
                solution = result["solution"]
                break
        if solution is None:
            log.warning("CapSolver timed out after 30s polling")
            return False

    token = (
        solution.get("token")
        if captcha_type == "turnstile"
        else solution.get("gRecaptchaResponse")
    )
    if not token:
        return False

    import json as _json

    inject_js = _INJECT_JS[captcha_type] % {"token": _json.dumps(token)}
    evaluate(inject_js)
    return True
