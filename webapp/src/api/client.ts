import type { Job, SearchConfig, SearchStatus, Status } from './types'

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

async function sendJson<T>(path: string, method: 'POST' | 'PUT', body?: unknown): Promise<T> {
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

export function runSearch(): Promise<SearchStatus> {
  return sendJson<SearchStatus>('/api/search/run', 'POST')
}

export function getSearchStatus(): Promise<SearchStatus> {
  return getJson<SearchStatus>('/api/search/status')
}
