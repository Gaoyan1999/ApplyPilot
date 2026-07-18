import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ApiError,
  confirmSearchResults,
  discardNewSearchResults,
  getSearchConfig,
  getSearchNewJobs,
  getSearchStatus,
  runSearch,
  saveSearchConfig,
} from '../api/client'
import type { DiscoverLogEntry, Job, SearchConfig, SearchRunStage, SearchStatus } from '../api/types'
import { ProgressBar } from './ProgressBar'
import { ScorePill } from './ScorePill'
import { SiteIcon } from './SiteIcon'

// The dashboard displays discover+enrich as one "Searching" step (fetching
// full descriptions is an implementation detail of search, not something a
// user needs to track separately) and score as "Rating" -- two steps live,
// plus a third "Results" step once the run finishes.
const STAGE_LABELS: Record<Exclude<SearchRunStage, null>, string> = {
  discover: 'Searching…',
  enrich: 'Searching…',
  score: 'Rating fit…',
  done: 'Done',
}

/** Longer, plain-language explanation of what's actually happening during
 * each stage -- shown alongside the numeric progress bar so the run doesn't
 * read as an opaque spinner. */
const STAGE_DESCRIPTIONS: Record<Exclude<SearchRunStage, null>, string> = {
  discover: 'Searching job boards for postings that match your saved queries and locations.',
  enrich: 'Visiting each newly found job posting to pull its full description.',
  score: 'Asking the AI to rate how well each job matches your profile.',
  done: 'Search complete.',
}

function stageLabel(stage: SearchRunStage): string {
  return stage ? STAGE_LABELS[stage] : 'Searching…'
}

/** Terse one-line status for the minimized widget. */
function compactStageDetail(status: SearchStatus | null): string | null {
  if (!status || !status.stage || status.stage === 'done') return null
  if (status.stage === 'discover') return `${status.queries}/${status.queries_total} queries, ${status.new} found`
  if (status.stage === 'enrich') return `${status.enriched}/${status.enrich_total} details fetched`
  if (status.stage === 'score') return `${status.scored}/${status.score_total} scored`
  return null
}

type DisplayStage = 'search' | 'rate'
const DISPLAY_STAGES: DisplayStage[] = ['search', 'rate']
const DISPLAY_STAGE_TITLES: Record<DisplayStage, string> = {
  search: 'Searching job boards',
  rate: 'Rating fit',
}

/** Maps the backend's 3 pipeline stages onto the 2 steps shown live
 * (discover and enrich both count as "search"); anything past scoring
 * (i.e. 'done' or null once the run has finished) is capped to the last
 * step index by the caller. */
function displayStageIndex(stage: SearchRunStage): number {
  if (stage === 'discover' || stage === 'enrich') return 0
  if (stage === 'score') return 1
  return DISPLAY_STAGES.length
}

function discoverStatusText(status: SearchStatus): string {
  if (status.current_query && status.current_location) {
    return `Searching job boards for postings that match your saved queries — currently querying "${status.current_query}" in ${status.current_location}.`
  }
  return STAGE_DESCRIPTIONS.discover
}

function discoverSummaryText(status: SearchStatus): string {
  return (
    `Found ${status.new} new job${status.new === 1 ? '' : 's'}` +
    (status.existing > 0 ? ` (${status.existing} already known)` : '') +
    ` across ${status.queries_total} search${status.queries_total === 1 ? '' : 'es'}.`
  )
}

/** Scrolling per-query result log. One row per query x location combo, with
 * count badges instead of a raw formatted backend string -- new/dupes/
 * filtered aren't mutually exclusive with "failed" (a storage error can
 * still have filtered a nonzero number of results before it hit the DB
 * error), so all applicable badges show together. Pinned to the bottom so
 * the newest row is always visible as more come in. */
function DiscoverLogRow({ entry }: { entry: DiscoverLogEntry }) {
  return (
    <li className="search-discover-log-row">
      <span className="search-discover-log-query" title={`"${entry.query}" in ${entry.location}`}>
        "{entry.query}" in {entry.location}
      </span>
      {entry.tier > 0 && <span className="search-discover-log-tier">tier {entry.tier}</span>}
      <span className="discover-log-badges">
        {entry.new > 0 && <span className="discover-log-badge new">+{entry.new} new</span>}
        {entry.existing > 0 && <span className="discover-log-badge dupes">{entry.existing} dupes</span>}
        {entry.filtered > 0 && <span className="discover-log-badge filtered">{entry.filtered} filtered</span>}
        {entry.errors > 0 && <span className="discover-log-badge failed">failed</span>}
      </span>
    </li>
  )
}

function DiscoverLog({ entries }: { entries: DiscoverLogEntry[] }) {
  const ref = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  if (entries.length === 0) return null

  return (
    <ul className="search-discover-log" ref={ref}>
      {entries.map((entry, i) => (
        <DiscoverLogRow entry={entry} key={i} />
      ))}
    </ul>
  )
}

function SiteChips({ status }: { status: SearchStatus }) {
  const sites = Object.entries(status.discover_by_site)
  if (sites.length === 0) return null
  return (
    <div className="site-progress-row">
      {sites.map(([site, count]) => (
        <span className="site-progress-chip" key={site}>
          <SiteIcon site={site} /> {count}
        </span>
      ))}
    </div>
  )
}

/** Body of the merged "Searching" step: shows discover's query progress,
 * then (still under the same step) enrich's detail-fetch progress, then
 * freezes on a combined summary once both are done. */
function SearchStepBody({ status, isCurrent }: { status: SearchStatus; isCurrent: boolean }): ReactNode {
  if (isCurrent && status.stage === 'discover') {
    return (
      <>
        <p className="search-stage-description">{discoverStatusText(status)}</p>
        <ProgressBar done={status.queries} total={status.queries_total} label="Queries" />
        <DiscoverLog entries={status.discover_log} />
        <SiteChips status={status} />
      </>
    )
  }
  if (isCurrent && status.stage === 'enrich') {
    return (
      <>
        <p className="search-log-step-summary">{discoverSummaryText(status)}</p>
        <SiteChips status={status} />
        <p className="search-stage-description">{STAGE_DESCRIPTIONS.enrich}</p>
        <ProgressBar done={status.enriched} total={status.enrich_total} label="Fetching details" />
      </>
    )
  }
  return (
    <>
      <p className="search-log-step-summary">{discoverSummaryText(status)}</p>
      <SiteChips status={status} />
    </>
  )
}

function RateStepBody({ status, isCurrent }: { status: SearchStatus; isCurrent: boolean }): ReactNode {
  if (isCurrent) {
    return (
      <>
        <p className="search-stage-description">{STAGE_DESCRIPTIONS.score}</p>
        <ProgressBar done={status.scored} total={status.score_total} label="Scoring" />
        <p className="search-progress-summary">{status.scored} of {status.score_total} jobs rated.</p>
      </>
    )
  }
  return (
    <p className="search-log-step-summary">
      Rated {status.scored} of {status.score_total} job{status.score_total === 1 ? '' : 's'} for fit.
    </p>
  )
}

/** Accumulating step-by-step log of a search run: "Searching" (discover +
 * enrich) then "Rating" (score). Earlier steps stay visible with their
 * frozen final summary once the run moves on, instead of being replaced --
 * used both mid-run (as steps complete one at a time) and on the final
 * overview (both steps shown as done). */
function SearchLog({ status }: { status: SearchStatus }) {
  const stageIdx = Math.min(displayStageIndex(status.stage), DISPLAY_STAGES.length - 1)
  const erroredIdx = status.error ? stageIdx : -1
  const lastVisible = status.running || status.error ? stageIdx : DISPLAY_STAGES.length - 1

  return (
    <div className="search-log">
      {DISPLAY_STAGES.map((s, i) => {
        if (i > lastVisible) return null
        const isCurrent = status.running && i === stageIdx
        const isErrored = i === erroredIdx
        return (
          <div
            key={s}
            className={`search-log-step${isCurrent ? ' search-log-step-current' : ''}${isErrored ? ' search-log-step-error' : ''}`}
          >
            <div className="search-log-step-header">
              <span className="search-log-step-icon" aria-hidden="true">
                {isErrored ? '✕' : isCurrent ? '●' : '✓'}
              </span>
              <span className="search-log-step-title">
                Step {i + 1}: {DISPLAY_STAGE_TITLES[s]}
              </span>
            </div>
            <div className="search-log-step-body">
              {s === 'search' ? (
                <SearchStepBody status={status} isCurrent={isCurrent} />
              ) : (
                <RateStepBody status={status} isCurrent={isCurrent} />
              )}
              {isErrored && <p className="search-result search-error">{status.error}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Step 3, overview-only: the actual jobs this run found, once rated.
 * Fetches lazily on mount rather than being threaded through SearchStatus,
 * since the polling payload stays small during a run. */
function SearchResultsStep({ count }: { count: number }) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getSearchNewJobs()
      .then((js) => {
        if (!cancelled) setJobs(js)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load results')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (count === 0) return null

  return (
    <div className="search-log-step">
      <div className="search-log-step-header">
        <span className="search-log-step-icon" aria-hidden="true">✓</span>
        <span className="search-log-step-title">Step 3: Results</span>
      </div>
      <div className="search-log-step-body">
        {loadError && <p className="search-result search-error">{loadError}</p>}
        {!loadError && jobs === null && <p className="search-log-step-summary">Loading…</p>}
        {jobs && jobs.length > 0 && (
          <ul className="search-results-list">
            {jobs.map((job) => (
              <li key={job.url} className="search-results-row">
                <span className="search-results-title">{job.title ?? 'Untitled'}</span>
                <span className="search-results-meta">
                  <SiteIcon site={job.site} />
                  <ScorePill score={job.fit_score} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Non-blocking summary of third-party calls that permanently failed after
 * retries (a LinkedIn/Glassdoor scrape, an LLM call, a detail-page fetch).
 * These never stop the run -- this is just visibility into what got skipped. */
function WarningsSummary({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false)
  if (warnings.length === 0) return null

  return (
    <div className="search-warnings">
      <button type="button" className="search-warnings-toggle" onClick={() => setOpen((o) => !o)}>
        ⚠ {warnings.length} issue{warnings.length === 1 ? '' : 's'} (didn't block progress)
        <span className="chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="search-warnings-list">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

const EMPTY_CONFIG: SearchConfig = {
  queries: [],
  locations: [],
  exclude_titles: [],
  boards: ['indeed', 'linkedin'],
  defaults: { results_per_site: 100, hours_old: 168 },
}

export const TIME_RANGES: { label: string; hours: number }[] = [
  { label: 'Past 24 hours', hours: 24 },
  { label: 'Past week', hours: 168 },
  { label: 'Past month', hours: 720 },
]

interface Props {
  /** Called whenever a search run may have changed the jobs DB -- on start,
   * on each in-progress status tick (discovery writes rows as it goes), and
   * after confirm/discard -- so the dashboard's jobs table and stat pills
   * can refetch without a background poll of their own. */
  onActivity: () => void
}

export function SearchPanel({ onActivity }: Props) {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [config, setConfig] = useState<SearchConfig>(EMPTY_CONFIG)
  const [queriesOpen, setQueriesOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [stage, setStage] = useState<SearchRunStage>(null)
  const [status, setStatus] = useState<SearchStatus | null>(null)
  // Config-page-only feedback (saving the form, independent of any run).
  const [configMessage, setConfigMessage] = useState<string | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  // Run-outcome signals -- only ever touched by the polling loop (a run just
  // finished) or by starting a new run (reset to null). Drives the
  // config/progress/overview phase split below.
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  // Three mutually exclusive pages -- never mixed. `progress` and `overview`
  // both hide the editable config form entirely.
  const phase: 'config' | 'progress' | 'overview' = running
    ? 'progress'
    : result !== null || error !== null
      ? 'overview'
      : 'config'

  useEffect(() => {
    getSearchStatus().then((s) => {
      setStatus(s)
      if (s.running) {
        setRunning(true)
        setStage(s.stage)
      }
    }).catch(() => {})
  }, [])

  // Refetches on every open (rather than caching after the first load) so
  // boards/exclude-titles/defaults edited from Settings in the meantime
  // aren't clobbered by a stale in-memory copy on the next Save here --
  // saving PUTs back the whole managed config, including fields this modal
  // never shows.
  useEffect(() => {
    if (!open) return
    getSearchConfig()
      .then((cfg) => setConfig(cfg))
      .catch(() => setConfigError('Could not load search config'))
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (phase === 'overview') closeAndReset()
      else setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, phase])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(async () => {
      try {
        const s = await getSearchStatus()
        setStatus(s)
        setStage(s.stage)
        onActivity()
        if (!s.running) {
          setRunning(false)
          if (s.error) {
            setResult(null)
            const where = s.error_stage ? ` during ${s.error_stage}` : ''
            setError(`${s.error}${where}`)
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

  function addQuery() {
    setConfig((c) => ({ ...c, queries: [...c.queries, { query: '', tier: 1 }] }))
  }

  function updateQuery(i: number, patch: Partial<SearchConfig['queries'][number]>) {
    setConfig((c) => ({
      ...c,
      queries: c.queries.map((q, idx) => (idx === i ? { ...q, ...patch } : q)),
    }))
  }

  function removeQuery(i: number) {
    setConfig((c) => ({ ...c, queries: c.queries.filter((_, idx) => idx !== i) }))
  }

  function addLocation() {
    setConfig((c) => ({ ...c, locations: [...c.locations, { location: '', remote: false }] }))
  }

  function updateLocation(i: number, patch: Partial<SearchConfig['locations'][number]>) {
    setConfig((c) => ({
      ...c,
      locations: c.locations.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }))
  }

  function removeLocation(i: number) {
    setConfig((c) => ({ ...c, locations: c.locations.filter((_, idx) => idx !== i) }))
  }

  async function handleSave(andSearch: boolean) {
    setConfigMessage(null)
    setConfigError(null)
    setSaving(true)
    try {
      const saved = await saveSearchConfig(config)
      setConfig(saved)

      if (andSearch) {
        const s = await runSearch()
        setStatus(s)
        setRunning(true)
        setStage(s.stage ?? 'discover')
        setResult(null)
        setError(null)
        onActivity()
      } else {
        setConfigMessage('Search config saved')
      }
    } catch (e) {
      if (andSearch && e instanceof ApiError && e.status === 409) {
        setRunning(true)
      } else {
        setConfigError(e instanceof Error ? e.message : 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  // Closes the modal and clears the run-outcome state, so the next click on
  // the "Search" trigger starts fresh at the config page instead of showing
  // this run's overview again.
  function closeAndReset() {
    setOpen(false)
    setMinimized(false)
    setResult(null)
    setError(null)
  }

  async function handleConfirm() {
    setConfirmBusy(true)
    try {
      await confirmSearchResults()
      closeAndReset()
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : 'Could not confirm results')
    } finally {
      setConfirmBusy(false)
    }
  }

  async function handleDiscard() {
    const count = status?.new ?? 0
    if (!window.confirm(`Delete ${count} newly found job${count === 1 ? '' : 's'}? This can't be undone.`)) {
      return
    }
    setConfirmBusy(true)
    try {
      await discardNewSearchResults()
      closeAndReset()
      onActivity()
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : 'Could not discard results')
    } finally {
      setConfirmBusy(false)
    }
  }

  const busy = running || saving

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
        {running ? stageLabel(stage) : 'Search'}
      </button>

      {minimized && (running || result || error) && (
        <div className="search-minimized">
          <button
            type="button"
            className="search-minimized-body"
            onClick={() => {
              setOpen(true)
              setMinimized(false)
            }}
          >
            <span
              className="search-minimized-dot"
              data-state={error ? 'error' : running ? 'running' : 'done'}
            />
            <span className="search-minimized-label">
              {running ? stageLabel(stage) : error ? 'Search failed' : 'Search done'}
            </span>
            {running && status && (
              <span className="search-minimized-detail">{compactStageDetail(status)}</span>
            )}
            {!running && status && status.warnings.length > 0 && (
              <span className="search-minimized-detail">⚠ {status.warnings.length}</span>
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
                  {phase === 'progress' ? 'Search in progress' : phase === 'overview' ? 'Search results' : 'Search config'}
                </h2>
                <p className="modal-subtitle">
                  {phase === 'progress' ? (
                    'Running your saved search — this can take a few minutes.'
                  ) : phase === 'overview' ? (
                    "New jobs are saved automatically as they're found — use Discard below to remove just this run's finds."
                  ) : (
                    <>
                      Edits ~/.applypilot/searches.yaml — also used by <code>applypilot run discover</code>.
                      Job boards, excluded titles, and result defaults are in Settings.
                    </>
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
                    // Dismissing the overview (rather than a live run) also
                    // clears the run-outcome state -- otherwise reopening
                    // via the trigger button would show this same stale
                    // overview instead of letting a new search start.
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
              {phase === 'progress' && status && (
                <div className="search-progress-view">
                  <SearchLog status={status} />
                </div>
              )}

              {phase === 'overview' && status && (
                <div className="search-overview">
                  <SearchLog status={status} />
                  <SearchResultsStep count={status.new} />
                  {status.new > 0 ? (
                    <div className="search-overview-actions">
                      <button
                        type="button"
                        className="search-discard-btn"
                        disabled={confirmBusy}
                        onClick={handleDiscard}
                      >
                        Delete {status.new} new job{status.new === 1 ? '' : 's'}
                      </button>
                      <button type="button" disabled={confirmBusy} onClick={handleConfirm}>
                        {confirmBusy ? 'Saving…' : 'Confirm & keep'}
                      </button>
                    </div>
                  ) : (
                    <p className="search-result">No new jobs found this run.</p>
                  )}
                  {configError && <span className="search-result search-error">{configError}</span>}
                  <WarningsSummary warnings={status.warnings} />
                </div>
              )}

              {phase === 'config' && (
                <>
                  <div className="config-section">
                    <button
                      type="button"
                      className="config-section-toggle"
                      onClick={() => setQueriesOpen((o) => !o)}
                      aria-expanded={queriesOpen}
                    >
                      <h3>Search queries ({config.queries.length})</h3>
                      <span className="chevron">{queriesOpen ? '▾' : '▸'}</span>
                    </button>
                    {queriesOpen && (
                      <>
                        {config.queries.map((q, i) => (
                          <div className="config-row" key={i}>
                            <input
                              type="text"
                              placeholder="Job title or keywords"
                              value={q.query}
                              onChange={(e) => updateQuery(i, { query: e.target.value })}
                            />
                            <select
                              value={q.tier}
                              onChange={(e) => updateQuery(i, { tier: Number(e.target.value) })}
                            >
                              <option value={1}>Tier 1</option>
                              <option value={2}>Tier 2</option>
                              <option value={3}>Tier 3</option>
                            </select>
                            <button type="button" className="remove-btn" onClick={() => removeQuery(i)} aria-label="Remove query">
                              ✕
                            </button>
                          </div>
                        ))}
                        <button type="button" className="add-btn" onClick={addQuery}>
                          + Add query
                        </button>
                      </>
                    )}
                  </div>

                  <div className="config-section">
                    <h3>Locations</h3>
                    {config.locations.map((loc, i) => (
                      <div className="config-row" key={i}>
                        <input
                          type="text"
                          placeholder="City, state, or Remote"
                          value={loc.location}
                          onChange={(e) => updateLocation(i, { location: e.target.value })}
                        />
                        <label className="toggle-check">
                          <input
                            type="checkbox"
                            checked={loc.remote}
                            onChange={(e) => updateLocation(i, { remote: e.target.checked })}
                          />
                          Remote
                        </label>
                        <button type="button" className="remove-btn" onClick={() => removeLocation(i)} aria-label="Remove location">
                          ✕
                        </button>
                      </div>
                    ))}
                    <button type="button" className="add-btn" onClick={addLocation}>
                      + Add location
                    </button>
                  </div>

                  <div className="config-actions">
                    <button type="button" disabled={busy} onClick={() => handleSave(false)}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => handleSave(true)}>
                      Save & Search
                    </button>
                  </div>
                  {configMessage && <span className="search-result">{configMessage}</span>}
                  {configError && <span className="search-result search-error">{configError}</span>}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
