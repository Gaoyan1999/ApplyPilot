"""Typed schema for ~/.applypilot/searches.yaml.

Single source of truth for every field the discovery/apply pipeline reads
from or writes to that file. `extra="forbid"` on every level means a stale,
typo'd, or otherwise-unread key fails loudly on load instead of silently
sitting in the file forever (e.g. the `sites`/top-level `hours_old`/
top-level `results_per_site` fields that used to shadow `boards` and
`defaults.hours_old`/`defaults.results_per_site` without anyone reading
them).
"""

from pydantic import BaseModel, ConfigDict


class SearchQueryParam(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str
    # Required rather than defaulted: the old dict-based code disagreed with
    # itself on what a missing tier should mean (0 in jobspy._full_crawl, 99
    # in workday.py's max-tier filter, 1 in the web API's request body) --
    # never actually triggered since every real config sets it explicitly,
    # but ambiguous. Making it required removes the ambiguity outright.
    tier: int


class SearchLocationParam(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location: str
    remote: bool = False


class SearchDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")

    results_per_site: int = 100
    hours_old: int = 72
    # Which national Indeed site JobSpy queries (e.g. "usa" -> indeed.com,
    # "australia" -> indeed.com.au). Falls back to the top-level `country`
    # field via SearchYamlConfig.resolved_country_indeed if unset here.
    country_indeed: str | None = None


class LocationFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accept_patterns: list[str] = []
    reject_patterns: list[str] = []
    # Fallback city name for the apply-time location eligibility check when
    # the user's profile has no city set. Optional -- apply/prompt.py falls
    # back further to "your city" if this is also unset.
    primary: str | None = None


class SearchYamlConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    queries: list[SearchQueryParam] = []
    locations: list[SearchLocationParam] = []
    defaults: SearchDefaults = SearchDefaults()
    # Job boards to scrape. Kept in sync with jobspy._full_crawl's own
    # fallback so an empty/missing key behaves identically either way.
    boards: list[str] = ["indeed", "linkedin", "zip_recruiter"]
    exclude_titles: list[str] = []
    location: LocationFilters = LocationFilters()
    glassdoor_location_map: dict[str, str] = {}
    country: str | None = None
    proxy: str | None = None
    # Optional discover-time filters -- restrict a run to specific query
    # tiers or location labels. Neither is set by the web UI or CLI today,
    # but jobspy._full_crawl honors them if present.
    tiers: list[int] | None = None
    location_labels: list[str] | None = None
    # Workday-specific crawl tuning, read only by discovery/workday.py.
    workday_max_tier: int = 2
    workday_location_filter: bool = True

    @property
    def resolved_country_indeed(self) -> str:
        """The country_indeed value discovery should actually use.

        `defaults.country_indeed` wins if set; otherwise falls back to the
        top-level `country` field (what the init wizard collects) so users
        don't have to duplicate their country into two places. Defaults to
        "usa" only if neither is set at all.
        """
        return self.defaults.country_indeed or self.country or "usa"
