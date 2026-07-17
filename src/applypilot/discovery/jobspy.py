"""JobSpy-based job discovery: searches Indeed, LinkedIn, Glassdoor, ZipRecruiter.

Uses python-jobspy to scrape multiple job boards, deduplicates results,
parses salary ranges, and stores everything in the ApplyPilot database.

Search queries, locations, and filtering rules are loaded from the user's
search configuration YAML (searches.yaml) rather than being hardcoded.
"""

import logging
import sqlite3
import time
from collections.abc import Callable
from datetime import datetime, timezone

from jobspy import scrape_jobs

from applypilot import config
from applypilot.database import get_connection, init_db, store_jobs
from applypilot.employment_type import classify_job_type

log = logging.getLogger(__name__)


# -- Proxy parsing -----------------------------------------------------------

def parse_proxy(proxy_str: str) -> dict:
    """Parse host:port:user:pass into components."""
    parts = proxy_str.split(":")
    if len(parts) == 4:
        host, port, user, passwd = parts
        return {
            "host": host,
            "port": port,
            "user": user,
            "pass": passwd,
            "jobspy": f"{user}:{passwd}@{host}:{port}",
            "playwright": {
                "server": f"http://{host}:{port}",
                "username": user,
                "password": passwd,
            },
        }
    elif len(parts) == 2:
        host, port = parts
        return {
            "host": host,
            "port": port,
            "user": None,
            "pass": None,
            "jobspy": f"{host}:{port}",
            "playwright": {"server": f"http://{host}:{port}"},
        }
    else:
        raise ValueError(
            f"Proxy format not recognized: {proxy_str}. "
            f"Expected: host:port:user:pass or host:port"
        )


# -- Retry wrapper -----------------------------------------------------------

def _scrape_with_retry(kwargs: dict, max_retries: int = 5, backoff: float = 5.0):
    """Call scrape_jobs with retry on transient failures."""
    for attempt in range(max_retries + 1):
        try:
            return scrape_jobs(**kwargs)
        except Exception as e:
            err = str(e).lower()
            transient = any(k in err for k in ("timeout", "429", "proxy", "connection", "reset", "refused"))
            if transient and attempt < max_retries:
                wait = backoff * (attempt + 1)
                log.warning("Retry %d/%d in %.0fs: %s", attempt + 1, max_retries, wait, e)
                time.sleep(wait)
            else:
                raise


# -- Location filtering ------------------------------------------------------

def _load_location_config(search_cfg: dict) -> tuple[list[str], list[str]]:
    """Extract accept/reject location lists from search config.

    Falls back to sensible defaults if not defined in the YAML.
    """
    location_cfg = search_cfg.get("location", {})
    accept = location_cfg.get("accept_patterns", [])
    reject = location_cfg.get("reject_patterns", [])
    return accept, reject


def _location_ok(location: str | None, accept: list[str], reject: list[str]) -> bool:
    """Check if a job location passes the user's location filter.

    Remote jobs are always accepted. Non-remote jobs must match an accept
    pattern and not match a reject pattern.
    """
    if not location:
        return True  # unknown location -- keep it, let scorer decide

    loc = location.lower()

    # Remote jobs always OK
    if any(r in loc for r in ("remote", "anywhere", "work from home", "wfh", "distributed")):
        return True

    # Reject non-remote matches
    for r in reject:
        if r.lower() in loc:
            return False

    # Accept matches
    for a in accept:
        if a.lower() in loc:
            return True

    # No match -- reject unknown
    return False


# -- DB storage (JobSpy DataFrame -> SQLite) ---------------------------------

def store_jobspy_results(
    conn: sqlite3.Connection,
    df,
    source_label: str,
    by_site: dict[str, int] | None = None,
    new_urls: list[str] | None = None,
) -> tuple[int, int]:
    """Store JobSpy DataFrame results into the DB. Returns (new, existing).

    If `by_site` is passed, it's updated in place with a per-site count of
    newly-inserted rows (site label as stored, i.e. `row["site"]` or
    `source_label` as a fallback) -- lets callers report live discovery
    progress broken down by job board.

    If `new_urls` is passed, every newly-inserted job's URL is appended to
    it -- lets a caller (the web dashboard) later discard just this run's
    new rows without touching anything already in the DB.
    """
    from applypilot.config import get_excluded_titles

    exclude_titles = get_excluded_titles()

    now = datetime.now(timezone.utc).isoformat()
    new = 0
    existing = 0

    for _, row in df.iterrows():
        url = str(row.get("job_url", ""))
        if not url or url == "nan":
            continue

        title = str(row.get("title", "")) if str(row.get("title", "")) != "nan" else None
        if title and any(term in title.lower() for term in exclude_titles):
            continue
        job_type_raw = str(row.get("job_type", "")) if str(row.get("job_type", "")) != "nan" else None
        job_type = classify_job_type(job_type_raw, title)
        company = str(row.get("company", "")) if str(row.get("company", "")) != "nan" else None
        location_str = str(row.get("location", "")) if str(row.get("location", "")) != "nan" else None

        # Build salary string from min/max
        salary = None
        min_amt = row.get("min_amount")
        max_amt = row.get("max_amount")
        interval = str(row.get("interval", "")) if str(row.get("interval", "")) != "nan" else ""
        currency = str(row.get("currency", "")) if str(row.get("currency", "")) != "nan" else ""
        if min_amt and str(min_amt) != "nan":
            if max_amt and str(max_amt) != "nan":
                salary = f"{currency}{int(float(min_amt)):,}-{currency}{int(float(max_amt)):,}"
            else:
                salary = f"{currency}{int(float(min_amt)):,}"
            if interval:
                salary += f"/{interval}"

        description = str(row.get("description", "")) if str(row.get("description", "")) != "nan" else None
        site_name = str(row.get("site", source_label))
        is_remote = row.get("is_remote", False)

        site_label = f"{site_name}"
        if is_remote:
            location_str = f"{location_str} (Remote)" if location_str else "Remote"

        strategy = "jobspy"

        # If JobSpy gave us a full description, promote it directly
        full_description = None
        detail_scraped_at = None
        if description and len(description) > 200:
            full_description = description
            detail_scraped_at = now

        # Extract apply URL if JobSpy provided it
        raw_apply_url = row.get("job_url_direct")
        apply_url = (
            str(raw_apply_url)
            if raw_apply_url is not None and str(raw_apply_url) != "nan"
            else None
        )

        try:
            conn.execute(
                "INSERT INTO jobs (url, title, company, salary, description, location, site, strategy, discovered_at, "
                "full_description, application_url, detail_scraped_at, job_type) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (url, title, company, salary, description, location_str, site_label, strategy, now,
                 full_description, apply_url, detail_scraped_at, job_type),
            )
            new += 1
            if by_site is not None:
                by_site[site_label] = by_site.get(site_label, 0) + 1
            if new_urls is not None:
                new_urls.append(url)
        except sqlite3.IntegrityError:
            existing += 1

    conn.commit()
    return new, existing


# -- Single search execution -------------------------------------------------

def _run_one_search(
    search: dict,
    sites: list[str],
    results_per_site: int,
    hours_old: int,
    proxy_config: dict | None,
    defaults: dict,
    max_retries: int,
    accept_locs: list[str],
    reject_locs: list[str],
    glassdoor_map: dict,
    on_warning: Callable[[str], None] | None = None,
) -> dict:
    """Run a single search query and store results in DB.

    A site-group failure (after `_scrape_with_retry` exhausts its retries) or
    a DB storage error doesn't abort the query -- it's recorded via
    `on_warning` and the query continues with whatever data was gathered.
    """
    s = search
    label = f"\"{s['query']}\" in {s['location']} {'(remote)' if s.get('remote') else ''}"
    if "tier" in s:
        label += f" [tier {s['tier']}]"

    # Split sites: Glassdoor needs simplified location, others use original
    gd_location = glassdoor_map.get(s["location"], s["location"].split(",")[0])
    has_glassdoor = "glassdoor" in sites
    other_sites = [si for si in sites if si != "glassdoor"]

    all_dfs = []

    # Run non-Glassdoor sites with original location
    if other_sites:
        kwargs = {
            "site_name": other_sites,
            "search_term": s["query"],
            "location": s["location"],
            "results_wanted": results_per_site,
            "hours_old": hours_old,
            "description_format": "markdown",
            "country_indeed": defaults.get("country_indeed", "usa"),
            "verbose": 2,
        }
        if s.get("remote"):
            kwargs["is_remote"] = True
        if proxy_config:
            kwargs["proxies"] = [proxy_config["jobspy"]]
        fetch_description = "linkedin" in other_sites
        if fetch_description:
            kwargs["linkedin_fetch_description"] = True
        log.info("[%s] list stage -> querying %s (results_wanted=%d, hours_old=%d)",
                 label, ", ".join(other_sites), results_per_site, hours_old)
        log.info("[%s] scrape_jobs payload: %s", label, {k: v for k, v in kwargs.items() if k != "proxies"})
        try:
            df = _scrape_with_retry(kwargs, max_retries=max_retries)
            all_dfs.append(df)
            if "site" in df.columns:
                site_counts = df["site"].value_counts().to_dict()
                log.info("[%s] list stage -> found %d jobs (%s)",
                         label, len(df), ", ".join(f"{k}={v}" for k, v in site_counts.items()))
            else:
                log.info("[%s] list stage -> found %d jobs", label, len(df))
            if fetch_description and "site" in df.columns:
                li_df = df[df["site"] == "linkedin"]
                li_detail = int(li_df["description"].notna().sum()) if "description" in li_df.columns else 0
                log.info("[%s] detail stage -> LinkedIn: %d jobs listed, %d detail-page requests fetched",
                         label, len(li_df), li_detail)
        except Exception as e:
            log.error("[%s] (non-gd): %s", label, e)
            if on_warning:
                on_warning(f"[{label}] {', '.join(other_sites)} failed after {max_retries} retries: {e}")

    # Run Glassdoor separately with simplified location
    if has_glassdoor:
        gd_kwargs = {
            "site_name": ["glassdoor"],
            "search_term": s["query"],
            "location": gd_location,
            "results_wanted": results_per_site,
            "hours_old": hours_old,
            "description_format": "markdown",
            "verbose": 2,
        }
        if s.get("remote"):
            gd_kwargs["is_remote"] = True
        if proxy_config:
            gd_kwargs["proxies"] = [proxy_config["jobspy"]]
        log.info("[%s] list stage -> querying glassdoor (results_wanted=%d, hours_old=%d)",
                 label, results_per_site, hours_old)
        log.info("[%s] scrape_jobs payload: %s", label, {k: v for k, v in gd_kwargs.items() if k != "proxies"})
        try:
            gd_df = _scrape_with_retry(gd_kwargs, max_retries=max_retries)
            all_dfs.append(gd_df)
        except Exception as e:
            log.error("[%s] (glassdoor): %s", label, e)
            if on_warning:
                on_warning(f"[{label}] glassdoor failed after {max_retries} retries: {e}")

    if not all_dfs:
        log.error("[%s]: all sites failed", label)
        return {"new": 0, "existing": 0, "errors": 1, "filtered": 0, "total": 0, "label": label, "by_site": {}, "new_urls": []}

    import pandas as pd
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FutureWarning)
        df = pd.concat(all_dfs, ignore_index=True) if len(all_dfs) > 1 else all_dfs[0]

    if len(df) == 0:
        log.info("[%s] 0 results", label)
        return {"new": 0, "existing": 0, "errors": 0, "filtered": 0, "total": 0, "label": label, "by_site": {}, "new_urls": []}

    # Filter by location before storing
    before = len(df)
    df = df[df.apply(lambda row: _location_ok(
        str(row.get("location", "")) if str(row.get("location", "")) != "nan" else None,
        accept_locs, reject_locs,
    ), axis=1)]
    filtered = before - len(df)

    conn = get_connection()
    by_site: dict[str, int] = {}
    new_urls: list[str] = []
    try:
        new, existing = store_jobspy_results(conn, df, s["query"], by_site=by_site, new_urls=new_urls)
    except Exception as e:
        # Storage errors shouldn't abort the whole crawl -- log, warn, move on.
        log.error("[%s] failed to store results: %s", label, e)
        if on_warning:
            on_warning(f"[{label}] failed to store results: {e}")
        return {
            "new": 0, "existing": 0, "errors": 1, "filtered": filtered, "total": before,
            "label": label, "by_site": {}, "new_urls": [],
        }

    msg = f"[{label}] {before} results -> {new} new, {existing} dupes"
    if filtered:
        msg += f", {filtered} filtered (location)"
    log.info(msg)

    return {
        "new": new, "existing": existing, "errors": 0, "filtered": filtered,
        "total": before, "label": label, "by_site": by_site, "new_urls": new_urls,
    }


# -- Single query search -----------------------------------------------------

def search_jobs(
    query: str,
    location: str,
    sites: list[str] | None = None,
    remote_only: bool = False,
    results_per_site: int = 50,
    hours_old: int = 72,
    proxy: str | None = None,
    country_indeed: str = "usa",
) -> dict:
    """Run a single job search via JobSpy and store results in DB."""
    if sites is None:
        sites = ["indeed", "linkedin", "zip_recruiter"]

    proxy_config = parse_proxy(proxy) if proxy else None

    log.info("Search: \"%s\" in %s | sites=%s | remote=%s", query, location, sites, remote_only)

    kwargs = {
        "site_name": sites,
        "search_term": query,
        "location": location,
        "results_wanted": results_per_site,
        "hours_old": hours_old,
        "description_format": "markdown",
        "country_indeed": country_indeed,
        "verbose": 2,
    }

    if remote_only:
        kwargs["is_remote"] = True

    if proxy_config:
        kwargs["proxies"] = [proxy_config["jobspy"]]

    if "linkedin" in sites:
        kwargs["linkedin_fetch_description"] = True

    try:
        df = scrape_jobs(**kwargs)
    except Exception as e:
        log.error("JobSpy search failed: %s", e)
        return {"error": str(e), "total": 0, "new": 0, "existing": 0}

    total = len(df)
    log.info("JobSpy returned %d results", total)

    if total == 0:
        return {"total": 0, "new": 0, "existing": 0}

    if "site" in df.columns:
        site_counts = df["site"].value_counts()
        for site, count in site_counts.items():
            log.info("  %s: %d", site, count)

    conn = init_db()
    new, existing = store_jobspy_results(conn, df, query)
    log.info("Stored: %d new, %d already in DB", new, existing)

    db_total = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
    pending = conn.execute("SELECT COUNT(*) FROM jobs WHERE detail_scraped_at IS NULL").fetchone()[0]
    log.info("DB total: %d jobs, %d pending detail scrape", db_total, pending)

    return {"total": total, "new": new, "existing": existing}


# -- Full crawl (all queries x all locations) --------------------------------

def _full_crawl(
    search_cfg: dict,
    tiers: list[int] | None = None,
    locations: list[str] | None = None,
    sites: list[str] | None = None,
    results_per_site: int = 100,
    hours_old: int = 72,
    proxy: str | None = None,
    max_retries: int = 5,
    on_progress: Callable[[dict], None] | None = None,
    on_warning: Callable[[str], None] | None = None,
) -> dict:
    """Run all search queries from search config across all locations.

    If `on_progress` is passed, it's called after every query with a dict of
    the running totals so far: queries_done, queries_total, new, existing,
    errors, by_site (cumulative new-job counts per job board).

    If `on_warning` is passed, it's called once for every query/site that
    permanently failed (after `max_retries` retries) or hit a storage error --
    these don't abort the crawl, just get reported so the caller can surface
    them without blocking progress.
    """
    if sites is None:
        sites = ["indeed", "linkedin", "zip_recruiter"]

    # Build search combinations from config
    queries = search_cfg.get("queries", [])
    locs = search_cfg.get("locations", [])
    defaults = search_cfg.get("defaults", {})
    glassdoor_map = search_cfg.get("glassdoor_location_map", {})
    accept_locs, reject_locs = _load_location_config(search_cfg)

    if tiers:
        queries = [q for q in queries if q.get("tier") in tiers]
    if locations:
        locs = [loc for loc in locs if loc.get("label") in locations]

    searches = []
    for q in queries:
        for loc in locs:
            searches.append({
                "query": q["query"],
                "location": loc["location"],
                "remote": loc.get("remote", False),
                "tier": q.get("tier", 0),
            })

    proxy_config = parse_proxy(proxy) if proxy else None

    log.info("Full crawl: %d search combinations", len(searches))
    log.info("Sites: %s | Results/site: %d | Hours old: %d",
             ", ".join(sites), results_per_site, hours_old)

    # Ensure DB schema is ready
    init_db()

    total_new = 0
    total_existing = 0
    total_errors = 0
    total_by_site: dict[str, int] = {}
    total_new_urls: list[str] = []
    completed = 0

    # Report the true total up front -- otherwise a caller polling status
    # sees queries_total=0 (e.g. "0 of 0 searches run") until the first of
    # potentially many combos finishes, which can take a while.
    if on_progress:
        on_progress({
            "queries_done": 0,
            "queries_total": len(searches),
            "new": 0,
            "existing": 0,
            "errors": 0,
            "by_site": {},
            "current_query": None,
            "current_location": None,
        })

    for s in searches:
        loc_label = f"{s['location']} (remote)" if s.get("remote") else s["location"]

        # Reported before the (potentially slow) scrape call so a status
        # poll mid-search shows what's actually in flight, not just the
        # count of what's already finished.
        if on_progress:
            on_progress({
                "queries_done": completed,
                "queries_total": len(searches),
                "new": total_new,
                "existing": total_existing,
                "errors": total_errors,
                "by_site": dict(total_by_site),
                "current_query": s["query"],
                "current_location": loc_label,
            })

        result = _run_one_search(
            s, sites, results_per_site, hours_old,
            proxy_config, defaults, max_retries,
            accept_locs, reject_locs, glassdoor_map,
            on_warning=on_warning,
        )
        completed += 1
        total_new += result["new"]
        total_existing += result["existing"]
        total_errors += result["errors"]
        for site, count in result.get("by_site", {}).items():
            total_by_site[site] = total_by_site.get(site, 0) + count
        total_new_urls.extend(result.get("new_urls", []))

        if completed % 5 == 0 or completed == len(searches):
            log.info("Progress: %d/%d queries done (%d new, %d dupes, %d errors)",
                     completed, len(searches), total_new, total_existing, total_errors)

        # Structured per-query result, surfaced to the frontend so it can
        # render its own UI instead of parsing a formatted log string.
        log_entry = {
            "query": s["query"],
            "location": loc_label,
            "tier": s.get("tier", 0),
            "total": result["total"],
            "new": result["new"],
            "existing": result["existing"],
            "filtered": result["filtered"],
            "errors": result["errors"],
        }

        if on_progress:
            on_progress({
                "queries_done": completed,
                "queries_total": len(searches),
                "new": total_new,
                "existing": total_existing,
                "errors": total_errors,
                "by_site": dict(total_by_site),
                "current_query": None,
                "current_location": None,
                "log_entry": log_entry,
            })

    # Final stats
    conn = get_connection()
    db_total = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]

    log.info("Full crawl complete: %d new | %d dupes | %d errors | %d total in DB",
             total_new, total_existing, total_errors, db_total)

    return {
        "new": total_new,
        "existing": total_existing,
        "errors": total_errors,
        "db_total": db_total,
        "queries": len(searches),
        "by_site": total_by_site,
        "new_urls": total_new_urls,
    }


# -- Public entry point ------------------------------------------------------

def run_discovery(
    cfg: dict | None = None,
    on_progress: Callable[[dict], None] | None = None,
    on_warning: Callable[[str], None] | None = None,
) -> dict:
    """Main entry point for JobSpy-based job discovery.

    Loads search queries and locations from the user's search config YAML,
    then runs a full crawl across all configured job boards.

    Args:
        cfg: Override the search configuration dict. If None, loads from
             the user's searches.yaml file.
        on_progress: Optional callback invoked after every query with a dict
             of running totals -- see `_full_crawl`.
        on_warning: Optional callback invoked for every query/site that
             permanently failed after retries -- see `_full_crawl`.

    Returns:
        Dict with stats: new, existing, errors, db_total, queries, by_site.
    """
    if cfg is None:
        cfg = config.load_search_config()

    if not cfg:
        log.warning("No search configuration found. Run `applypilot init` to create one.")
        return {"new": 0, "existing": 0, "errors": 0, "db_total": 0, "queries": 0, "by_site": {}}

    proxy = cfg.get("proxy")
    sites = cfg.get("boards")
    results_per_site = cfg.get("defaults", {}).get("results_per_site", 100)
    hours_old = cfg.get("defaults", {}).get("hours_old", 72)
    tiers = cfg.get("tiers")
    locations = cfg.get("location_labels")

    return _full_crawl(
        search_cfg=cfg,
        tiers=tiers,
        locations=locations,
        sites=sites,
        results_per_site=results_per_site,
        hours_old=hours_old,
        proxy=proxy,
        on_progress=on_progress,
        on_warning=on_warning,
    )
