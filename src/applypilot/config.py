"""ApplyPilot configuration: paths, platform detection, user data."""

import os
import platform
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

# User data directory — all user-specific files live here
APP_DIR = Path(os.environ.get("APPLYPILOT_DIR", Path.home() / ".applypilot"))

# Core paths
DB_PATH = APP_DIR / "applypilot.db"
PROFILE_PATH = APP_DIR / "profile.md"
# Pre-Profile.md storage -- migrated into PROFILE_PATH on first read and
# then left in place untouched (see _migrate_legacy_profile).
LEGACY_PROFILE_JSON_PATH = APP_DIR / "profile.json"
SEARCH_CONFIG_PATH = APP_DIR / "searches.yaml"
PROMPTS_DIR = APP_DIR / "prompts"
ENV_PATH = APP_DIR / ".env"

# Generated output
TAILORED_DIR = APP_DIR / "tailored_resumes"
COVER_LETTER_DIR = APP_DIR / "cover_letters"
LOG_DIR = APP_DIR / "logs"

# User-maintained CV library (master resumes the user manages themselves,
# distinct from the per-job LLM-tailored resumes above)
CV_DIR = APP_DIR / "cvs"

# Chrome worker isolation
CHROME_WORKER_DIR = APP_DIR / "chrome-workers"
APPLY_WORKER_DIR = APP_DIR / "apply-workers"

# Package-shipped config (YAML registries)
PACKAGE_DIR = Path(__file__).parent
CONFIG_DIR = PACKAGE_DIR / "config"


def get_chrome_path() -> str:
    """Auto-detect Chrome/Chromium executable path, cross-platform.

    Override with CHROME_PATH environment variable.
    """
    env_path = os.environ.get("CHROME_PATH")
    if env_path and Path(env_path).exists():
        return env_path

    system = platform.system()

    if system == "Windows":
        candidates = [
            Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
        ]
    elif system == "Darwin":
        candidates = [
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
        ]
    else:  # Linux
        candidates = []
        for name in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):
            found = shutil.which(name)
            if found:
                candidates.append(Path(found))

    for c in candidates:
        if c and c.exists():
            return str(c)

    # Fall back to PATH search
    for name in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium", "chrome"):
        found = shutil.which(name)
        if found:
            return found

    raise FileNotFoundError(
        "Chrome/Chromium not found. Install Chrome or set CHROME_PATH environment variable."
    )


def get_chrome_user_data() -> Path:
    """Default Chrome user data directory, cross-platform."""
    system = platform.system()
    if system == "Windows":
        return Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "User Data"
    elif system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
    else:
        return Path.home() / ".config" / "google-chrome"


def ensure_dirs():
    """Create all required directories."""
    for d in [APP_DIR, TAILORED_DIR, COVER_LETTER_DIR, LOG_DIR, CHROME_WORKER_DIR, APPLY_WORKER_DIR, CV_DIR]:
        d.mkdir(parents=True, exist_ok=True)


# Profile.md layout: a YAML front matter block holding the structured
# fields code reads one by one (name, address, visa, salary, skills, ...),
# then a free Markdown body -- the user's own high-level summary. The body
# is exposed as profile["summary"]; detailed work/project history stays in
# the CV and the knowledge base, not here.
_FRONT_MATTER_RE = re.compile(r"\A---\n(.*?)\n---\n?(.*)\Z", re.DOTALL)

_DEFAULT_PROFILE_SUMMARY = (
    "## Summary\n\n"
    "<!-- A few lines about who you are and what you're looking for. Keep it "
    "high level -- detailed work and project history lives in your CV and "
    "knowledge base. -->\n"
)

# Field skeleton for a brand-new Profile.md, so the editor shows every key
# the rest of the app reads even before an AI extraction has run.
_PROFILE_SKELETON = {
    "personal": {
        "full_name": "", "preferred_name": "", "email": "", "phone": "",
        "address": "", "city": "", "province_state": "", "country": "", "postal_code": "",
        "linkedin_url": "", "github_url": "", "portfolio_url": "", "website_url": "",
    },
    "experience": {
        "current_title": "", "target_role": "", "years_of_experience_total": "", "education_level": "",
    },
    "work_authorization": {
        "legally_authorized_to_work": True, "require_sponsorship": False, "work_permit_type": "",
    },
    "compensation": {
        "salary_expectation": "", "salary_currency": "USD", "salary_range_min": "", "salary_range_max": "",
    },
    "availability": {"earliest_start_date": "Immediately"},
    "knowledge_base_dir": "",
}


def parse_profile_markdown(text: str) -> dict:
    """Parse Profile.md text into the profile dict. Raises ValueError if the
    front matter is missing or isn't a YAML mapping."""
    import yaml
    match = _FRONT_MATTER_RE.match(text.replace("\r\n", "\n"))
    if not match:
        raise ValueError("Profile.md must start with a '---' YAML front matter block")
    try:
        fields = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as e:
        raise ValueError(f"Invalid YAML in front matter: {e}") from e
    if not isinstance(fields, dict):
        raise ValueError("Front matter must be a set of 'key: value' fields")
    fields["summary"] = match.group(2).strip()
    return fields


def render_profile_markdown(profile: dict) -> str:
    """Inverse of parse_profile_markdown."""
    import yaml
    fields = {k: v for k, v in profile.items() if k != "summary"}
    front = yaml.safe_dump(fields, sort_keys=False, allow_unicode=True, default_flow_style=False)
    summary = profile.get("summary") or _DEFAULT_PROFILE_SUMMARY
    return f"---\n{front}---\n\n{summary.strip()}\n"


def profile_skeleton_markdown() -> str:
    """Starter Profile.md text for a user who has no profile yet."""
    import copy
    return render_profile_markdown(copy.deepcopy(_PROFILE_SKELETON))


def _migrate_legacy_profile() -> None:
    import json
    if PROFILE_PATH.exists() or not LEGACY_PROFILE_JSON_PATH.exists():
        return
    legacy = json.loads(LEGACY_PROFILE_JSON_PATH.read_text(encoding="utf-8"))
    PROFILE_PATH.write_text(render_profile_markdown(legacy), encoding="utf-8")


def profile_exists() -> bool:
    _migrate_legacy_profile()
    return PROFILE_PATH.exists()


def read_profile_markdown() -> str:
    _migrate_legacy_profile()
    return PROFILE_PATH.read_text(encoding="utf-8")


def load_profile() -> dict:
    """Load the user profile from ~/.applypilot/profile.md.

    Returns the front matter fields plus "summary" (the Markdown body, with
    unfilled "<!-- ... -->" template hints stripped)."""
    if not profile_exists():
        raise FileNotFoundError(
            f"Profile not found at {PROFILE_PATH}. Open the Context page in the dashboard to set one up."
        )
    profile = parse_profile_markdown(read_profile_markdown())
    summary = re.sub(r"<!--.*?-->", "", profile["summary"], flags=re.DOTALL).strip()
    # Headings alone (the untouched template) carry nothing for the LLM.
    has_prose = re.sub(r"^#{1,6}.*$", "", summary, flags=re.MULTILINE).strip()
    profile["summary"] = summary if has_prose else ""
    return profile


def save_profile(profile: dict) -> None:
    """Write a profile dict back to profile.md, keeping the existing summary
    body (with its template hints) when `profile` doesn't carry one."""
    ensure_dirs()
    if "summary" not in profile and PROFILE_PATH.exists():
        profile = {**profile, "summary": parse_profile_markdown(read_profile_markdown())["summary"]}
    PROFILE_PATH.write_text(render_profile_markdown(profile), encoding="utf-8")


def save_profile_markdown(text: str) -> None:
    """Validate and write raw Profile.md text (as edited on the Context page)."""
    parse_profile_markdown(text)
    ensure_dirs()
    PROFILE_PATH.write_text(text if text.endswith("\n") else text + "\n", encoding="utf-8")


# The profile's "personal" section mixes AI-derivable fields (name, email,
# urls, ...) with manual-only, sensitive fields (password, linkedin_password,
# linkedin_email) that must never be sent to an LLM prompt and must never be
# clobbered by a re-extraction. This is the allowlist of keys an AI
# extraction is allowed to write -- anything else in "personal" survives
# untouched across apply_profile_extraction() calls.
_PROFILE_AI_PERSONAL_KEYS = (
    "full_name", "preferred_name", "email", "phone",
    "city", "province_state", "country", "postal_code", "address",
    "linkedin_url", "github_url", "portfolio_url", "website_url",
)

# Profile sections an AI extraction produces (see profile_ai.py).
_PROFILE_AI_SECTIONS = ("personal", "experience", "skills_boundary", "resume_facts")

# Default EEO answers for a brand-new profile -- never prompted for, never
# sent to the LLM (scorer.py hard-excludes this section from scoring
# context; these are protected characteristics).
_DEFAULT_EEO_VOLUNTARY = {
    "gender": "Decline to self-identify",
    "race_ethnicity": "Decline to self-identify",
    "veteran_status": "Decline to self-identify",
    "disability_status": "Decline to self-identify",
}


def apply_profile_extraction(profile: dict, extracted: dict) -> dict:
    """Merge an AI extraction (profile_ai.extract_profile_fields) into an
    existing profile dict and return the merged result.

    `experience`, `skills_boundary`, and `resume_facts` are replaced
    wholesale -- the AI is the only source for those. `personal` is merged
    key-by-key through _PROFILE_AI_PERSONAL_KEYS so password fields already
    in `profile` are never touched. Every other section (work_authorization,
    compensation, availability, eeo_voluntary) is left exactly as-is --
    those are never AI-derived.
    """
    merged = dict(profile)

    personal = dict(merged.get("personal", {}))
    for key in _PROFILE_AI_PERSONAL_KEYS:
        value = extracted.get("personal", {}).get(key)
        if value:
            personal[key] = value
    merged["personal"] = personal

    for section in ("experience", "skills_boundary", "resume_facts"):
        value = extracted.get(section)
        if isinstance(value, dict):
            merged[section] = value

    merged.setdefault("work_authorization", {})
    merged.setdefault("compensation", {})
    merged.setdefault("availability", {})
    merged.setdefault("eeo_voluntary", dict(_DEFAULT_EEO_VOLUNTARY))

    return merged


def load_search_config() -> "SearchYamlConfig":
    """Load and validate search configuration from ~/.applypilot/searches.yaml."""
    import yaml
    from applypilot.search_config import SearchYamlConfig
    if not SEARCH_CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"Search config not found at {SEARCH_CONFIG_PATH}. Open the Context page in the dashboard to set one up."
        )
    raw = yaml.safe_load(SEARCH_CONFIG_PATH.read_text(encoding="utf-8")) or {}
    return SearchYamlConfig.model_validate(raw)


# Top-level searches.yaml keys the web dashboard's config editor manages.
# Everything else in the file (country, glassdoor_location_map, location
# accept/reject patterns, ...) passes through save_search_config() untouched.
_WEB_MANAGED_KEYS = ("queries", "locations", "exclude_titles", "boards")
_WEB_MANAGED_DEFAULTS = ("results_per_site", "hours_old")


def save_search_config(data: dict) -> "SearchYamlConfig":
    """Merge web-editable fields into searches.yaml and persist it.

    Only `queries`, `locations`, `exclude_titles`, `boards`, and
    `defaults.results_per_site` / `defaults.hours_old` are overwritten --
    any other top-level key already in the file is preserved as-is.

    A one-time `searches.yaml.bak` snapshot of the pre-web-edit file is kept
    so a hand-tuned file (with comments, which this rewrite cannot preserve)
    isn't lost the first time someone saves from the dashboard.

    The merged result is validated against `SearchYamlConfig` before being
    written -- an unrecognized key already sitting in the file (e.g. from a
    hand-edit) fails the save loudly instead of being silently persisted
    forever. Returns the validated config that was written.
    """
    import yaml
    from applypilot.search_config import SearchYamlConfig

    current: dict = {}
    if SEARCH_CONFIG_PATH.exists():
        current = yaml.safe_load(SEARCH_CONFIG_PATH.read_text(encoding="utf-8")) or {}
        backup_path = SEARCH_CONFIG_PATH.with_name(SEARCH_CONFIG_PATH.name + ".bak")
        if not backup_path.exists():
            backup_path.write_text(SEARCH_CONFIG_PATH.read_text(encoding="utf-8"), encoding="utf-8")

    for key in _WEB_MANAGED_KEYS:
        if key in data:
            current[key] = data[key]

    defaults = dict(current.get("defaults", {}))
    for key in _WEB_MANAGED_DEFAULTS:
        if key in data.get("defaults", {}):
            defaults[key] = data["defaults"][key]
    current["defaults"] = defaults

    validated = SearchYamlConfig.model_validate(current)

    APP_DIR.mkdir(parents=True, exist_ok=True)
    header = (
        "# ApplyPilot search configuration\n"
        "# Edited via the web dashboard — comments beyond this file's original\n"
        "# backup (searches.yaml.bak) are not preserved on save.\n\n"
    )
    tmp_path = SEARCH_CONFIG_PATH.with_name(SEARCH_CONFIG_PATH.name + ".tmp")
    tmp_path.write_text(
        header + yaml.safe_dump(
            validated.model_dump(exclude_none=True), sort_keys=False, default_flow_style=False,
        ),
        encoding="utf-8",
    )
    tmp_path.replace(SEARCH_CONFIG_PATH)

    return validated


# Prompt keys the web dashboard's Settings page can edit. Each is a single
# file at PROMPTS_DIR/{key}.md -- that file is the one source of truth read
# at generation time and shown in Settings, and it's directly editable by
# hand. CONFIG_DIR/prompts/{key}.md (package-shipped) is only ever used to
# seed a missing file on first run or to restore one via "Reset to default";
# it is never read at generation time.
PROMPT_KEYS = ("cover_letter", "tailoring", "scoring")

_SEED_PROMPTS_DIR = CONFIG_DIR / "prompts"


def get_prompt_seed(key: str) -> str:
    """Return the package-shipped seed text for `key` (used to seed/reset)."""
    return (_SEED_PROMPTS_DIR / f"{key}.md").read_text(encoding="utf-8").strip()


def load_prompts() -> dict[str, str]:
    """Load the live prompt templates from ~/.applypilot/prompts/*.md.

    Any file that doesn't exist yet is seeded from the package default first,
    so every key is always present -- callers never need a separate
    in-code fallback.
    """
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    prompts = {}
    for key in PROMPT_KEYS:
        path = PROMPTS_DIR / f"{key}.md"
        if not path.exists():
            path.write_text(get_prompt_seed(key), encoding="utf-8")
        prompts[key] = path.read_text(encoding="utf-8").strip()
    return prompts


def save_prompts(data: dict[str, str]) -> dict[str, str]:
    """Persist prompt templates, writing each straight to its .md file.

    A blank value for a known key means "reset to default" -- the package
    seed text is written in its place rather than leaving the file absent,
    since PROMPTS_DIR is always the single source read at generation time.

    Returns the prompts dict that was written.
    """
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)

    prompts = {}
    for key in PROMPT_KEYS:
        value = data.get(key)
        text = value.strip() if isinstance(value, str) and value.strip() else get_prompt_seed(key)
        prompts[key] = text
        path = PROMPTS_DIR / f"{key}.md"
        tmp_path = path.with_name(path.name + ".tmp")
        tmp_path.write_text(text, encoding="utf-8")
        tmp_path.replace(path)


# ---------------------------------------------------------------------------
# CV library -- user-maintained master resumes, distinct from the per-job
# LLM-tailored resumes in TAILORED_DIR. CV_DIR is the single source of
# truth (no DB row): each CV is a {safe_name}.pdf + {safe_name}.txt pair,
# named after the user-given label. Mirrors the PROMPTS_DIR convention
# above -- a directory of files the web dashboard lists/edits directly.
# ---------------------------------------------------------------------------

def safe_cv_name(name: str) -> str:
    """Sanitize a user-given CV name into a filesystem-safe stem.

    Same approach as tailor.py's filename-prefix sanitization.
    """
    cleaned = re.sub(r"[^\w\s-]", "", name)[:50].strip().replace(" ", "_")
    if not cleaned:
        raise ValueError("CV name must contain at least one letter, digit, space, or hyphen.")
    return cleaned


def list_cvs() -> list[dict]:
    """List CVs from CV_DIR, sorted by name.

    Returns [{"name", "filename", "uploaded_at", "size", "primary"}] --
    derived straight from the filesystem, plus the primary marker (see
    get_primary_cv_name). Sorted so a "pick the first CV" fallback (e.g.
    cv_match's failure policy) is stable and predictable.
    """
    if not CV_DIR.exists():
        return []

    primary_name = get_primary_cv_name()
    entries = []
    for pdf_path in CV_DIR.glob("*.pdf"):
        stat = pdf_path.stat()
        entries.append({
            "name": pdf_path.stem,
            "filename": pdf_path.name,
            "uploaded_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "size": stat.st_size,
            "primary": pdf_path.stem == primary_name,
        })
    entries.sort(key=lambda e: e["name"].lower())
    return entries


def read_cv_text(name: str) -> str:
    """Read the extracted-text sibling for a CV; "" if missing/empty."""
    txt_path = CV_DIR / f"{safe_cv_name(name)}.txt"
    if not txt_path.exists():
        return ""
    return txt_path.read_text(encoding="utf-8").strip()


def get_primary_cv_name() -> str | None:
    """Name of the CV marked primary (CV_DIR/.primary), or None if unset
    or the marked CV no longer exists."""
    marker = CV_DIR / ".primary"
    if not marker.exists():
        return None
    name = marker.read_text(encoding="utf-8").strip()
    if not name or not (CV_DIR / f"{name}.pdf").exists():
        return None
    return name


def set_primary_cv(name: str) -> None:
    """Mark the CV `name` as the primary resume used for scoring, tailoring,
    and cover letters. Raises ValueError if no such CV exists."""
    safe_name = safe_cv_name(name)
    if not (CV_DIR / f"{safe_name}.pdf").exists():
        raise ValueError(f"No CV named '{safe_name}'.")
    (CV_DIR / ".primary").write_text(safe_name, encoding="utf-8")


def get_primary_resume_text() -> str:
    """Extracted text of the primary CV.

    Raises FileNotFoundError if no CV is marked primary -- callers (scoring,
    tailoring, cover letters) have no sensible fallback without one.
    """
    name = get_primary_cv_name()
    if not name:
        raise FileNotFoundError(
            "No primary CV set. Upload a CV and mark it primary in the CV Library."
        )
    return read_cv_text(name)


def get_primary_resume_pdf_path() -> Path:
    """Path to the primary CV's PDF. Raises FileNotFoundError if unset."""
    name = get_primary_cv_name()
    if not name:
        raise FileNotFoundError(
            "No primary CV set. Upload a CV and mark it primary in the CV Library."
        )
    return CV_DIR / f"{name}.pdf"


def save_cv(name: str, pdf_bytes: bytes) -> dict:
    """Save a new CV: write {safe_name}.pdf, extract text to {safe_name}.txt.

    Raises ValueError if a CV with this name already exists -- collisions
    are rejected rather than silently overwritten, since a re-upload with
    the same name is more likely a mistake than an intended replace.

    The first CV ever saved is auto-marked primary -- otherwise scoring/
    tailoring/cover-letters would have no resume to read until the user
    opens the CV Library and sets one by hand.
    """
    CV_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = safe_cv_name(name)
    pdf_path = CV_DIR / f"{safe_name}.pdf"
    txt_path = CV_DIR / f"{safe_name}.txt"
    is_first_cv = not any(CV_DIR.glob("*.pdf"))

    if pdf_path.exists():
        raise ValueError(f"A CV named '{safe_name}' already exists -- delete it first or choose a different name.")

    tmp_pdf = pdf_path.with_name(pdf_path.name + ".tmp")
    tmp_pdf.write_bytes(pdf_bytes)
    tmp_pdf.replace(pdf_path)

    # Best-effort text extraction -- a scanned/image PDF yields "", which is
    # fine: the CV is still usable, matching just falls back to its name.
    text = ""
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(pdf_path))
        text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    except Exception:
        pass

    tmp_txt = txt_path.with_name(txt_path.name + ".tmp")
    tmp_txt.write_text(text, encoding="utf-8")
    tmp_txt.replace(txt_path)

    if is_first_cv:
        set_primary_cv(safe_name)

    stat = pdf_path.stat()
    return {
        "name": safe_name,
        "filename": pdf_path.name,
        "uploaded_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "size": stat.st_size,
        "primary": is_first_cv,
    }


def delete_cv(name: str) -> bool:
    """Remove a CV's .pdf and .txt files. Returns whether anything existed.

    If the deleted CV was primary, reassigns primary to another remaining
    CV (first by name, same stable order as list_cvs()) or clears the
    marker if none are left.
    """
    safe_name = safe_cv_name(name)
    pdf_path = CV_DIR / f"{safe_name}.pdf"
    txt_path = CV_DIR / f"{safe_name}.txt"

    existed = pdf_path.exists()
    was_primary = existed and get_primary_cv_name() == safe_name
    pdf_path.unlink(missing_ok=True)
    txt_path.unlink(missing_ok=True)

    if was_primary:
        remaining = list_cvs()
        if remaining:
            set_primary_cv(remaining[0]["name"])
        else:
            (CV_DIR / ".primary").unlink(missing_ok=True)

    return existed


def get_excluded_titles() -> list[str]:
    """Lowercased exclude_titles terms from searches.yaml, for title filtering at storage time."""
    return [t.lower() for t in load_search_config().exclude_titles]


def load_sites_config() -> dict:
    """Load sites.yaml configuration (sites list, manual_ats, blocked, etc.)."""
    import yaml
    path = CONFIG_DIR / "sites.yaml"
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def is_manual_ats(url: str | None) -> bool:
    """Check if a URL routes through an ATS that requires manual application."""
    if not url:
        return False
    sites_cfg = load_sites_config()
    domains = sites_cfg.get("manual_ats", [])
    url_lower = url.lower()
    return any(domain in url_lower for domain in domains)


def load_blocked_sites() -> tuple[set[str], list[str]]:
    """Load blocked sites and URL patterns from sites.yaml.

    Returns:
        (blocked_site_names, blocked_url_patterns)
    """
    cfg = load_sites_config()
    blocked = cfg.get("blocked", {})
    sites = set(blocked.get("sites", []))
    patterns = blocked.get("url_patterns", [])
    return sites, patterns


def load_blocked_sso() -> list[str]:
    """Load blocked SSO domains from sites.yaml."""
    cfg = load_sites_config()
    return cfg.get("blocked_sso", [])


def load_base_urls() -> dict[str, str | None]:
    """Load site base URLs for URL resolution from sites.yaml."""
    cfg = load_sites_config()
    return cfg.get("base_urls", {})


# ---------------------------------------------------------------------------
# Default values — referenced across modules instead of magic numbers
# ---------------------------------------------------------------------------

DEFAULTS = {
    "min_score": 7,
    "max_apply_attempts": 3,
    "max_tailor_attempts": 5,
    "poll_interval": 60,
    "apply_timeout": 300,
    "viewport": "1280x900",
    # Number of concurrent web-triggered auto-submit slots (server/apply_state.py) --
    # each slot gets its own Chrome instance/CDP port/browser profile, mirroring
    # launcher.py's worker_id-parameterized CLI batch mode.
    "web_apply_workers": 3,
    # "claude" (full Claude Code agent) or "jev" (fast TypeSafe-based engine,
    # apply/jev_engine.py) -- jev falls back to the Claude engine on any
    # genuine infrastructure failure, but not on a stuck/blocked outcome
    # (those are reported to the dashboard for manual review instead).
    # Overridden by APPLY_ENGINE in .env (set from the dashboard's Settings).
    "apply_engine": "jev",
    # Model the Claude Code engine runs with. Overridden by APPLY_CLAUDE_MODEL.
    "claude_apply_model": "opus",
}

APPLY_ENGINES = ("claude", "jev")
CLAUDE_APPLY_MODELS = ("opus", "sonnet", "haiku")


def load_env():
    """Load environment variables from ~/.applypilot/.env if it exists."""
    from dotenv import load_dotenv
    if ENV_PATH.exists():
        load_dotenv(ENV_PATH)
    # Also try CWD .env as fallback
    load_dotenv()


def get_apply_engine() -> str:
    """Auto-apply engine chosen in Settings (APPLY_ENGINE), else the default."""
    load_env()
    engine = os.environ.get("APPLY_ENGINE", "").strip().lower()
    return engine if engine in APPLY_ENGINES else DEFAULTS["apply_engine"]


def get_claude_apply_model() -> str:
    """Claude model for the Claude Code engine (APPLY_CLAUDE_MODEL), else the default."""
    load_env()
    model = os.environ.get("APPLY_CLAUDE_MODEL", "").strip().lower()
    return model if model in CLAUDE_APPLY_MODELS else DEFAULTS["claude_apply_model"]


# ---------------------------------------------------------------------------
# Tier system — feature gating by installed dependencies
# ---------------------------------------------------------------------------

TIER_LABELS = {
    1: "Discovery",
    2: "AI Scoring & Tailoring",
    3: "Full Auto-Apply",
}

TIER_COMMANDS: dict[int, list[str]] = {
    1: ["run discover", "run enrich", "status", "dashboard"],
    2: ["run score", "run tailor", "run cover", "run pdf", "run"],
    3: ["apply"],
}


def get_tier() -> int:
    """Detect the current tier based on available dependencies.

    Tier 1 (Discovery):            Python + pip
    Tier 2 (AI Scoring & Tailoring): + LLM API key
    Tier 3 (Full Auto-Apply):       + Claude Code CLI + Chrome
    """
    load_env()

    has_llm = any(os.environ.get(k) for k in ("GEMINI_API_KEY", "OPENAI_API_KEY", "LLM_URL"))
    if not has_llm:
        return 1

    has_claude = shutil.which("claude") is not None
    try:
        get_chrome_path()
        has_chrome = True
    except FileNotFoundError:
        has_chrome = False

    if has_claude and has_chrome:
        return 3

    return 2


def check_tier(required: int, feature: str) -> None:
    """Raise SystemExit with a clear message if the current tier is too low.

    Args:
        required: Minimum tier needed (1, 2, or 3).
        feature: Human-readable description of the feature being gated.
    """
    current = get_tier()
    if current >= required:
        return

    from rich.console import Console
    _console = Console(stderr=True)

    missing: list[str] = []
    if required >= 2 and not any(os.environ.get(k) for k in ("GEMINI_API_KEY", "OPENAI_API_KEY", "LLM_URL")):
        missing.append("LLM API key — set it on the Context page in the dashboard, or set GEMINI_API_KEY")
    if required >= 3:
        if not shutil.which("claude"):
            missing.append("Claude Code CLI — install from [bold]https://claude.ai/code[/bold]")
        try:
            get_chrome_path()
        except FileNotFoundError:
            missing.append("Chrome/Chromium — install or set CHROME_PATH")

    _console.print(
        f"\n[red]'{feature}' requires {TIER_LABELS.get(required, f'Tier {required}')} (Tier {required}).[/red]\n"
        f"Current tier: {TIER_LABELS.get(current, f'Tier {current}')} (Tier {current})."
    )
    if missing:
        _console.print("\n[yellow]Missing:[/yellow]")
        for m in missing:
            _console.print(f"  - {m}")
    _console.print()
    raise SystemExit(1)


def _knowledge_base_folder_status(kb_dir: str) -> list[dict]:
    """Per-subfolder status of the knowledge base -- same "has real content"
    definition as scorer._load_knowledge_base (HTML comments stripped,
    frontmatter/headings stripped, empty after that = no real content), so
    this status reflects exactly what scoring will actually use."""
    base = Path(kb_dir)
    if not kb_dir or not base.is_dir():
        return []

    folders = []
    for index_path in sorted(base.glob("*/index.md")):
        raw = index_path.read_text(encoding="utf-8")
        content = re.sub(r"<!--.*?-->", "", raw, flags=re.DOTALL).strip()
        body = re.sub(r"^---\n.*?\n---\n", "", content, flags=re.DOTALL)
        body = re.sub(r"^#{1,6}.*$", "", body, flags=re.MULTILINE).strip()
        folders.append({
            "folder": index_path.parent.name,
            "chars": len(body),
        })
    return folders


def get_context_status() -> dict:
    """Unified snapshot of what ApplyPilot currently knows about the user.

    Content-level complement to get_tier()'s dependency-level check -- used
    by the webapp's Context page for both the "nothing set up yet"
    onboarding view and the ongoing gap checklist, so there's one gap model
    instead of two.
    """
    tier = get_tier()

    primary_name = get_primary_cv_name()
    cv_section = {
        "primary_cv": primary_name,
        "cv_count": len(list_cvs()),
        "resume_text_chars": len(read_cv_text(primary_name)) if primary_name else 0,
    }

    profile: dict = {}
    has_profile = profile_exists()
    if has_profile:
        try:
            profile = load_profile()
        except Exception:
            profile = {}
    personal = profile.get("personal", {})
    skills = profile.get("skills_boundary", {})
    skills_count = sum(len(v) for v in skills.values() if isinstance(v, list))
    profile_section = {
        "exists": has_profile,
        "has_name": bool(personal.get("full_name")),
        "has_email": bool(personal.get("email")),
        "skills_count": skills_count,
        "work_authorization_set": profile.get("work_authorization", {}).get("legally_authorized_to_work") is not None,
        "compensation_set": bool(profile.get("compensation", {}).get("salary_expectation")),
        "availability_set": bool(profile.get("availability", {}).get("earliest_start_date")),
    }

    kb_dir = profile.get("knowledge_base_dir", "")
    kb_folders = _knowledge_base_folder_status(kb_dir) if kb_dir else []
    kb_section = {
        "dir": kb_dir or None,
        "folder_count": len(kb_folders),
        "empty_folders": [f["folder"] for f in kb_folders if f["chars"] == 0],
    }

    search_exists = SEARCH_CONFIG_PATH.exists()
    query_count = 0
    if search_exists:
        try:
            query_count = len(load_search_config().queries)
        except Exception:
            search_exists = False
    search_section = {"exists": search_exists, "query_count": query_count}

    has_llm = any(os.environ.get(k) for k in ("GEMINI_API_KEY", "OPENAI_API_KEY", "LLM_URL"))
    has_claude = shutil.which("claude") is not None
    try:
        get_chrome_path()
        has_chrome = True
    except FileNotFoundError:
        has_chrome = False

    missing: list[str] = []
    if not has_llm:
        missing.append("LLM API key (set it in Settings)")
    if not primary_name:
        missing.append("A primary CV")
    elif cv_section["resume_text_chars"] == 0:
        missing.append(f"'{primary_name}' has no extracted text (scanned PDF?)")
    if not profile_section["exists"] or not profile_section["has_name"]:
        missing.append("Profile name (upload a CV to fill Profile.md, or write it yourself)")
    if profile_section["exists"] and not profile_section["work_authorization_set"]:
        missing.append("Work authorization (set it in Profile.md)")
    if not search_section["exists"] or search_section["query_count"] == 0:
        missing.append("Search queries (set them from the dashboard's Search)")
    if kb_section["empty_folders"]:
        missing.append(f"Knowledge base folder(s) with no content: {', '.join(kb_section['empty_folders'])}")

    return {
        "tier": tier,
        "tier_label": TIER_LABELS.get(tier, f"Tier {tier}"),
        "env": {"configured": has_llm},
        "cv": cv_section,
        "profile": profile_section,
        "knowledge_base": kb_section,
        "search": search_section,
        "claude_cli": has_claude,
        "chrome": has_chrome,
        # The jev apply engine's key -- optional: without it, auto-apply
        # falls back to the Claude Code engine (see launcher.py).
        "jev_key": bool(os.environ.get("TYPESAFE_API_KEY")),
        "missing": missing,
    }
