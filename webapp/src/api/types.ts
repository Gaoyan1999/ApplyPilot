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

export type UserAction = 'not_for_me' | 'need_tailor' | 'need_auto_apply'

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
  full_description: string | null
  discovered_at: string | null
  scored_at: string | null
  tailored_at: string | null
  tailor_attempts: number
  cover_letter_at: string | null
  cover_attempts: number
  applied_at: string | null
  apply_status: string | null
  apply_error: string | null
  apply_attempts: number
  detail_error: string | null
  stage: Stage
  user_action: UserAction | null
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

export type SearchRunStage = 'discover' | 'enrich' | 'score' | 'done' | null

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
  enriched: number
  enrich_total: number
  scored: number
  score_total: number
  error: string | null
  error_stage: SearchRunStage
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
  stage_counts: Record<Stage, number>
}
