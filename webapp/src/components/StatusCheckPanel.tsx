import { useEffect, useRef, useState } from 'react'
import { ApiError, cancelStatusCheck, getStatusCheckCandidateCount, getStatusCheckStatus, runStatusCheck } from '../api/client'
import type { JobFilterParams, StatusCheckLogEntry, StatusCheckStatus } from '../api/types'
import { ProgressBar } from './ProgressBar'
import { WarningsSummary } from './SearchPanel'

const RESULT_ICON: Record<StatusCheckLogEntry['result'], string> = {
  open: '✓',
  closed: '✕',
  error: '⚠',
}

/** Scrolling per-job log, newest at the bottom -- same shape as SearchPanel's
 * DiscoverLog, just a different row (job title/company + open/closed/error
 * instead of query/location + new/dupes/filtered). */
function StatusCheckLog({ entries }: { entries: StatusCheckLogEntry[] }) {
  const ref = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  if (entries.length === 0) return null

  return (
    <ul className="search-discover-log" ref={ref}>
      {entries.map((entry, i) => (
        <li className="search-discover-log-row" key={i}>
          <span aria-hidden="true">{RESULT_ICON[entry.result]}</span>
          <span className="search-discover-log-query" title={entry.title ?? entry.url}>
            {entry.title ?? entry.url}
            {entry.company ? ` — ${entry.company}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

interface Props {
  /** The jobs table's current filter criteria -- the scan checks exactly
   * this set of pending jobs, so "N jobs match" here always agrees with
   * what the table itself shows. */
  filters: JobFilterParams
  /** Called on start, on each poll tick (jobs get marked closed as the scan
   * runs), and once it finishes -- so the jobs table/badges refresh live. */
  onActivity: () => void
}

export function StatusCheckPanel({ filters, onActivity }: Props) {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [status, setStatus] = useState<StatusCheckStatus | null>(null)
  const [candidateCount, setCandidateCount] = useState<number | null>(null)
  const [countError, setCountError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const phase: 'config' | 'progress' | 'overview' = running
    ? 'progress'
    : result !== null || error !== null
      ? 'overview'
      : 'config'

  useEffect(() => {
    getStatusCheckStatus()
      .then((s) => {
        setStatus(s)
        if (s.running) setRunning(true)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(async () => {
      try {
        const s = await getStatusCheckStatus()
        setStatus(s)
        onActivity()
        if (!s.running) {
          setRunning(false)
          if (s.error) {
            setResult(null)
            setError(s.error)
          } else {
            setResult('done')
            setError(null)
          }
        }
      } catch {
        // keep polling — transient network hiccup
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [running, onActivity])

  // Shows "N jobs match" before the user commits -- refetched whenever the
  // config page is showing and the table's filters change underneath it.
  useEffect(() => {
    if (phase !== 'config' || !open) return
    let cancelled = false
    setCandidateCount(null)
    setCountError(null)
    getStatusCheckCandidateCount(filters)
      .then((r) => {
        if (!cancelled) setCandidateCount(r.count)
      })
      .catch((e) => {
        if (!cancelled) setCountError(e instanceof ApiError ? e.message : 'Could not load count')
      })
    return () => {
      cancelled = true
    }
  }, [phase, open, filters])

  async function handleStart() {
    setStarting(true)
    setResult(null)
    setError(null)
    try {
      const s = await runStatusCheck(filters)
      setStatus(s)
      setRunning(true)
      onActivity()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setRunning(true)
      } else {
        setError(e instanceof ApiError ? e.message : 'Failed to start status check')
      }
    } finally {
      setStarting(false)
    }
  }

  async function handleCancel() {
    try {
      await cancelStatusCheck()
    } catch {
      // the next poll tick will reflect whatever actually happened
    }
  }

  function closeAndReset() {
    setOpen(false)
    setMinimized(false)
    setResult(null)
    setError(null)
  }

  const closedJobs = (status?.log ?? []).filter((e) => e.result === 'closed')

  return (
    <>
      <button
        type="button"
        className="search-trigger"
        onClick={() => {
          setOpen(true)
          setMinimized(false)
        }}
      >
        {running && status ? `Checking… ${status.checked}/${status.total}` : 'Check Job Status'}
      </button>

      {minimized && (running || result || error) && (
        <div className="search-minimized status-check-minimized">
          <button
            type="button"
            className="search-minimized-body"
            onClick={() => {
              setOpen(true)
              setMinimized(false)
            }}
          >
            <span className="search-minimized-dot" data-state={error ? 'error' : running ? 'running' : 'done'} />
            <span className="search-minimized-label">
              {running ? 'Checking job status…' : error ? 'Status check failed' : 'Status check done'}
            </span>
            {running && status && (
              <span className="search-minimized-detail">{status.checked}/{status.total}</span>
            )}
          </button>
          {!running && (
            <button
              type="button"
              className="search-minimized-dismiss"
              aria-label="Dismiss"
              onClick={() => {
                setMinimized(false)
                setResult(null)
                setError(null)
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {open && !minimized && (
        <div className="modal-backdrop" onClick={() => (phase === 'overview' ? closeAndReset() : setOpen(false))}>
          <div className="modal-panel search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">
                  {phase === 'progress'
                    ? 'Checking job status'
                    : phase === 'overview'
                      ? 'Status check results'
                      : 'Check job status'}
                </h2>
                <p className="modal-subtitle">
                  {phase === 'progress' ? (
                    'Revisiting each pending job posting to see if it has closed.'
                  ) : phase === 'overview' ? (
                    'Jobs found closed have been marked with the "Closed" status automatically.'
                  ) : (
                    'Rechecks pending jobs (not yet applied to, not already closed) matching your current jobs table filters, and marks any that have closed.'
                  )}
                </p>
              </div>
              <div className="modal-header-actions">
                {phase === 'progress' && (
                  <button
                    type="button"
                    className="modal-minimize"
                    onClick={() => setMinimized(true)}
                    aria-label="Minimize"
                  >
                    –
                  </button>
                )}
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => {
                    if (phase === 'overview') {
                      closeAndReset()
                    } else {
                      setOpen(false)
                      setMinimized(false)
                    }
                  }}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="search-panel">
              {phase === 'config' && (
                <>
                  <p className="search-result">
                    {countError ? (
                      <span className="search-error">{countError}</span>
                    ) : candidateCount === null ? (
                      'Counting matching jobs…'
                    ) : (
                      `${candidateCount} job${candidateCount === 1 ? '' : 's'} match your current filters and will be checked.`
                    )}
                  </p>
                  <div className="config-actions">
                    <button type="button" disabled={starting || !candidateCount} onClick={handleStart}>
                      {starting ? 'Starting…' : 'Start Check'}
                    </button>
                  </div>
                  {error && <span className="search-result search-error">{error}</span>}
                </>
              )}

              {phase === 'progress' && status && (
                <div className="search-progress-view">
                  <div className="search-log-step search-log-step-current">
                    <div className="search-log-step-header">
                      <span className="search-log-step-icon" aria-hidden="true">●</span>
                      <span className="search-log-step-title">Checking postings</span>
                    </div>
                    <div className="search-log-step-body">
                      <ProgressBar done={status.checked} total={status.total} label="Checked" />
                      {status.current && (
                        <p className="search-log-step-summary">
                          {status.current.title ?? status.current.url}
                          {status.current.company ? ` — ${status.current.company}` : ''}
                        </p>
                      )}
                      <StatusCheckLog entries={status.log} />
                    </div>
                  </div>
                  <div className="search-overview-actions">
                    <button type="button" className="auto-submit-cancel" onClick={handleCancel}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {phase === 'overview' && status && (
                <div className="search-overview">
                  {error ? (
                    <p className="search-result search-error">{error}</p>
                  ) : (
                    <p className="search-result">
                      Checked {status.checked} of {status.total} job{status.total === 1 ? '' : 's'} —{' '}
                      {status.closed_found} marked closed.
                    </p>
                  )}
                  {closedJobs.length > 0 && (
                    <ul className="search-results-list">
                      {closedJobs.map((job) => (
                        <li key={job.url} className="search-results-row">
                          <a href={job.url} target="_blank" rel="noreferrer">
                            {job.title ?? job.url}
                          </a>
                          {job.company && <span className="search-results-meta">{job.company}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <WarningsSummary warnings={status.warnings} />
                  <div className="config-actions">
                    <button type="button" onClick={closeAndReset}>
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
