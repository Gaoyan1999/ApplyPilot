export type Stage =
  | 'Discovered'
  | 'Enriched'
  | 'Scored'
  | 'Tailored'
  | 'Cover Letter Ready'
  | 'Applying'
  | 'Applied'
  | 'Failed'

export type JobType = 'full_time' | 'intern' | 'contract' | 'unknown'

export type UserAction =
  | 'need_tailor'
  | 'need_auto_apply'
  | 'applied'
  | 'interviewing'
  | 'offer'
  | 'rejected'
  | 'closed'

export interface Job {
  url: string
  title: string | null
  company: string | null
  site: string | null
  job_type: JobType | null
  location: string | null
  salary: string | null
  fit_score: number | null
  score_reasoning: string | null
  application_url: string | null
  // Omitted from GET /api/jobs/search list items (keeps page payloads small);
  // only present on a single-job detail fetch (GET /api/jobs/{url}).
  full_description?: string | null
  discovered_at: string | null
  scored_at: string | null
  tailored_at: string | null
  tailor_attempts: number
  cover_letter_path: string | null
  cover_letter_at: string | null
  cover_attempts: number
  applied_at: string | null
  apply_status: string | null
  apply_error: string | null
  apply_attempts: number
  detail_error: string | null
  stage: Stage
  user_action: UserAction | null
  dismissed: boolean
}

export interface SearchJobsParams {
  page: number
  page_size: number
  q: string
  job_type: JobType[]
  // 'is' | 'is not' -- the app-wide FilterMode from components/MultiSelectFilter.
  // Not imported here to avoid the api layer depending on components; the
  // client.ts request builder translates it to the API's `is`/`is_not`.
  job_type_mode: 'is' | 'is not'
  user_action: UserAction[]
  user_action_mode: 'is' | 'is not'
  include_dismissed: boolean
  // 'YYYY-MM-DD', inclusive on both ends. Either/both may be null (open-ended).
  discovered_after: string | null
  discovered_before: string | null
  // Excludes 'stage' -- JobsTable.SortKey's dead, unused sort option (no
  // column wires it up) that the server doesn't support sorting by.
  sort_by: 'title' | 'company' | 'site' | 'location' | 'job_type' | 'fit_score' | 'discovered_at'
  sort_dir: 'asc' | 'desc'
}

export interface SearchJobsResponse {
  items: Job[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface ScoreDistItem {
  score: number
  count: number
}

export interface SiteStat {
  site: string
  count: number
}

export interface JobTypeStat {
  job_type: JobType | null
  count: number
}

export interface UserActionStat {
  user_action: UserAction
  count: number
}

export interface SearchQuery {
  query: string
  tier: number
}

export interface SearchLocationEntry {
  location: string
  remote: boolean
}

export interface SearchConfigDefaults {
  results_per_site: number
  hours_old: number
}

export interface SearchConfig {
  queries: SearchQuery[]
  locations: SearchLocationEntry[]
  exclude_titles: string[]
  boards: string[]
  defaults: SearchConfigDefaults
}

export interface PromptEntry {
  text: string
  default: string
  is_custom: boolean
}

export interface PromptsConfig {
  cover_letter: PromptEntry
  tailoring: PromptEntry
  scoring: PromptEntry
}

export type SearchRunStage = 'discover' | 'enrich' | 'score' | 'done' | null

export interface DiscoverLogEntry {
  query: string
  location: string
  tier: number
  total: number
  new: number
  existing: number
  filtered: number
  errors: number
}

export interface SearchStatus {
  running: boolean
  stage: SearchRunStage
  started_at: string | null
  finished_at: string | null
  queries: number
  queries_total: number
  new: number
  existing: number
  discover_errors: number
  discover_by_site: Record<string, number>
  current_query: string | null
  current_location: string | null
  discover_log: DiscoverLogEntry[]
  enriched: number
  enrich_total: number
  scored: number
  score_total: number
  warnings: string[]
  error: string | null
  error_stage: SearchRunStage
}

export interface AutoSubmitStatus {
  running: boolean
  url: string | null
  started_at: string | null
  finished_at: string | null
  // Launcher-level failure -- couldn't start at all (tier check, job
  // already locked/applied/manual-only, an unhandled exception). Distinct
  // from a normal failed *application* outcome, which is reported via the
  // job's own apply_status/apply_error once running flips back to false.
  error: string | null
  status: string | null
  last_action: string | null
  actions: number
  // The agent's own narrated reasoning + tool-use action descriptions, in
  // order -- mirrors the CLI's --verbose terminal output.
  transcript: string[]
}

export interface Cv {
  name: string
  filename: string
  uploaded_at: string
  size: number
}

export interface Status {
  total: number
  with_description: number
  pending_detail: number
  detail_errors: number
  scored: number
  unscored: number
  high_fit: number
  tailored: number
  untailored_eligible: number
  tailor_exhausted: number
  with_cover_letter: number
  cover_exhausted: number
  applied: number
  apply_errors: number
  ready_to_apply: number
  score_distribution: ScoreDistItem[]
  by_site: SiteStat[]
  by_job_type: JobTypeStat[]
  by_user_action: UserActionStat[]
  stage_counts: Record<Stage, number>
}
