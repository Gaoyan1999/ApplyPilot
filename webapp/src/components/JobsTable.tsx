import type { Job } from '../api/types'
import { formatDate } from '../lib/format'
import { ScorePill } from './ScorePill'
import { StageBadge } from './StageBadge'
import { SiteIcon } from './SiteIcon'

export type SortKey = 'title' | 'site' | 'location' | 'fit_score' | 'stage' | 'discovered_at'
export type SortDir = 'asc' | 'desc'

interface Props {
  jobs: Job[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  onPreview: (job: Job) => void
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'site', label: 'Link' },
  { key: 'location', label: 'Location' },
  { key: 'fit_score', label: 'Score' },
  { key: 'stage', label: 'Stage' },
  { key: 'discovered_at', label: 'Discovered' },
]

export function JobsTable({ jobs, sortKey, sortDir, onSort, onPreview }: Props) {
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
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.url}>
              <td className="title-cell">
                <button type="button" className="title-button" onClick={() => onPreview(job)}>
                  {job.title || '(untitled)'}
                </button>
              </td>
              <td className="site-cell">
                <a href={job.url} target="_blank" rel="noreferrer" aria-label={`Open ${job.title || 'job'} listing`}>
                  <SiteIcon site={job.site} />
                </a>
              </td>
              <td>{job.location || '—'}</td>
              <td>
                <ScorePill score={job.fit_score} />
              </td>
              <td>
                <StageBadge stage={job.stage} />
              </td>
              <td>{formatDate(job.discovered_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
