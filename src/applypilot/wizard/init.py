"""ApplyPilot first-time setup wizard.

Interactive flow that creates ~/.applypilot/ with:
  - resume.txt (and optionally resume.pdf)
  - profile.json
  - searches.yaml
  - .env (LLM API key)

AI features are configured before profile/search config (not after, like the
original ordering) because both of those steps can optionally use the LLM to
pre-fill their answers from the resume -- letting the user Enter-through
fields the AI got right and only retype the ones it didn't, instead of
typing every field by hand.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, Prompt

from applypilot.config import (
    APP_DIR,
    ENV_PATH,
    PROFILE_PATH,
    RESUME_PATH,
    RESUME_PDF_PATH,
    SEARCH_CONFIG_PATH,
    ensure_dirs,
)

console = Console()


def _prompt(label: str, ai_value: str = "", **kwargs) -> str:
    """Prompt.ask wrapper: an AI-suggested value (if any) becomes the
    default, so the user can just hit Enter to accept it or type to
    override. Falls back to whatever default the caller passed (or none,
    leaving the field required) when the AI didn't suggest anything."""
    if ai_value:
        kwargs["default"] = ai_value
    return Prompt.ask(label, **kwargs)


def _extract_pdf_text(pdf_path: Path) -> str:
    """Best-effort text extraction from a PDF (same approach as
    config.save_cv). Returns "" for scanned/image PDFs pypdf can't read."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(pdf_path))
        return "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Resume
# ---------------------------------------------------------------------------

def _setup_resume() -> str:
    """Prompt for resume file, copy into APP_DIR, and return its plain text
    (auto-extracted from PDF via pypdf) so later steps can feed it to the LLM."""
    console.print(Panel("[bold]Step 1: Resume[/bold]\nPoint to your master resume file (.txt or .pdf)."))

    while True:
        path_str = Prompt.ask("Resume file path")
        src = Path(path_str.strip().strip('"').strip("'")).expanduser().resolve()

        if not src.exists():
            console.print(f"[red]File not found:[/red] {src}")
            continue

        suffix = src.suffix.lower()
        if suffix not in (".txt", ".pdf"):
            console.print("[red]Unsupported format.[/red] Provide a .txt or .pdf file.")
            continue

        if suffix == ".txt":
            shutil.copy2(src, RESUME_PATH)
            console.print(f"[green]Copied to {RESUME_PATH}[/green]")
            return RESUME_PATH.read_text(encoding="utf-8")

        # .pdf: copy as-is, then auto-extract text for the AI-assisted steps
        shutil.copy2(src, RESUME_PDF_PATH)
        console.print(f"[green]Copied to {RESUME_PDF_PATH}[/green]")

        text = _extract_pdf_text(RESUME_PDF_PATH)
        if text:
            RESUME_PATH.write_text(text, encoding="utf-8")
            console.print(f"[green]Extracted text to {RESUME_PATH}[/green]")
            return text

        console.print("[yellow]Couldn't extract text from that PDF (likely a scanned image).[/yellow]")
        txt_path_str = Prompt.ask("Plain-text version of your resume (.txt)", default="")
        if txt_path_str.strip():
            txt_src = Path(txt_path_str.strip().strip('"').strip("'")).expanduser().resolve()
            if txt_src.exists():
                shutil.copy2(txt_src, RESUME_PATH)
                console.print(f"[green]Copied to {RESUME_PATH}[/green]")
                return RESUME_PATH.read_text(encoding="utf-8")
            console.print("[yellow]File not found, skipping plain-text copy.[/yellow]")
        return ""


# ---------------------------------------------------------------------------
# AI Features
# ---------------------------------------------------------------------------

def _setup_ai_features() -> bool:
    """Ask about AI scoring/tailoring -- optional LLM configuration. Returns
    whether an LLM is now configured, so later steps know whether to offer
    AI-assisted pre-fill."""
    console.print(Panel(
        "[bold]Step 2: AI Features (optional)[/bold]\n"
        "An LLM powers job scoring, resume tailoring, and -- if enabled here --\n"
        "pre-filling your profile and search config from your resume next.\n"
        "Without this, you'll fill those in by hand, and can still discover and enrich jobs."
    ))

    if not Confirm.ask("Enable AI scoring and resume tailoring?", default=True):
        console.print("[dim]Discovery-only mode. You can configure AI later with [bold]applypilot init[/bold].[/dim]")
        return False

    console.print("Supported providers: [bold]Gemini[/bold] (recommended, free tier), OpenAI, local (Ollama/llama.cpp)")
    provider = Prompt.ask(
        "Provider",
        choices=["gemini", "openai", "local"],
        default="gemini",
    )

    env_lines = ["# ApplyPilot configuration", ""]

    if provider == "gemini":
        api_key = Prompt.ask("Gemini API key (from aistudio.google.com)")
        model = Prompt.ask("Model", default="gemini-2.0-flash")
        env_lines.append(f"GEMINI_API_KEY={api_key}")
        env_lines.append(f"LLM_MODEL={model}")
    elif provider == "openai":
        api_key = Prompt.ask("OpenAI API key")
        model = Prompt.ask("Model", default="gpt-4o-mini")
        env_lines.append(f"OPENAI_API_KEY={api_key}")
        env_lines.append(f"LLM_MODEL={model}")
    elif provider == "local":
        url = Prompt.ask("Local LLM endpoint URL", default="http://localhost:8080/v1")
        model = Prompt.ask("Model name", default="local-model")
        env_lines.append(f"LLM_URL={url}")
        env_lines.append(f"LLM_MODEL={model}")

    env_lines.append("")
    ENV_PATH.write_text("\n".join(env_lines), encoding="utf-8")
    console.print(f"[green]AI configuration saved to {ENV_PATH}[/green]")

    # Load the key into this process now, so the profile/search steps below
    # can use it immediately instead of requiring a second `applypilot init`.
    from applypilot.config import load_env
    load_env()
    return True


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------

_PROFILE_AI_SECTIONS = ("personal", "experience", "skills_boundary", "resume_facts")


def _generate_profile_ai(resume_text: str) -> dict:
    """Ask the LLM to pre-fill profile fields from resume text.

    Returns a dict with (at least) the four sections above, each present as
    an empty dict/list on failure or on any field the LLM didn't find --
    callers only ever use these as Prompt.ask defaults, never as the final
    saved values, so a missing field just means the user types it by hand
    like before AI pre-fill existed.
    """
    from applypilot.llm import get_client
    from applypilot.scoring.tailor import extract_json

    empty = {section: {} for section in _PROFILE_AI_SECTIONS}

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
        console.print(f"[yellow]AI profile extraction failed ({e}); falling back to manual entry.[/yellow]")
        return empty

    for section in _PROFILE_AI_SECTIONS:
        if not isinstance(data.get(section), dict):
            data[section] = {}
    return data


def _setup_profile(resume_text: str, ai_enabled: bool) -> dict:
    """Walk through profile questions and return a nested profile dict."""
    console.print(Panel("[bold]Step 3: Profile[/bold]\nTell ApplyPilot about yourself. This powers scoring, tailoring, and auto-fill."))

    ai = {section: {} for section in _PROFILE_AI_SECTIONS}
    if ai_enabled and resume_text and Confirm.ask(
        "Pre-fill from your resume with AI? You'll still review (and can change) every field.",
        default=True,
    ):
        console.print("[dim]Reading your resume...[/dim]")
        ai = _generate_profile_ai(resume_text)

    p, e, sb, rf = (ai[section] for section in _PROFILE_AI_SECTIONS)

    profile: dict = {}

    # -- Personal --
    console.print("\n[bold cyan]Personal Information[/bold cyan]")
    full_name = _prompt("Full name", p.get("full_name", ""))
    profile["personal"] = {
        "full_name": full_name,
        "preferred_name": _prompt("Preferred/nickname (leave blank to use first name)", p.get("preferred_name", ""), default=""),
        "email": _prompt("Email address", p.get("email", "")),
        "phone": _prompt("Phone number", p.get("phone", ""), default=""),
        "city": _prompt("City", p.get("city", "")),
        "province_state": _prompt("Province/State (e.g. Ontario, California)", p.get("province_state", ""), default=""),
        "country": _prompt("Country", p.get("country", "")),
        "postal_code": _prompt("Postal/ZIP code", p.get("postal_code", ""), default=""),
        "address": _prompt("Street address (optional, used for form auto-fill)", p.get("address", ""), default=""),
        "linkedin_url": _prompt("LinkedIn URL", p.get("linkedin_url", ""), default=""),
        "github_url": _prompt("GitHub URL (optional)", p.get("github_url", ""), default=""),
        "portfolio_url": _prompt("Portfolio URL (optional)", p.get("portfolio_url", ""), default=""),
        "website_url": _prompt("Personal website URL (optional)", p.get("website_url", ""), default=""),
        "password": Prompt.ask("Job site password (used for login walls during auto-apply)", password=True, default=""),
    }

    # -- Work Authorization --
    console.print("\n[bold cyan]Work Authorization[/bold cyan]")
    profile["work_authorization"] = {
        "legally_authorized_to_work": Confirm.ask("Are you legally authorized to work in your target country?"),
        "require_sponsorship": Confirm.ask("Will you now or in the future need sponsorship?"),
        "work_permit_type": Prompt.ask("Work permit type (e.g. Citizen, PR, Open Work Permit — leave blank if N/A)", default=""),
    }

    # -- Compensation --
    console.print("\n[bold cyan]Compensation[/bold cyan]")
    salary = Prompt.ask("Expected annual salary (number)", default="")
    salary_currency = Prompt.ask("Currency", default="USD")
    salary_range = Prompt.ask("Acceptable range (e.g. 80000-120000)", default="")
    range_parts = salary_range.split("-") if "-" in salary_range else [salary, salary]
    profile["compensation"] = {
        "salary_expectation": salary,
        "salary_currency": salary_currency,
        "salary_range_min": range_parts[0].strip(),
        "salary_range_max": range_parts[1].strip() if len(range_parts) > 1 else range_parts[0].strip(),
    }

    # -- Experience --
    console.print("\n[bold cyan]Experience[/bold cyan]")
    current_title = _prompt("Current/most recent job title", e.get("current_title", ""), default="")
    target_role = _prompt(
        "Target role (what you're applying for, e.g. 'Senior Backend Engineer')",
        e.get("target_role", ""),
        default=current_title,
    )
    profile["experience"] = {
        "years_of_experience_total": _prompt("Years of professional experience", e.get("years_of_experience_total", ""), default=""),
        "education_level": _prompt("Highest education (e.g. Bachelor's, Master's, PhD, Self-taught)", e.get("education_level", ""), default=""),
        "current_title": current_title,
        "target_role": target_role,
    }

    # -- Skills Boundary --
    console.print("\n[bold cyan]Skills[/bold cyan] (comma-separated)")
    langs = _prompt("Programming languages", ", ".join(sb.get("programming_languages", [])), default="")
    frameworks = _prompt("Frameworks & libraries", ", ".join(sb.get("frameworks", [])), default="")
    tools = _prompt("Tools & platforms (e.g. Docker, AWS, Git)", ", ".join(sb.get("tools", [])), default="")
    profile["skills_boundary"] = {
        "programming_languages": [s.strip() for s in langs.split(",") if s.strip()],
        "frameworks": [s.strip() for s in frameworks.split(",") if s.strip()],
        "tools": [s.strip() for s in tools.split(",") if s.strip()],
    }

    # -- Resume Facts (preserved truths for tailoring) --
    console.print("\n[bold cyan]Resume Facts[/bold cyan]")
    console.print("[dim]These are preserved exactly during resume tailoring — the AI will never change them.[/dim]")
    companies = _prompt("Companies to always keep (comma-separated)", ", ".join(rf.get("preserved_companies", [])), default="")
    projects = _prompt("Projects to always keep (comma-separated)", ", ".join(rf.get("preserved_projects", [])), default="")
    school = _prompt("School name(s) to preserve", rf.get("preserved_school", ""), default="")
    metrics = _prompt("Real metrics to preserve (e.g. '99.9% uptime, 50k users')", ", ".join(rf.get("real_metrics", [])), default="")
    profile["resume_facts"] = {
        "preserved_companies": [s.strip() for s in companies.split(",") if s.strip()],
        "preserved_projects": [s.strip() for s in projects.split(",") if s.strip()],
        "preserved_school": school.strip(),
        "real_metrics": [s.strip() for s in metrics.split(",") if s.strip()],
    }

    # -- EEO Voluntary (defaults) --
    profile["eeo_voluntary"] = {
        "gender": "Decline to self-identify",
        "race_ethnicity": "Decline to self-identify",
        "veteran_status": "Decline to self-identify",
        "disability_status": "Decline to self-identify",
    }

    # -- Availability --
    profile["availability"] = {
        "earliest_start_date": Prompt.ask("Earliest start date", default="Immediately"),
    }

    # Save
    PROFILE_PATH.write_text(json.dumps(profile, indent=2, ensure_ascii=False), encoding="utf-8")
    console.print(f"\n[green]Profile saved to {PROFILE_PATH}[/green]")
    return profile


# ---------------------------------------------------------------------------
# Search config
# ---------------------------------------------------------------------------

def _generate_search_ai(resume_text: str, profile: dict) -> dict:
    """Ask the LLM to suggest target job title queries and titles to
    exclude, given the resume and the experience section just collected.
    Returns {"queries": [...], "exclude_titles": [...]} -- empty on failure,
    same "used only as Prompt.ask defaults" contract as _generate_profile_ai."""
    from applypilot.llm import get_client
    from applypilot.scoring.tailor import extract_json

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
        console.print(f"[yellow]AI search suggestion failed ({e}); falling back to manual entry.[/yellow]")
        return {"queries": [], "exclude_titles": []}

    if not isinstance(data.get("queries"), list):
        data["queries"] = []
    if not isinstance(data.get("exclude_titles"), list):
        data["exclude_titles"] = []
    return data


def _setup_searches(profile: dict, resume_text: str, ai_enabled: bool) -> None:
    """Generate a searches.yaml from user input (optionally AI-suggested)."""
    console.print(Panel("[bold]Step 4: Job Search Config[/bold]\nDefine what you're looking for."))

    ai_queries: list[str] = []
    ai_exclude = ""
    if ai_enabled and resume_text and Confirm.ask(
        "Suggest target job titles from your resume with AI? You can edit the list before saving.",
        default=True,
    ):
        console.print("[dim]Thinking about roles that fit your background...[/dim]")
        ai = _generate_search_ai(resume_text, profile)
        ai_queries = [q["query"] for q in ai["queries"] if isinstance(q, dict) and q.get("query")]
        ai_exclude = ", ".join(ai["exclude_titles"])
        if ai_queries:
            console.print(f"[dim]AI suggests: {', '.join(ai_queries)}[/dim]")

    personal = profile.get("personal", {})
    default_location = ", ".join(v for v in (personal.get("city"), personal.get("country")) if v) or "Remote"
    location = Prompt.ask("Target location (e.g. 'Remote', 'Canada', 'New York, NY')", default=default_location)
    distance_str = Prompt.ask("Search radius in miles (0 for remote-only)", default="0")
    try:
        distance = int(distance_str)
    except ValueError:
        distance = 0

    roles_raw = _prompt(
        "Target job titles (comma-separated, e.g. 'Backend Engineer, Full Stack Developer')",
        ", ".join(ai_queries),
    )
    roles = [r.strip() for r in roles_raw.split(",") if r.strip()]

    if not roles:
        console.print("[yellow]No roles provided. Using a default set.[/yellow]")
        roles = ["Software Engineer"]

    exclude_raw = Prompt.ask("Titles to exclude (comma-separated, optional)", default=ai_exclude)
    exclude_titles = [r.strip() for r in exclude_raw.split(",") if r.strip()]

    # Build YAML content
    lines = [
        "# ApplyPilot search configuration",
        "# Edit this file to refine your job search queries.",
        "",
        "defaults:",
        "  hours_old: 72",
        "  results_per_site: 50",
        "",
        "locations:",
        f'  - location: "{location}"',
        f"    remote: {str(distance == 0).lower()}",
        "",
        "queries:",
    ]
    for i, role in enumerate(roles):
        lines.append(f'  - query: "{role}"')
        lines.append(f"    tier: {min(i + 1, 3)}")

    if exclude_titles:
        lines.append("")
        lines.append("exclude_titles:")
        for t in exclude_titles:
            lines.append(f'  - "{t}"')

    SEARCH_CONFIG_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    console.print(f"[green]Search config saved to {SEARCH_CONFIG_PATH}[/green]")


# ---------------------------------------------------------------------------
# Auto-Apply
# ---------------------------------------------------------------------------

def _setup_auto_apply() -> None:
    """Configure autonomous job application (requires Claude Code CLI)."""
    console.print(Panel(
        "[bold]Step 5: Auto-Apply (optional)[/bold]\n"
        "ApplyPilot can autonomously fill and submit job applications\n"
        "using Claude Code as the browser agent."
    ))

    if not Confirm.ask("Enable autonomous job applications?", default=True):
        console.print("[dim]You can apply manually using the tailored resumes ApplyPilot generates.[/dim]")
        return

    # Check for Claude Code CLI
    if shutil.which("claude"):
        console.print("[green]Claude Code CLI detected.[/green]")
    else:
        console.print(
            "[yellow]Claude Code CLI not found on PATH.[/yellow]\n"
            "Install it from: [bold]https://claude.ai/code[/bold]\n"
            "Auto-apply won't work until Claude Code is installed."
        )

    # Optional: CapSolver for CAPTCHAs
    console.print("\n[dim]Some job sites use CAPTCHAs. CapSolver can handle them automatically.[/dim]")
    if Confirm.ask("Configure CapSolver API key? (optional)", default=False):
        capsolver_key = Prompt.ask("CapSolver API key")
        # Append to existing .env or create
        if ENV_PATH.exists():
            existing = ENV_PATH.read_text(encoding="utf-8")
            if "CAPSOLVER_API_KEY" not in existing:
                ENV_PATH.write_text(
                    existing.rstrip() + f"\nCAPSOLVER_API_KEY={capsolver_key}\n",
                    encoding="utf-8",
                )
        else:
            ENV_PATH.write_text(f"# ApplyPilot configuration\nCAPSOLVER_API_KEY={capsolver_key}\n", encoding="utf-8")
        console.print("[green]CapSolver key saved.[/green]")
    else:
        console.print("[dim]Skipped. Add CAPSOLVER_API_KEY to .env later if needed.[/dim]")


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------

def run_wizard() -> None:
    """Run the full interactive setup wizard."""
    console.print()
    console.print(
        Panel.fit(
            "[bold green]ApplyPilot Setup Wizard[/bold green]\n\n"
            "This will create your configuration at:\n"
            f"  [cyan]{APP_DIR}[/cyan]\n\n"
            "You can re-run this anytime with [bold]applypilot init[/bold].",
            border_style="green",
        )
    )

    ensure_dirs()
    console.print(f"[dim]Created {APP_DIR}[/dim]\n")

    # Step 1: Resume
    resume_text = _setup_resume()
    console.print()

    # Step 2: AI features (optional LLM) -- configured before profile/search
    # so those steps can offer AI-assisted pre-fill from the resume.
    ai_enabled = _setup_ai_features()
    console.print()

    # Step 3: Profile
    profile = _setup_profile(resume_text, ai_enabled)
    console.print()

    # Step 4: Search config
    _setup_searches(profile, resume_text, ai_enabled)
    console.print()

    # Step 5: Auto-apply (Claude Code detection)
    _setup_auto_apply()
    console.print()

    # Done — show tier status
    from applypilot.config import get_tier, TIER_LABELS, TIER_COMMANDS

    tier = get_tier()

    tier_lines: list[str] = []
    for t in range(1, 4):
        label = TIER_LABELS[t]
        cmds = ", ".join(f"[bold]{c}[/bold]" for c in TIER_COMMANDS[t])
        if t <= tier:
            tier_lines.append(f"  [green]✓ Tier {t} — {label}[/green]  ({cmds})")
        elif t == tier + 1:
            tier_lines.append(f"  [yellow]→ Tier {t} — {label}[/yellow]  ({cmds})")
        else:
            tier_lines.append(f"  [dim]✗ Tier {t} — {label}  ({cmds})[/dim]")

    unlock_hint = ""
    if tier == 1:
        unlock_hint = "\n[dim]To unlock Tier 2: configure an LLM API key (re-run [bold]applypilot init[/bold]).[/dim]"
    elif tier == 2:
        unlock_hint = "\n[dim]To unlock Tier 3: install Claude Code CLI + Chrome.[/dim]"

    console.print(
        Panel.fit(
            "[bold green]Setup complete![/bold green]\n\n"
            f"[bold]Your tier: Tier {tier} — {TIER_LABELS[tier]}[/bold]\n\n"
            + "\n".join(tier_lines)
            + unlock_hint,
            border_style="green",
        )
    )
