import type { Job, SearchForm, SearchStatus, Status } from './types'

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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

export function getSearchForm(): Promise<SearchForm> {
  return getJson<SearchForm>('/api/search/form')
}

export function runSearch(form: SearchForm): Promise<SearchStatus> {
  return postJson<SearchStatus>('/api/search/run', form)
}

export function getSearchStatus(): Promise<SearchStatus> {
  return getJson<SearchStatus>('/api/search/status')
}
