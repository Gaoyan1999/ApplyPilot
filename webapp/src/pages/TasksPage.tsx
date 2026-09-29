import { useEffect, useMemo, useRef, useState } from 'react'
import { cancelAutoSubmit, cancelStatusCheck, deleteTask, dismissAutoSubmit, getAllTasks } from '../api/client'
import type { DiscoverLogEntry, StatusCheckLogEntry, TaskRecord, TaskRecordStatus, TaskType } from '../api/types'
import { formatDate, formatDuration } from '../lib/format'
import { ProgressBar } from '../components/ProgressBar'

const POLL_INTERVAL_MS = 2000

export type TaskStatus = TaskRecordStatus

export interface Task {
  id: string
  type: TaskType
  label: string
  status: TaskStatus
  startedAt: string
  finishedAt: string | null
  progress?: { current: number; total?: number; stageLabel?: string }
  error?: string | null
  log: string[]
  // auto_apply only -- needed to call cancel by job URL.
  jobUrl?: string
  // auto_apply only -- base64 JPEG (no data: prefix) of the worker Chrome's
  // last-captured frame, for the live preview in the expanded row.
  screenshot?: string | null
}

const TASK_TYPE_LABEL: Record<TaskType, string> = {
  search: 'Search Run',
  auto_apply: 'Auto-Apply',
  status_check: 'Status Check',
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  running: 'Running',
  success: 'Success',
  error: 'Failed',
  terminated: 'Terminated',
  blocked: 'Needs Input',
}

// A running task can be stopped (-> terminated); anything else (terminated,
// succeeded, blocked, or failed) is finished and can only be deleted.
const STOPPABLE: TaskStatus[] = ['running']

/** Polls `fetcher` immediately, then every `intervalMs` -- keeps the last
 * good value on a transient network error rather than clearing the row. */
function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number): T | null {
  const [data, setData] = useState<T | null>(null)

  useEffect(() => {
    let cancelled = false

    async function tick() {
      try {
        const result = await fetcher()
        if (!cancelled) setData(result)
      } catch {
        // transient network hiccup -- keep the last good value, next tick retries
      }
    }

    tick()
    const id = setInterval(tick, intervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [fetcher, intervalMs])

  return data
}

function taskLabel(t: TaskRecord): string {
  if (t.type === 'search') return 'Search run — discover → enrich → score'
  if (t.type === 'status_check') return 'Status check — rechecking pending postings'
  const jobTitle = t.payload.job_title as string | null | undefined
  const jobCompany = t.payload.job_company as string | null | undefined
  return `Auto-apply — ${jobTitle || t.job_url || 'job'}${jobCompany ? ` @ ${jobCompany}` : ''}`
}

function taskProgress(t: TaskRecord): Task['progress'] {
  const p = t.payload
  if (t.type === 'search') {
    const stage = p.stage as string | null | undefined
    if (stage === 'discover') return { current: (p.queries as number) ?? 0, total: (p.queries_total as number) || undefined, stageLabel: 'discover' }
    if (stage === 'enrich') return { current: (p.enriched as number) ?? 0, total: (p.enrich_total as number) || undefined, stageLabel: 'enrich' }
    if (stage === 'score') return { current: (p.scored as number) ?? 0, total: (p.score_total as number) || undefined, stageLabel: 'score' }
    return undefined
  }
  if (t.type === 'status_check') {
    const total = (p.total as number) ?? 0
    return total > 0 ? { current: (p.checked as number) ?? 0, total } : undefined
  }
  // auto_apply -- only meaningful while running (live payload merged in by
  // GET /api/tasks); a finished row's payload has no `actions` field.
  if (t.status !== 'running') return undefined
  return { current: (p.actions as number) ?? 0, stageLabel: (p.last_action as string | undefined) ?? undefined }
}

function taskLog(t: TaskRecord): string[] {
  const p = t.payload
  if (t.type === 'search') {
    const log: string[] = []
    const queriesTotal = (p.queries_total as number) ?? 0
    if (queriesTotal > 0) {
      log.push(
        `Discover: ${p.new ?? 0} new, ${p.existing ?? 0} existing across ${p.queries ?? 0}/${queriesTotal} queries (${p.discover_errors ?? 0} errors)`,
      )
    }
    for (const entry of (p.discover_log as DiscoverLogEntry[] | undefined) ?? []) {
      log.push(
        `${entry.query} @ ${entry.location}: ${entry.new} new, ${entry.existing} existing, ${entry.filtered} filtered` +
          (entry.errors ? `, ${entry.errors} errors` : ''),
      )
    }
    const enrichTotal = (p.enrich_total as number) ?? 0
    if (enrichTotal > 0) log.push(`Enrich: ${p.enriched ?? 0}/${enrichTotal} done`)
    const scoreTotal = (p.score_total as number) ?? 0
    if (scoreTotal > 0) log.push(`Score: ${p.scored ?? 0}/${scoreTotal} done`)
    for (const w of (p.warnings as string[] | undefined) ?? []) log.push(`Warning: ${w}`)
    return log
  }
  if (t.type === 'status_check') {
    return [
      ...((p.log as StatusCheckLogEntry[] | undefined) ?? []).map(
        (e) => `${e.result.toUpperCase()}: ${e.title ?? e.url}${e.company ? ` — ${e.company}` : ''}`,
      ),
      ...((p.warnings as string[] | undefined) ?? []).map((w) => `Warning: ${w}`),
    ]
  }
  // auto_apply
  const transcript = (p.transcript as string[] | undefined) ?? []
  const lastAction = p.last_action as string | undefined
  return [...transcript, ...(lastAction ? [`Last: ${lastAction}`] : [])]
}

function mapTask(t: TaskRecord): Task {
  return {
    id: t.id,
    type: t.type,
    label: taskLabel(t),
    status: t.status,
    startedAt: t.started_at,
    finishedAt: t.finished_at,
    progress: taskProgress(t),
    error: t.error,
    log: taskLog(t),
    jobUrl: t.job_url ?? undefined,
    screenshot: t.type === 'auto_apply' ? (t.payload.screenshot as string | null | undefined) : undefined,
  }
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className="task-status-badge" data-status={status}>
      {status === 'running' && <span className="task-status-dot" aria-hidden="true" />}
      {STATUS_LABEL[status]}
    </span>
  )
}

function TaskTypeBadge({ type }: { type: TaskType }) {
  return (
    <span className="task-type-badge" data-type={type}>
      {TASK_TYPE_LABEL[type]}
    </span>
  )
}

interface TaskRowProps {
  task: Task
  onStop: (task: Task) => void
  onDelete: (task: Task) => void
}

function TaskRow({ task, onStop, onDelete }: TaskRowProps) {
  const [expanded, setExpanded] = useState(false)
  const stoppable = STOPPABLE.includes(task.status)
  // The backend has no cancel hook for a search run (only status-check and
  // auto-apply do) -- disable rather than pretend it works.
  const stopUnsupported = task.type === 'search'
  const logRef = useRef<HTMLUListElement>(null)

  // Keep the log pinned to its latest line as new entries stream in --
  // without this, a running task's log stays scrolled wherever the user
  // last left it while new lines keep appending below the fold.
  useEffect(() => {
    if (expanded && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [task.log, expanded])

  function toggle() {
    setExpanded((v) => !v)
  }

  return (
    <li className="task-row">
      <div className="task-row-main">
        <div
          className="task-row-summary"
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggle()
            }
          }}
        >
          <span className="task-row-chevron" data-open={expanded} aria-hidden="true">
            ▸
          </span>
          <TaskTypeBadge type={task.type} />
          <span className="task-row-label" title={task.label}>
            {task.label}
          </span>
          {task.progress && (
            <span className="task-row-progress">
              {task.progress.total !== undefined ? (
                <ProgressBar done={task.progress.current} total={task.progress.total} />
              ) : (
                <span className="task-row-progress-stage">{task.progress.stageLabel}</span>
              )}
            </span>
          )}
          <span className="task-row-duration">{formatDuration(task.startedAt, task.finishedAt)}</span>
          <TaskStatusBadge status={task.status} />
        </div>

        <div className="task-row-actions">
          {stoppable ? (
            <button
              type="button"
              className="auto-submit-cancel task-action-button"
              disabled={stopUnsupported}
              title={stopUnsupported ? "Cancelling a search run isn't supported by the backend yet" : undefined}
              onClick={() => onStop(task)}
            >
              Stop
            </button>
          ) : (
            <button type="button" className="task-delete-button" onClick={() => onDelete(task)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="task-row-detail">
          <dl className="task-row-meta">
            <div>
              <dt>Started</dt>
              <dd>{formatDate(task.startedAt)}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{task.finishedAt ? formatDate(task.finishedAt) : '—'}</dd>
            </div>
            {task.jobUrl && (
              <div>
                <dt>Job</dt>
                <dd>
                  <a href={task.jobUrl} target="_blank" rel="noreferrer">
                    {task.jobUrl}
                  </a>
                </dd>
              </div>
            )}
          </dl>

          {task.type === 'auto_apply' && task.screenshot && (
            <div className="task-preview">
              <img
                className="task-preview-image"
                src={`data:image/jpeg;base64,${task.screenshot}`}
                alt="Live preview of the auto-apply browser"
              />
            </div>
          )}

          {task.error && <p className="search-result search-error">{task.error}</p>}

          {task.log.length > 0 && (
            <ul className="search-discover-log task-log" ref={logRef}>
              {task.log.map((line, i) => (
                <li className="search-discover-log-row" key={i}>
                  <span className="search-discover-log-query">{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

export function TasksPage() {
  const records = usePolling(getAllTasks, POLL_INTERVAL_MS)
  const tasks = useMemo(() => (records ?? []).map(mapTask), [records])

  function handleStop(task: Task) {
    if (task.type === 'auto_apply') {
      if (task.jobUrl) cancelAutoSubmit(task.jobUrl).catch(() => {})
      return
    }
    if (task.type === 'status_check') {
      cancelStatusCheck().catch(() => {
        // best-effort -- the next poll reflects whatever actually happened
      })
    }
    // Search has no backend cancel yet -- its Stop button is disabled.
  }

  function handleDelete(task: Task) {
    // A finished auto-apply sitting in ready_for_review/blocked still has
    // its Chrome window deliberately left open (apply_state.py) -- dismiss
    // closes that and frees the slot. Harmless no-op if it wasn't pending
    // review. Both calls are best-effort: the row disappears from the next
    // poll once the backend confirms the delete.
    if (task.type === 'auto_apply' && task.jobUrl) {
      dismissAutoSubmit(task.jobUrl).catch(() => {})
    }
    deleteTask(task.id).catch(() => {})
  }

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [tasks],
  )

  const runningCount = tasks.filter((t) => t.status === 'running').length
  const errorCount = tasks.filter((t) => t.status === 'error').length
  const successCount = tasks.filter((t) => t.status === 'success').length

  return (
    <div className="app-container">
      <div className="app-header">
        <h1>Background Tasks</h1>
        <div className="app-header-actions">
          <a className="pagination-button" href="#/">
            ← Dashboard
          </a>
        </div>
      </div>
      <p className="subtitle">
        Search runs, status checks, and auto-applies running in the background — reflects live backend state.
      </p>

      <div className="stat-pills">
        <div className="stat-pill">
          <div className="value">{runningCount}</div>
          <div className="label">Running</div>
        </div>
        <div className="stat-pill">
          <div className="value">{successCount}</div>
          <div className="label">Succeeded</div>
        </div>
        <div className="stat-pill">
          <div className="value">{errorCount}</div>
          <div className="label">Failed</div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="subtitle">No tasks yet — start a search, status check, or auto-apply from the dashboard.</p>
      ) : (
        <ul className="task-list">
          {sorted.map((task) => (
            <TaskRow key={task.id} task={task} onStop={handleStop} onDelete={handleDelete} />
          ))}
        </ul>
      )}
    </div>
  )
}
