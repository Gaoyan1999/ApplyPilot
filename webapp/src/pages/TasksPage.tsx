import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelAutoSubmit,
  cancelStatusCheck,
  dismissAutoSubmit,
  getAllAutoSubmitStatuses,
  getSearchStatus,
  getStatusCheckStatus,
} from '../api/client'
import type { AutoSubmitStatus, SearchStatus, StatusCheckStatus } from '../api/types'
import { formatDate, formatDuration } from '../lib/format'
import { ProgressBar } from '../components/ProgressBar'

const POLL_INTERVAL_MS = 2000

export type TaskType = 'search' | 'auto_apply' | 'status_check'
export type TaskStatus = 'running' | 'success' | 'error' | 'idle' | 'terminated' | 'blocked'

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
  // auto_apply only -- needed to call cancel/dismiss by job URL, and to key
  // the dismissed-tracking map (see autoApplyDismissed below).
  jobUrl?: string
  slotId?: number
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
  idle: 'Queued',
  terminated: 'Terminated',
  blocked: 'Needs Input',
}

// A running/queued task can be stopped (-> terminated); anything else
// (terminated, succeeded, blocked, or failed) is finished and can only be
// deleted.
const STOPPABLE: TaskStatus[] = ['running', 'idle']

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

function mapSearchStatus(s: SearchStatus | null): Task | null {
  if (!s || !s.started_at) return null

  const status: TaskStatus = s.running ? 'running' : s.error ? 'error' : 'success'

  let progress: Task['progress']
  if (s.stage === 'discover') progress = { current: s.queries, total: s.queries_total || undefined, stageLabel: 'discover' }
  else if (s.stage === 'enrich') progress = { current: s.enriched, total: s.enrich_total || undefined, stageLabel: 'enrich' }
  else if (s.stage === 'score') progress = { current: s.scored, total: s.score_total || undefined, stageLabel: 'score' }

  const log: string[] = []
  if (s.queries_total > 0) {
    log.push(`Discover: ${s.new} new, ${s.existing} existing across ${s.queries}/${s.queries_total} queries (${s.discover_errors} errors)`)
  }
  for (const entry of s.discover_log) {
    log.push(
      `${entry.query} @ ${entry.location}: ${entry.new} new, ${entry.existing} existing, ${entry.filtered} filtered` +
        (entry.errors ? `, ${entry.errors} errors` : ''),
    )
  }
  if (s.enrich_total > 0) log.push(`Enrich: ${s.enriched}/${s.enrich_total} done`)
  if (s.score_total > 0) log.push(`Score: ${s.scored}/${s.score_total} done`)
  for (const w of s.warnings) log.push(`Warning: ${w}`)

  return {
    id: 'search-current',
    type: 'search',
    label: 'Search run — discover → enrich → score',
    status,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    progress,
    error: s.error ? `${s.error}${s.error_stage ? ` (at ${s.error_stage} stage)` : ''}` : null,
    log,
  }
}

function mapStatusCheckStatus(s: StatusCheckStatus | null, wasStoppedByUser: boolean): Task | null {
  if (!s || !s.started_at) return null

  const status: TaskStatus = s.running ? 'running' : s.error ? 'error' : wasStoppedByUser ? 'terminated' : 'success'

  const log = [
    ...s.log.map((e) => `${e.result.toUpperCase()}: ${e.title ?? e.url}${e.company ? ` — ${e.company}` : ''}`),
    ...s.warnings.map((w) => `Warning: ${w}`),
  ]

  return {
    id: 'status-check-current',
    type: 'status_check',
    label: 'Status check — rechecking pending postings',
    status,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    progress: s.total > 0 ? { current: s.checked, total: s.total } : undefined,
    error: s.error,
    log,
  }
}

// Maps one occupied auto-submit slot to a Task. Only called for slots
// getAllAutoSubmitStatuses() actually returned (running or pending_review),
// so started_at/slot_id are always present.
function mapAutoApplyStatus(s: AutoSubmitStatus): Task {
  let status: TaskStatus
  if (s.running) status = 'running'
  else if (s.error) status = 'error'
  else if (s.status === 'blocked') status = 'blocked'
  else if (s.status === 'ready_for_review') status = 'success'
  else if (s.pending_review) status = 'terminated' // cancelled mid-run -- Chrome left open, no specific terminal status
  else status = 'error'

  const log = [...s.transcript, ...(s.last_action ? [`Last: ${s.last_action}`] : [])]

  return {
    id: `auto-apply-${s.slot_id}`,
    type: 'auto_apply',
    label: `Auto-apply — ${s.job_title || s.url || 'job'}${s.job_company ? ` @ ${s.job_company}` : ''}`,
    status,
    startedAt: s.started_at!,
    finishedAt: s.finished_at,
    progress: s.running ? { current: s.actions, stageLabel: s.last_action ?? undefined } : undefined,
    error: s.error ?? null,
    log,
    jobUrl: s.url ?? undefined,
    slotId: s.slot_id,
    screenshot: s.screenshot,
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
  const searchStatus = usePolling(getSearchStatus, POLL_INTERVAL_MS)
  const statusCheckStatus = usePolling(getStatusCheckStatus, POLL_INTERVAL_MS)
  const autoApplyStatuses = usePolling(getAllAutoSubmitStatuses, POLL_INTERVAL_MS)

  // Neither search_state.py nor status_check_state.py keeps a history of
  // past runs -- there's only ever "the current/last run's status". So
  // "delete" on one of those can't remove server state; it just hides that
  // one run's row until a fresh run (a new started_at) replaces it.
  const [dismissed, setDismissed] = useState<Record<string, string>>({})

  // status_check_state.cancel() just stops the run early -- the resulting
  // status looks identical to a normal finish (running: false, no error).
  // Track that *we* asked for the stop so the row can say "Terminated"
  // instead of "Success"; keyed by started_at so a later run isn't
  // mislabeled once it reuses the same task id.
  const [stoppedRunStartedAt, setStoppedRunStartedAt] = useState<string | null>(null)

  // auto_apply slots vanish from getAllAutoSubmitStatuses() the instant
  // they're no longer running/pending_review (server frees a plain-failed
  // slot immediately, unlike search/status-check's lingering last-run
  // snapshot) -- so cache each slot's last-seen Task locally, keyed by slot
  // id, and keep showing it until the user explicitly deletes it. Dismissed
  // tracking is keyed by (slotId, startedAt) so a slot reused by a later
  // job isn't mislabeled as still-dismissed.
  const [autoApplyCache, setAutoApplyCache] = useState<Record<number, Task>>({})
  const [autoApplyDismissed, setAutoApplyDismissed] = useState<Record<number, string>>({})

  useEffect(() => {
    if (!autoApplyStatuses) return
    setAutoApplyCache((prev) => {
      const next = { ...prev }
      for (const s of autoApplyStatuses) {
        if (s.slot_id === undefined) continue
        next[s.slot_id] = mapAutoApplyStatus(s)
      }
      return next
    })
  }, [autoApplyStatuses])

  const searchTask = useMemo(() => mapSearchStatus(searchStatus), [searchStatus])
  const statusCheckTask = useMemo(
    () => mapStatusCheckStatus(statusCheckStatus, statusCheckStatus?.started_at === stoppedRunStartedAt),
    [statusCheckStatus, stoppedRunStartedAt],
  )

  const tasks = useMemo(() => {
    const realTasks = [searchTask, statusCheckTask].filter(
      (t): t is Task => t !== null && dismissed[t.id] !== t.startedAt,
    )
    const autoApplyTasks = Object.values(autoApplyCache).filter(
      (t) => t.slotId === undefined || autoApplyDismissed[t.slotId] !== t.startedAt,
    )
    return [...realTasks, ...autoApplyTasks]
  }, [searchTask, statusCheckTask, dismissed, autoApplyCache, autoApplyDismissed])

  function handleStop(task: Task) {
    if (task.type === 'auto_apply') {
      if (task.jobUrl) cancelAutoSubmit(task.jobUrl).catch(() => {})
      return
    }
    if (task.type === 'status_check') {
      setStoppedRunStartedAt(task.startedAt)
      cancelStatusCheck().catch(() => {
        // best-effort -- the next poll reflects whatever actually happened
      })
    }
    // Search has no backend cancel yet -- its Stop button is disabled.
  }

  function handleDelete(task: Task) {
    if (task.type === 'auto_apply') {
      if (task.slotId !== undefined) {
        setAutoApplyDismissed((prev) => ({ ...prev, [task.slotId!]: task.startedAt }))
      }
      // Best-effort: only actually frees something server-side when the
      // slot is still pending_review (ready_for_review/blocked/cancelled);
      // a harmless no-op otherwise (the slot already freed itself).
      if (task.jobUrl) dismissAutoSubmit(task.jobUrl).catch(() => {})
    } else {
      setDismissed((prev) => ({ ...prev, [task.id]: task.startedAt }))
    }
  }

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [tasks],
  )

  const runningCount = tasks.filter((t) => t.status === 'running' || t.status === 'idle').length
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
          <div className="label">Running / Queued</div>
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
