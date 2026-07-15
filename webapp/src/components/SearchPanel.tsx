import { useEffect, useState } from 'react'
import { ApiError, getSearchConfig, getSearchStatus, runSearch, saveSearchConfig } from '../api/client'
import type { SearchConfig, SearchRunStage } from '../api/types'
import { SEARCHABLE_SITES, SITE_META } from './SiteIcon'

const STAGE_LABELS: Record<Exclude<SearchRunStage, null>, string> = {
  discover: 'Searching…',
  enrich: 'Fetching details…',
  score: 'Rating fit…',
  done: 'Done',
}

function stageLabel(stage: SearchRunStage): string {
  return stage ? STAGE_LABELS[stage] : 'Searching…'
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

export function SearchPanel() {
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<SearchConfig>(EMPTY_CONFIG)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [excludeTitlesText, setExcludeTitlesText] = useState('')
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [stage, setStage] = useState<SearchRunStage>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSearchStatus().then((status) => {
      if (status.running) {
        setRunning(true)
        setStage(status.stage)
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
      .catch(() => setError('Could not load search config'))
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
        const status = await getSearchStatus()
        setStage(status.stage)
        if (!status.running) {
          setRunning(false)
          if (status.error) {
            setResult(null)
            const where = status.error_stage ? ` during ${status.error_stage}` : ''
            setError(`${status.error}${where}`)
          } else {
            setResult(
              `${status.queries} quer${status.queries === 1 ? 'y' : 'ies'} run, ` +
                `${status.new} new job${status.new === 1 ? '' : 's'} found, ` +
                `${status.enriched} enriched, ${status.scored} rated`
            )
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
    setResult(null)
    setError(null)
    setSaving(true)
    try {
      const excludeTitles = excludeTitlesText
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean)
      const saved = await saveSearchConfig({ ...config, exclude_titles: excludeTitles })
      setConfig(saved)

      if (andSearch) {
        const status = await runSearch()
        setRunning(true)
        setStage(status.stage ?? 'discover')
      } else {
        setResult('Search config saved')
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setRunning(true)
      } else {
        setError(e instanceof Error ? e.message : 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  const busy = running || saving

  return (
    <>
      <button type="button" className="search-trigger" onClick={() => setOpen(true)}>
        {running ? stageLabel(stage) : 'Search'}
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Search config</h2>
                <p className="modal-subtitle">
                  Edits ~/.applypilot/searches.yaml — also used by <code>applypilot run discover</code>.
                </p>
              </div>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="search-panel">
              <div className="config-section">
                <h3>Search queries</h3>
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
                  {running ? stageLabel(stage) : 'Save & Search'}
                </button>
              </div>
              {result && <span className="search-result">{result}</span>}
              {error && <span className="search-result search-error">{error}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
