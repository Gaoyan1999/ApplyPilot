import type { JobType } from '../api/types'

export const LABEL_BY_JOB_TYPE: Record<JobType, string> = {
  full_time: 'Full-time',
  intern: 'Intern',
  contract: 'Contract',
  unknown: 'Unknown',
}

const CLASS_BY_JOB_TYPE: Record<JobType, string> = {
  full_time: 'job-type-full-time',
  intern: 'job-type-intern',
  contract: 'job-type-contract',
  unknown: 'job-type-unknown',
}

export function JobTypeBadge({ jobType }: { jobType: JobType | null }) {
  const value = jobType ?? 'unknown'
  return <span className={`job-type-badge ${CLASS_BY_JOB_TYPE[value]}`}>{LABEL_BY_JOB_TYPE[value]}</span>
}
