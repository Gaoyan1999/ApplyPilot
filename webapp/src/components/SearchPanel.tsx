import { useEffect, useState, type ReactNode } from 'react'
import {
  ApiError,
  confirmSearchResults,
  discardNewSearchResults,
  getSearchConfig,
  getSearchStatus,
  runSearch,
  saveSearchConfig,
} from '../api/client'
import type { SearchConfig, SearchRunStage, SearchStatus } from '../api/types'
import { ProgressBar } from './ProgressBar'
import { SEARCHABLE_SITES, SiteIcon, SITE_META } from './SiteIcon'

const STAGE_LABELS: Record<Exclude<SearchRunStage, null>, string> = {
  discover: 'Searching…',
  enrich: 'Fetching details…',
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

/** Renders live in-progress detail for the active stage. `compact` gives a
 * terse one-line variant for the minimized widget; the full variant (with a
 * description, progress bar, and per-site chips) is used as the current
 * step's body inside SearchLog. */
function renderStageDetail(status: SearchStatus | null, compact: boolean): ReactNode {
  if (!status || !status.stage || status.stage === 'done') return null

  if (status.stage === 'discover') {
    if (compact) {
      return `${status.queries}/${status.queries_total} queries, ${status.new} found`
    }
    const sites = Object.entries(status.discover_by_site)
    return (
      <div className="search-progress">
        <p className="search-stage-description">{STAGE_DESCRIPTIONS.discover}</p>
        <ProgressBar done={status.queries} total={status.queries_total} label="Queries" />
        <p className="search-progress-summary">
          {status.queries} of {status.queries_total} searches run — {status.new} new job
          {status.new === 1 ? '' : 's'} found
          {status.existing > 0 ? `, ${status.existing} already known` : ''}.
        </p>
        {sites.length > 0 && (
          <div className="site-progress-row">
            {sites.map(([site, count]) => (
              <span className="site-progress-chip" key={site}>
                <SiteIcon site={site} /> {count}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (status.stage === 'enrich') {
    return compact ? (
      `${status.enriched}/${status.enrich_total} enriched`
    ) : (
      <div className="search-progress">
        <p className="search-stage-description">{STAGE_DESCRIPTIONS.enrich}</p>
        <ProgressBar done={status.enriched} total={status.enrich_total} label="Enriching" />
        <p className="search-progress-summary">
          {status.enriched} of {status.enrich_total} job pages fetched.
        </p>
      </div>
    )
  }

  if (status.stage === 'score') {
    return compact ? (
      `${status.scored}/${status.score_total} scored`
    ) : (
      <div className="search-progress">
        <p className="search-stage-description">{STAGE_DESCRIPTIONS.score}</p>
        <ProgressBar done={status.scored} total={status.score_total} label="Scoring" />
        <p className="search-progress-summary">{status.scored} of {status.score_total} jobs rated.</p>
      </div>
    )
  }

  return null
}

const STAGE_ORDER: ('discover' | 'enrich' | 'score')[] = ['discover', 'enrich', 'score']

const STAGE_STEP_TITLES: Record<(typeof STAGE_ORDER)[number], string> = {
  discover: 'Searching job boards',
  enrich: 'Fetching job details',
  score: 'Rating fit',
}

/** Final one-line (plus site chips, for discover) recap of a stage that has
 * already finished -- what renderStageDetail shows live, frozen in place. */
function stageDoneSummary(stage: (typeof STAGE_ORDER)[number], status: SearchStatus): ReactNode {
  if (stage === 'discover') {
    const sites = Object.entries(status.discover_by_site)
    return (
      <>
        <p className="search-log-step-summary">
          Found {status.new} new job{status.new === 1 ? '' : 's'}
          {status.existing > 0 ? ` (${status.existing} already known)` : ''} across {status.queries_total} search
          {status.queries_total === 1 ? '' : 'es'}.
        </p>
        {sites.length > 0 && (
          <div className="site-progress-row">
            {sites.map(([site, count]) => (
              <span className="site-progress-chip" key={site}>
                <SiteIcon site={site} /> {count}
              </span>
            ))}
          </div>
        )}
      </>
    )
  }
  if (stage === 'enrich') {
    return (
      <p className="search-log-step-summary">
        Fetched full descriptions for {status.enriched} of {status.enrich_total} job
        {status.enrich_total === 1 ? '' : 's'}.
      </p>
    )
  }
  return (
    <p className="search-log-step-summary">
      Rated {status.scored} of {status.score_total} job{status.score_total === 1 ? '' : 's'} for fit.
    </p>
  )
}

/** Accumulating step-by-step log of a search run. Earlier stages stay
 * visible with their frozen final summary once the run moves on to the
 * next one, instead of being replaced by a single current-stage view --
 * used both mid-run (as steps complete one at a time) and on the final
 * overview (all steps shown as done). */
function SearchLog({ status }: { status: SearchStatus }) {
  const currentIdx =
    status.stage && status.stage !== 'done'
      ? STAGE_ORDER.indexOf(status.stage as (typeof STAGE_ORDER)[number])
      : STAGE_ORDER.length - 1
  const erroredIdx = status.error ? currentIdx : -1
  const lastVisible = status.error ? Math.max(currentIdx, 0) : status.running ? currentIdx : STAGE_ORDER.length - 1

  return (
    <div className="search-log">
      {STAGE_ORDER.map((s, i) => {
        if (i > lastVisible) return null
        const isCurrent = status.running && i === currentIdx
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
                Step {i + 1}: {STAGE_STEP_TITLES[s]}
              </span>
            </div>
            <div className="search-log-step-body">
              {isCurrent ? renderStageDetail(status, false) : stageDoneSummary(s, status)}
              {isErrored && <p className="search-result search-error">{status.error}</p>}
            </div>
          </div>
        )
      })}
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

const TIME_RANGES: { label: string; hours: number }[] = [
  { label: 'Past 24 hours', hours: 24 },
  { label: 'Past week', hours: 168 },
  { label: 'Past month', hours: 720 },
]

type ConfirmState = 'pending' | 'confirmed' | 'discarded'

export function SearchPanel() {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [config, setConfig] = useState<SearchConfig>(EMPTY_CONFIG)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [excludeTitlesText, setExcludeTitlesText] = useState('')
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
  const [confirmState, setConfirmState] = useState<ConfirmState>('pending')
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

  useEffect(() => {
    if (!open || configLoaded) return
    getSearchConfig()
      .then((cfg) => {
        setConfig(cfg)
        setExcludeTitlesText(cfg.exclude_titles.join('\n'))
      })
      .catch(() => setConfigError('Could not load search config'))
      .finally(() => setConfigLoaded(true))
  }, [open, configLoaded])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(async () => {
      try {
        const s = await getSearchStatus()
        setStatus(s)
        setStage(s.stage)
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
  }, [running])

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

  function toggleBoard(board: string) {
    setConfig((c) => ({
      ...c,
      boards: c.boards.includes(board) ? c.boards.filter((b) => b !== board) : [...c.boards, board],
    }))
  }

  async function handleSave(andSearch: boolean) {
    setConfigMessage(null)
    setConfigError(null)
    setSaving(true)
    try {
      const excludeTitles = excludeTitlesText
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean)
      const saved = await saveSearchConfig({ ...config, exclude_titles: excludeTitles })
      setConfig(saved)

      if (andSearch) {
        const s = await runSearch()
        setStatus(s)
        setRunning(true)
        setStage(s.stage ?? 'discover')
        setResult(null)
        setError(null)
        setConfirmState('pending')
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

  async function handleConfirm() {
    setConfirmBusy(true)
    try {
      await confirmSearchResults()
      setConfirmState('confirmed')
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : 'Could not confirm results')
    } finally {
      setConfirmBusy(false)
    }
  }

  async function handleDiscard() {
    const count = status?.new ?? 0
    if (!window.confirm(`Discard ${count} newly found job${count === 1 ? '' : 's'}? This can't be undone.`)) {
      return
    }
    setConfirmBusy(true)
    try {
      await discardNewSearchResults()
      setConfirmState('discarded')
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : 'Could not discard results')
    } finally {
      setConfirmBusy(false)
    }
  }

  function handleNewSearch() {
    setResult(null)
    setError(null)
    setConfirmState('pending')
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
              <span className="search-minimized-detail">{renderStageDetail(status, true)}</span>
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
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
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
                    setOpen(false)
                    setMinimized(false)
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
                  {status.new > 0 && confirmState === 'pending' && (
                    <div className="search-overview-actions">
                      <button
                        type="button"
                        className="search-discard-btn"
                        disabled={confirmBusy}
                        onClick={handleDiscard}
                      >
                        Discard {status.new} new job{status.new === 1 ? '' : 's'}
                      </button>
                      <button type="button" disabled={confirmBusy} onClick={handleConfirm}>
                        {confirmBusy ? 'Saving…' : 'Confirm & keep'}
                      </button>
                    </div>
                  )}
                  {confirmState === 'confirmed' && (
                    <p className="search-result">Kept — new jobs are in your dashboard.</p>
                  )}
                  {confirmState === 'discarded' && (
                    <p className="search-result">Discarded — new jobs from this run were removed.</p>
                  )}
                  {status.new === 0 && confirmState === 'pending' && (
                    <p className="search-result">No new jobs found this run.</p>
                  )}
                  {configError && <span className="search-result search-error">{configError}</span>}
                  <WarningsSummary warnings={status.warnings} />
                  <div className="config-actions">
                    <button type="button" onClick={handleNewSearch}>
                      New search
                    </button>
                  </div>
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

                  <div className="config-section">
                    <h3>Job boards</h3>
                    <div className="site-checks">
                      {SEARCHABLE_SITES.map((site) => (
                        <label key={site} className="toggle-check">
                          <input
                            type="checkbox"
                            checked={config.boards.includes(site)}
                            onChange={() => toggleBoard(site)}
                          />
                          {SITE_META[site].label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="config-section">
                    <h3>Exclude titles</h3>
                    <textarea
                      placeholder="One term per line, e.g. senior director"
                      rows={3}
                      value={excludeTitlesText}
                      onChange={(e) => setExcludeTitlesText(e.target.value)}
                    />
                  </div>

                  <div className="config-section">
                    <h3>Defaults</h3>
                    <div className="config-row">
                      <label className="field-label">
                        Results per board
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={config.defaults.results_per_site}
                          onChange={(e) =>
                            setConfig((c) => ({
                              ...c,
                              defaults: { ...c.defaults, results_per_site: Number(e.target.value) },
                            }))
                          }
                        />
                      </label>
                      <label className="field-label">
                        Posted within
                        <select
                          value={config.defaults.hours_old}
                          onChange={(e) =>
                            setConfig((c) => ({
                              ...c,
                              defaults: { ...c.defaults, hours_old: Number(e.target.value) },
                            }))
                          }
                        >
                          {TIME_RANGES.map((r) => (
                            <option key={r.hours} value={r.hours}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
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
