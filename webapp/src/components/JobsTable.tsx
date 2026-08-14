import { useEffect, useRef, useState } from 'react'
import type { Job, UserAction } from '../api/types'
import { formatDate } from '../lib/format'
import { useLocalStorageState } from '../hooks/useLocalStorageState'
import { JobTypeBadge } from './JobTypeBadge'
import { ScorePill } from './ScorePill'
import { SiteIcon } from './SiteIcon'
import { StarIcon } from './StarIcon'
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
  onDismissChange: (job: Job, dismissed: boolean) => void
  onStarredChange: (job: Job, starred: boolean) => void
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
  { key: 'discovered_at', label: 'Discovered', defaultWidth: 160 },
]

const ACTION_COLUMN_KEY: ColumnKey = 'action'
const DEFAULT_ACTION_WIDTH = 140
const STAR_COLUMN_WIDTH = 36
const MIN_COLUMN_WIDTH = 48

const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  ...Object.fromEntries(COLUMNS.map((col) => [col.key, col.defaultWidth])),
  [ACTION_COLUMN_KEY]: DEFAULT_ACTION_WIDTH,
} as Record<ColumnKey, number>

export function JobsTable({
  jobs,
  sortKey,
  sortDir,
  onSort,
  onPreview,
  onUserActionChange,
  onDismissChange,
  onStarredChange,
  hiddenColumns,
}: Props) {
  const visibleColumns = COLUMNS.filter((col) => !hiddenColumns.includes(col.key))
  const isVisible = (key: SortKey) => !hiddenColumns.includes(key)

  const [columnWidths, setColumnWidths] = useLocalStorageState<Record<ColumnKey, number>>(
    'applypilot-jobs-table-column-widths',
    DEFAULT_COLUMN_WIDTHS,
  )

  // Tracked by job url (not index) so the highlight follows the same job
  // across a refresh/re-sort instead of jumping to whatever now sits at the
  // old row position.
  const [focusedUrl, setFocusedUrl] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  const focusedIndex = jobs.findIndex((j) => j.url === focusedUrl)
  // Roving tabindex: exactly one row is in the page's tab order at a time.
  // Before anything has been focused, that's the first row, so Tab from
  // above the table lands on row 1 rather than skipping the table entirely.
  const rovingIndex = focusedIndex === -1 ? 0 : focusedIndex

  function focusRowAt(index: number) {
    const target = jobs[index]
    if (!target) return
    rowRefs.current[target.url]?.focus()
  }

  // Tab reaches the first row on its own via the roving tabindex above, but
  // ArrowDown has no row to fire on until one is already focused. Catch it
  // at the window level so the very first press jumps into the list --
  // scoped to when nothing else on the page has focus, so it never steals
  // the key from a text input, dropdown, or modal.
  useEffect(() => {
    function onWindowKeyDown(e: KeyboardEvent) {
      if (focusedUrl !== null) return
      if (document.activeElement !== document.body) return
      if (e.key !== 'ArrowDown') return
      if (jobs.length === 0) return
      e.preventDefault()
      rowRefs.current[jobs[0].url]?.focus()
    }
    window.addEventListener('keydown', onWindowKeyDown)
    return () => window.removeEventListener('keydown', onWindowKeyDown)
  }, [focusedUrl, jobs])

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, index: number, job: Job) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusRowAt(index + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusRowAt(index - 1)
        break
      case 'Tab':
        // At the first/last row, fall through to the browser's default tab
        // handling so focus leaves the table for the next/previous control
        // on the page instead of getting trapped.
        if (e.shiftKey) {
          if (index > 0) {
            e.preventDefault()
            focusRowAt(index - 1)
          }
        } else if (index < jobs.length - 1) {
          e.preventDefault()
          focusRowAt(index + 1)
        }
        break
      case 'Enter':
        e.preventDefault()
        onPreview(job)
        break
    }
  }

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

  if (jobs.length === 0) {
    return <div className="empty-state">No jobs match the current filters.</div>
  }

  return (
    <div className="jobs-table-wrap">
      <table className="jobs-table" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: STAR_COLUMN_WIDTH }} />
          {visibleColumns.map((col) => (
            <col key={col.key} style={{ width: columnWidths[col.key] ?? col.defaultWidth }} />
          ))}
          <col style={{ width: columnWidths[ACTION_COLUMN_KEY] ?? DEFAULT_ACTION_WIDTH }} />
        </colgroup>
        <thead>
          <tr>
            <th className="star-header-cell" aria-label="Starred" />
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
          {jobs.map((job, index) => (
            <tr
              key={job.url}
              ref={(el) => {
                rowRefs.current[job.url] = el
              }}
              tabIndex={index === rovingIndex ? 0 : -1}
              className={[
                job.dismissed ? 'jobs-table-row-dismissed' : '',
                job.url === focusedUrl ? 'jobs-table-row-focused' : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined}
              onFocus={() => {
                setFocusedUrl(job.url)
                onPreview(job)
              }}
              onClick={(e) => {
                // Clicks on a row's own interactive controls (star toggle,
                // title, site link, action select) manage their own focus --
                // only steal focus onto the row for clicks on plain cells.
                if (!(e.target as HTMLElement).closest('button, a, [role]')) {
                  rowRefs.current[job.url]?.focus()
                }
              }}
              onKeyDown={(e) => handleRowKeyDown(e, index, job)}
            >
              <td className="star-cell">
                <button
                  type="button"
                  className={`star-toggle${job.starred ? ' star-toggle-active' : ''}`}
                  onClick={() => onStarredChange(job, !job.starred)}
                  aria-label={job.starred ? 'Unpin job' : 'Pin job'}
                  aria-pressed={job.starred}
                  title={job.starred ? 'Unpin job' : 'Pin job'}
                >
                  <StarIcon filled={job.starred} />
                </button>
              </td>
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
              {isVisible('discovered_at') && <td>{formatDate(job.discovered_at)}</td>}
              <td>
                <UserActionSelect
                  value={job.user_action}
                  onChange={(value) => onUserActionChange(job, value)}
                  dismissed={job.dismissed}
                  onDismissChange={(dismissed) => onDismissChange(job, dismissed)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
