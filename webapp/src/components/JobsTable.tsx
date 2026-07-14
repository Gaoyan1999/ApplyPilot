import type { Job } from '../api/types'
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

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'site', label: 'Link' },
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
                <div className="title-cell-row">
                  <a href={job.url} target="_blank" rel="noreferrer">
                    {job.title || '(untitled)'}
                  </a>
                  <button
                    type="button"
                    className="preview-button"
                    onClick={() => onPreview(job)}
                    title="Preview job description"
                    aria-label="Preview job description"
                  >
                    <EyeIcon />
                  </button>
                </div>
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
