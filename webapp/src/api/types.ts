export type Stage =
  | 'Discovered'
  | 'Enriched'
  | 'Scored'
  | 'Tailored'
  | 'Cover Letter Ready'
  | 'Applying'
  | 'Applied'
  | 'Failed'

export interface Job {
  url: string
  title: string | null
  site: string | null
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
}

export interface ScoreDistItem {
  score: number
  count: number
}

export interface SiteStat {
  site: string
  count: number
}

export interface SearchForm {
  query: string
  location: string
  remote: boolean
  sites: string[]
  hours_old: number
}

export type SearchRunStage = 'discover' | 'enrich' | 'score' | 'done' | null

export interface SearchStatus {
  running: boolean
  stage: SearchRunStage
  started_at: string | null
  finished_at: string | null
  found: number
  total: number
  enriched: number
  scored: number
  error: string | null
  error_stage: SearchRunStage
  query: string | null
  location: string | null
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
  stage_counts: Record<Stage, number>
}
