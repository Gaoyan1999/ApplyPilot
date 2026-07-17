"""ApplyPilot configuration: paths, platform detection, user data."""

import os
import platform
import shutil
from pathlib import Path

# User data directory — all user-specific files live here
APP_DIR = Path(os.environ.get("APPLYPILOT_DIR", Path.home() / ".applypilot"))

# Core paths
DB_PATH = APP_DIR / "applypilot.db"
PROFILE_PATH = APP_DIR / "profile.json"
RESUME_PATH = APP_DIR / "resume.txt"
RESUME_PDF_PATH = APP_DIR / "resume.pdf"
SEARCH_CONFIG_PATH = APP_DIR / "searches.yaml"
PROMPTS_PATH = APP_DIR / "prompts.json"
ENV_PATH = APP_DIR / ".env"

# Generated output
TAILORED_DIR = APP_DIR / "tailored_resumes"
COVER_LETTER_DIR = APP_DIR / "cover_letters"
LOG_DIR = APP_DIR / "logs"

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
    for d in [APP_DIR, TAILORED_DIR, COVER_LETTER_DIR, LOG_DIR, CHROME_WORKER_DIR, APPLY_WORKER_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def load_profile() -> dict:
    """Load user profile from ~/.applypilot/profile.json."""
    import json
    if not PROFILE_PATH.exists():
        raise FileNotFoundError(
            f"Profile not found at {PROFILE_PATH}. Run `applypilot init` first."
        )
    return json.loads(PROFILE_PATH.read_text(encoding="utf-8"))


def load_search_config() -> dict:
    """Load search configuration from ~/.applypilot/searches.yaml."""
    import yaml
    if not SEARCH_CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"Search config not found at {SEARCH_CONFIG_PATH}. Run `applypilot init` first."
        )
    return yaml.safe_load(SEARCH_CONFIG_PATH.read_text(encoding="utf-8"))


# Top-level searches.yaml keys the web dashboard's config editor manages.
# Everything else in the file (country, glassdoor_location_map, location
# accept/reject patterns, ...) passes through save_search_config() untouched.
_WEB_MANAGED_KEYS = ("queries", "locations", "exclude_titles", "boards")
_WEB_MANAGED_DEFAULTS = ("results_per_site", "hours_old")


def save_search_config(data: dict) -> dict:
    """Merge web-editable fields into searches.yaml and persist it.

    Only `queries`, `locations`, `exclude_titles`, `boards`, and
    `defaults.results_per_site` / `defaults.hours_old` are overwritten --
    any other top-level key already in the file is preserved as-is.

    A one-time `searches.yaml.bak` snapshot of the pre-web-edit file is kept
    so a hand-tuned file (with comments, which this rewrite cannot preserve)
    isn't lost the first time someone saves from the dashboard.

    Returns the full merged config that was written.
    """
    import yaml

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

    APP_DIR.mkdir(parents=True, exist_ok=True)
    header = (
        "# ApplyPilot search configuration\n"
        "# Edited via the web dashboard — comments beyond this file's original\n"
        "# backup (searches.yaml.bak) are not preserved on save.\n\n"
    )
    tmp_path = SEARCH_CONFIG_PATH.with_name(SEARCH_CONFIG_PATH.name + ".tmp")
    tmp_path.write_text(
        header + yaml.safe_dump(current, sort_keys=False, default_flow_style=False),
        encoding="utf-8",
    )
    tmp_path.replace(SEARCH_CONFIG_PATH)

    return current


# Prompt keys the web dashboard's Settings page can override. Each maps to a
# module-level DEFAULT_*_TEMPLATE constant (in the corresponding scoring/*
# module) that's used whenever no override is stored here.
PROMPT_KEYS = ("cover_letter", "tailoring", "scoring")


def load_prompt_overrides() -> dict[str, str]:
    """Load user-customized prompt templates from ~/.applypilot/prompts.json.

    Unlike profile.json/searches.yaml, this file is optional -- prompt
    customization is opt-in, so a missing or unreadable file just means
    "use the built-in defaults" rather than an error.
    """
    import json
    if not PROMPTS_PATH.exists():
        return {}
    try:
        data = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: v for k, v in data.items() if k in PROMPT_KEYS and isinstance(v, str) and v.strip()}


def save_prompt_overrides(data: dict[str, str]) -> dict[str, str]:
    """Persist prompt template overrides, dropping any key left blank.

    A blank value for a known key means "reset to default" -- it's simply
    omitted from the saved file rather than stored as an empty override.

    Returns the overrides dict that was written.
    """
    import json

    overrides = {
        key: data[key].strip()
        for key in PROMPT_KEYS
        if isinstance(data.get(key), str) and data[key].strip()
    }

    APP_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = PROMPTS_PATH.with_name(PROMPTS_PATH.name + ".tmp")
    tmp_path.write_text(json.dumps(overrides, indent=2), encoding="utf-8")
    tmp_path.replace(PROMPTS_PATH)

    return overrides


def get_excluded_titles() -> list[str]:
    """Lowercased exclude_titles terms from searches.yaml, for title filtering at storage time."""
    return [t.lower() for t in load_search_config().get("exclude_titles", [])]


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
}


def load_env():
    """Load environment variables from ~/.applypilot/.env if it exists."""
    from dotenv import load_dotenv
    if ENV_PATH.exists():
        load_dotenv(ENV_PATH)
    # Also try CWD .env as fallback
    load_dotenv()


# ---------------------------------------------------------------------------
# Tier system — feature gating by installed dependencies
# ---------------------------------------------------------------------------

TIER_LABELS = {
    1: "Discovery",
    2: "AI Scoring & Tailoring",
    3: "Full Auto-Apply",
}

TIER_COMMANDS: dict[int, list[str]] = {
    1: ["init", "run discover", "run enrich", "status", "dashboard"],
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
        missing.append("LLM API key — run [bold]applypilot init[/bold] or set GEMINI_API_KEY")
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
