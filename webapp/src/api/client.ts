import type { Job, Status } from './types'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    throw new Error(`${path} responded ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function getStatus(): Promise<Status> {
  return getJson<Status>('/api/status')
}

export function getJobs(): Promise<Job[]> {
  return getJson<Job[]>('/api/jobs')
}
