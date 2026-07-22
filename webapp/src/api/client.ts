import type { AutoSubmitStatus, Cv, Job, PromptsConfig, SearchConfig, SearchJobsParams, SearchJobsResponse, SearchStatus, Status, UserAction } from './types'

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

async function sendJson<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
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

// No Content-Type header here -- the browser sets the multipart boundary
// itself when the body is FormData. sendJson can't be reused for this: it
// hardcodes JSON.stringify + an application/json header, which would break
// a file upload.
async function sendFormData<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', body })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new ApiError(res.status, detail?.detail || `${path} responded ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function getStatus(): Promise<Status> {
  return getJson<Status>('/api/status')
}

export function searchJobs(params: SearchJobsParams): Promise<SearchJobsResponse> {
  const qs = new URLSearchParams()
  qs.set('page', String(params.page))
  qs.set('page_size', String(params.page_size))
  if (params.q) qs.set('q', params.q)
  for (const jt of params.job_type) qs.append('job_type', jt)
  qs.set('job_type_mode', params.job_type_mode === 'is not' ? 'is_not' : 'is')
  for (const ua of params.user_action) qs.append('user_action', ua)
  qs.set('user_action_mode', params.user_action_mode === 'is not' ? 'is_not' : 'is')
  qs.set('include_dismissed', String(params.include_dismissed))
  if (params.discovered_after) qs.set('discovered_after', params.discovered_after)
  if (params.discovered_before) qs.set('discovered_before', params.discovered_before)
  qs.set('sort_by', params.sort_by)
  qs.set('sort_dir', params.sort_dir)
  return getJson<SearchJobsResponse>(`/api/jobs/search?${qs.toString()}`)
}

export function getJob(url: string): Promise<Job> {
  return getJson<Job>(`/api/jobs/${encodeURIComponent(url)}`)
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

export function setJobDismissed(url: string, dismissed: boolean): Promise<Job> {
  return sendJson<Job>(`/api/jobs/${encodeURIComponent(url)}`, 'PATCH', { dismissed })
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

export function getCoverLetterPdfUrl(url: string): string {
  return `/api/jobs/${encodeURIComponent(url)}/cover-letter/pdf`
}

export function triggerAutoSubmit(url: string): Promise<AutoSubmitStatus> {
  return sendJson<AutoSubmitStatus>(`/api/jobs/${encodeURIComponent(url)}/auto-submit`, 'POST')
}

export function getAutoSubmitStatus(url: string): Promise<AutoSubmitStatus> {
  return getJson<AutoSubmitStatus>(`/api/jobs/${encodeURIComponent(url)}/auto-submit/status`)
}

export function cancelAutoSubmit(url: string): Promise<{ cancelled: boolean }> {
  return sendJson<{ cancelled: boolean }>(`/api/jobs/${encodeURIComponent(url)}/auto-submit/cancel`, 'POST')
}

export function listCvs(): Promise<Cv[]> {
  return getJson<Cv[]>('/api/cvs')
}

export function uploadCv(file: File, name: string): Promise<Cv> {
  const formData = new FormData()
  formData.append('file', file)
  if (name) formData.append('name', name)
  return sendFormData<Cv>('/api/cvs', formData)
}

export function deleteCv(name: string): Promise<{ deleted: boolean }> {
  return sendJson<{ deleted: boolean }>(`/api/cvs/${encodeURIComponent(name)}`, 'DELETE')
}

export function getCvFileUrl(name: string): string {
  return `/api/cvs/${encodeURIComponent(name)}/file`
}
