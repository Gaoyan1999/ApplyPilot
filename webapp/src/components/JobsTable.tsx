import { Fragment, useMemo } from 'react'
import type { Job, UserAction } from '../api/types'
import {
  compareDateGroupKeysDesc,
  formatDateGroupLabel,
  getDateGroupKey,
  type DateGroupKey,
} from '../lib/dateBuckets'
import { formatTime } from '../lib/format'
import { useLocalStorageState } from '../hooks/useLocalStorageState'
import { JobTypeBadge } from './JobTypeBadge'
import { ScorePill } from './ScorePill'
import { SiteIcon } from './SiteIcon'
import { UserActionSelect } from './UserActionSelect'

export type SortKey = 'title' | 'company' | 'site' | 'location' | 'job_type' | 'fit_score' | 'stage' | 'discovered_at'
export type SortDir = 'asc' | 'desc'

interface Props {
  jobs: Job[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  onPreview: (job: Job) => void
  onUserActionChange: (job: Job, value: UserAction | null) => void
  hiddenColumns: SortKey[]
}

type ColumnKey = SortKey | 'action'

export const COLUMNS: { key: SortKey; label: string; defaultWidth: number }[] = [
  { key: 'title', label: 'Title', defaultWidth: 280 },
  { key: 'company', label: 'Company', defaultWidth: 160 },
  { key: 'site', label: 'Link', defaultWidth: 60 },
  { key: 'location', label: 'Location', defaultWidth: 160 },
  { key: 'job_type', label: 'Job Type', defaultWidth: 120 },
  { key: 'fit_score', label: 'Score', defaultWidth: 90 },
  { key: 'discovered_at', label: 'Discovered', defaultWidth: 90 },
]

const ACTION_COLUMN_KEY: ColumnKey = 'action'
const DEFAULT_ACTION_WIDTH = 140
const MIN_COLUMN_WIDTH = 48

const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  ...Object.fromEntries(COLUMNS.map((col) => [col.key, col.defaultWidth])),
  [ACTION_COLUMN_KEY]: DEFAULT_ACTION_WIDTH,
} as Record<ColumnKey, number>

export function JobsTable({ jobs, sortKey, sortDir, onSort, onPreview, onUserActionChange, hiddenColumns }: Props) {
  const [collapsedBuckets, setCollapsedBuckets] = useLocalStorageState<DateGroupKey[]>(
    'applypilot-collapsed-date-buckets',
    [],
  )

  const visibleColumns = useMemo(
    () => COLUMNS.filter((col) => !hiddenColumns.includes(col.key)),
    [hiddenColumns],
  )
  const isVisible = (key: SortKey) => !hiddenColumns.includes(key)

  const [columnWidths, setColumnWidths] = useLocalStorageState<Record<ColumnKey, number>>(
    'applypilot-jobs-table-column-widths',
    DEFAULT_COLUMN_WIDTHS,
  )

  function startResize(key: ColumnKey, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = columnWidths[key] ?? DEFAULT_COLUMN_WIDTHS[key]
    document.body.classList.add('col-resizing')

    function onMouseMove(ev: MouseEvent) {
      const width = Math.max(MIN_COLUMN_WIDTH, startWidth + (ev.clientX - startX))
      setColumnWidths((prev) => ({ ...prev, [key]: width }))
    }

    function onMouseUp() {
      document.body.classList.remove('col-resizing')
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const jobsByBucket = useMemo(() => {
    const map = new Map<DateGroupKey, Job[]>()
    for (const job of jobs) {
      const key = getDateGroupKey(job.discovered_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(job)
    }
    return map
  }, [jobs])

  const bucketOrder = useMemo(
    () => Array.from(jobsByBucket.keys()).sort(compareDateGroupKeysDesc),
    [jobsByBucket],
  )

  function toggleBucket(bucket: DateGroupKey) {
    setCollapsedBuckets((prev) =>
      prev.includes(bucket) ? prev.filter((b) => b !== bucket) : [...prev, bucket],
    )
  }

  if (jobs.length === 0) {
    return <div className="empty-state">No jobs match the current filters.</div>
  }

  return (
    <div className="jobs-table-wrap">
      <table className="jobs-table" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          {visibleColumns.map((col) => (
            <col key={col.key} style={{ width: columnWidths[col.key] ?? col.defaultWidth }} />
          ))}
          <col style={{ width: columnWidths[ACTION_COLUMN_KEY] ?? DEFAULT_ACTION_WIDTH }} />
        </colgroup>
        <thead>
          <tr>
            {visibleColumns.map((col) => (
              <th key={col.key} onClick={() => onSort(col.key)}>
                {col.label}
                {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                <div
                  className="column-resize-handle"
                  onMouseDown={(e) => startResize(col.key, e)}
                  onClick={(e) => e.stopPropagation()}
                />
              </th>
            ))}
            <th>
              Action
              <div
                className="column-resize-handle"
                onMouseDown={(e) => startResize(ACTION_COLUMN_KEY, e)}
                onClick={(e) => e.stopPropagation()}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {bucketOrder.map((bucket) => {
            const bucketJobs = jobsByBucket.get(bucket) ?? []
            if (bucketJobs.length === 0) return null
            const collapsed = collapsedBuckets.includes(bucket)
            return (
              <Fragment key={bucket}>
                <tr className="jobs-table-group-row" onClick={() => toggleBucket(bucket)}>
                  <td colSpan={visibleColumns.length + 1} className="jobs-table-group-header">
                    <span className={`group-chevron${collapsed ? ' group-chevron-collapsed' : ''}`}>▾</span>
                    {formatDateGroupLabel(bucket)}
                    <span className="group-count">{bucketJobs.length}</span>
                  </td>
                </tr>
                {!collapsed &&
                  bucketJobs.map((job) => (
                    <tr key={job.url}>
                      {isVisible('title') && (
                        <td className="title-cell">
                          <button type="button" className="title-button" onClick={() => onPreview(job)}>
                            {job.title || '(untitled)'}
                          </button>
                        </td>
                      )}
                      {isVisible('company') && <td>{job.company || '—'}</td>}
                      {isVisible('site') && (
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
                      )}
                      {isVisible('location') && <td>{job.location || '—'}</td>}
                      {isVisible('job_type') && (
                        <td>
                          <JobTypeBadge jobType={job.job_type} />
                        </td>
                      )}
                      {isVisible('fit_score') && (
                        <td>
                          <ScorePill score={job.fit_score} />
                        </td>
                      )}
                      {isVisible('discovered_at') && <td>{formatTime(job.discovered_at)}</td>}
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
