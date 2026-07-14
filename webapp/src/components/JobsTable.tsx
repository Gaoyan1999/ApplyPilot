import type { Job } from '../api/types'
import { ScorePill } from './ScorePill'
import { StageBadge } from './StageBadge'

export type SortKey = 'title' | 'site' | 'location' | 'fit_score' | 'stage' | 'discovered_at'
export type SortDir = 'asc' | 'desc'

interface Props {
  jobs: Job[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'site', label: 'Site' },
  { key: 'location', label: 'Location' },
  { key: 'fit_score', label: 'Score' },
  { key: 'stage', label: 'Stage' },
  { key: 'discovered_at', label: 'Discovered' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function JobsTable({ jobs, sortKey, sortDir, onSort }: Props) {
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
                <a href={job.url} target="_blank" rel="noreferrer">
                  {job.title || '(untitled)'}
                </a>
              </td>
              <td>{job.site || '—'}</td>
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
