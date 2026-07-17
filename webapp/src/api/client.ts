import type { Job, PromptsConfig, SearchConfig, SearchStatus, Status, UserAction } from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    throw new ApiError(res.status, `${path} responded ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function sendJson<T>(path: string, method: 'POST' | 'PUT' | 'PATCH', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new ApiError(res.status, detail?.detail || `${path} responded ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function getStatus(): Promise<Status> {
  return getJson<Status>('/api/status')
}

export function getJobs(): Promise<Job[]> {
  return getJson<Job[]>('/api/jobs')
}

export function getSearchConfig(): Promise<SearchConfig> {
  return getJson<SearchConfig>('/api/search/config')
}

export function saveSearchConfig(config: SearchConfig): Promise<SearchConfig> {
  return sendJson<SearchConfig>('/api/search/config', 'PUT', config)
}

export function getPrompts(): Promise<PromptsConfig> {
  return getJson<PromptsConfig>('/api/prompts')
}

export function savePrompts(body: { cover_letter: string; tailoring: string; scoring: string }): Promise<PromptsConfig> {
  return sendJson<PromptsConfig>('/api/prompts', 'PUT', body)
}

export function runSearch(): Promise<SearchStatus> {
  return sendJson<SearchStatus>('/api/search/run', 'POST')
}

export function getSearchStatus(): Promise<SearchStatus> {
  return getJson<SearchStatus>('/api/search/status')
}

export function getSearchNewJobs(): Promise<Job[]> {
  return getJson<Job[]>('/api/search/new-jobs')
}

export function discardNewSearchResults(): Promise<{ deleted: number }> {
  return sendJson<{ deleted: number }>('/api/search/discard-new', 'POST')
}

export function confirmSearchResults(): Promise<{ ok: boolean }> {
  return sendJson<{ ok: boolean }>('/api/search/confirm', 'POST')
}

export function setJobUserAction(url: string, userAction: UserAction | null): Promise<Job> {
  return sendJson<Job>(`/api/jobs/${encodeURIComponent(url)}`, 'PATCH', { user_action: userAction })
}

export interface CoverLetterText {
  text: string | null
}

export function getCoverLetter(url: string): Promise<CoverLetterText> {
  return getJson<CoverLetterText>(`/api/jobs/${encodeURIComponent(url)}/cover-letter`)
}

export function generateCoverLetter(url: string): Promise<CoverLetterText> {
  return sendJson<CoverLetterText>(`/api/jobs/${encodeURIComponent(url)}/cover-letter`, 'POST')
}
