import { Fragment, useMemo } from 'react'
import type { Job, UserAction } from '../api/types'
import { BUCKET_LABELS, BUCKET_ORDER, getDateBucket, type DateBucket } from '../lib/dateBuckets'
import { formatDate } from '../lib/format'
import { useLocalStorageState } from '../hooks/useLocalStorageState'
import { JobTypeBadge } from './JobTypeBadge'
import { ScorePill } from './ScorePill'
import { StageBadge } from './StageBadge'
import { SiteIcon } from './SiteIcon'
import { UserActionSelect } from './UserActionSelect'

export type SortKey = 'title' | 'company' | 'site' | 'job_type' | 'fit_score' | 'stage' | 'discovered_at'
export type SortDir = 'asc' | 'desc'

interface Props {
  jobs: Job[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  onPreview: (job: Job) => void
  onUserActionChange: (job: Job, value: UserAction | null) => void
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'company', label: 'Company' },
  { key: 'site', label: 'Link' },
  { key: 'job_type', label: 'Job Type' },
  { key: 'fit_score', label: 'Score' },
  { key: 'stage', label: 'Stage' },
  { key: 'discovered_at', label: 'Discovered' },
]

export function JobsTable({ jobs, sortKey, sortDir, onSort, onPreview, onUserActionChange }: Props) {
  const [collapsedBuckets, setCollapsedBuckets] = useLocalStorageState<DateBucket[]>(
    'applypilot-collapsed-date-buckets',
    [],
  )

  const jobsByBucket = useMemo(() => {
    const map = new Map<DateBucket, Job[]>()
    for (const bucket of BUCKET_ORDER) map.set(bucket, [])
    for (const job of jobs) {
      map.get(getDateBucket(job.discovered_at))!.push(job)
    }
    return map
  }, [jobs])

  function toggleBucket(bucket: DateBucket) {
    setCollapsedBuckets((prev) =>
      prev.includes(bucket) ? prev.filter((b) => b !== bucket) : [...prev, bucket],
    )
  }

  if (jobs.length === 0) {
    return <div className="empty-state">No jobs match the current filters.</div>
  }

  return (
    <div className="jobs-table-wrap">
      <table className="jobs-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} onClick={() => onSort(col.key)}>
                {col.label}
                {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {BUCKET_ORDER.map((bucket) => {
            const bucketJobs = jobsByBucket.get(bucket) ?? []
            if (bucketJobs.length === 0) return null
            const collapsed = collapsedBuckets.includes(bucket)
            return (
              <Fragment key={bucket}>
                <tr className="jobs-table-group-row" onClick={() => toggleBucket(bucket)}>
                  <td colSpan={COLUMNS.length + 1} className="jobs-table-group-header">
                    <span className={`group-chevron${collapsed ? ' group-chevron-collapsed' : ''}`}>▾</span>
                    {BUCKET_LABELS[bucket]}
                    <span className="group-count">{bucketJobs.length}</span>
                  </td>
                </tr>
                {!collapsed &&
                  bucketJobs.map((job) => (
                    <tr key={job.url}>
                      <td className="title-cell">
                        <button type="button" className="title-button" onClick={() => onPreview(job)}>
                          {job.title || '(untitled)'}
                        </button>
                      </td>
                      <td>{job.company || '—'}</td>
                      <td className="site-cell">
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${job.title || 'job'} listing`}
                        >
                          <SiteIcon site={job.site} />
                        </a>
                      </td>
                      <td>
                        <JobTypeBadge jobType={job.job_type} />
                      </td>
                      <td>
                        <ScorePill score={job.fit_score} />
                      </td>
                      <td>
                        <StageBadge stage={job.stage} />
                      </td>
                      <td>{formatDate(job.discovered_at)}</td>
                      <td>
                        <UserActionSelect
                          value={job.user_action}
                          onChange={(value) => onUserActionChange(job, value)}
                        />
                      </td>
                    </tr>
                  ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
