import { useEffect, useState } from 'react'
import { ApiError, getSearchForm, getSearchStatus, runSearch } from '../api/client'
import type { SearchForm, SearchRunStage } from '../api/types'
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

const EMPTY_FORM: SearchForm = {
  query: '',
  location: '',
  remote: false,
  sites: ['indeed', 'linkedin'],
  hours_old: 168,
}

const TIME_RANGES: { label: string; hours: number }[] = [
  { label: 'Past 24 hours', hours: 24 },
  { label: 'Past week', hours: 168 },
  { label: 'Past month', hours: 720 },
]

export function SearchPanel() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<SearchForm>(EMPTY_FORM)
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState<SearchRunStage>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSearchForm().then((f) => setForm({ ...EMPTY_FORM, ...f })).catch(() => {})
    getSearchStatus().then((status) => {
      if (status.running) {
        setRunning(true)
        setStage(status.stage)
      }
    }).catch(() => {})
  }, [])

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
              `${status.found} new job${status.found === 1 ? '' : 's'} found, ` +
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

  function toggleSite(site: string) {
    setForm((f) => ({
      ...f,
      sites: f.sites.includes(site) ? f.sites.filter((s) => s !== site) : [...f.sites, site],
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setResult(null)
    setError(null)
    try {
      const status = await runSearch(form)
      setRunning(true)
      setStage(status.stage ?? 'discover')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setRunning(true)
      } else {
        setError(e instanceof Error ? e.message : 'Search failed to start')
      }
    }
  }

  return (
    <>
      <button type="button" className="search-trigger" onClick={() => setOpen(true)}>
        {running ? stageLabel(stage) : 'Search'}
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Search for jobs</h2>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <form className="search-panel" onSubmit={handleSubmit}>
              <input
                type="text"
                placeholder="Job title or keywords"
                value={form.query}
                onChange={(e) => setForm((f) => ({ ...f, query: e.target.value }))}
                required
              />
              <input
                type="text"
                placeholder="Location"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                required
              />
              <select
                value={form.hours_old}
                onChange={(e) => setForm((f) => ({ ...f, hours_old: Number(e.target.value) }))}
              >
                {TIME_RANGES.map((r) => (
                  <option key={r.hours} value={r.hours}>
                    {r.label}
                  </option>
                ))}
              </select>
              <label className="toggle-check">
                <input
                  type="checkbox"
                  checked={form.remote}
                  onChange={(e) => setForm((f) => ({ ...f, remote: e.target.checked }))}
                />
                Remote
              </label>
              <div className="site-checks">
                {SEARCHABLE_SITES.map((site) => (
                  <label key={site} className="toggle-check">
                    <input
                      type="checkbox"
                      checked={form.sites.includes(site)}
                      onChange={() => toggleSite(site)}
                    />
                    {SITE_META[site].label}
                  </label>
                ))}
              </div>
              <button type="submit" disabled={running || form.sites.length === 0}>
                {running ? stageLabel(stage) : 'Search'}
              </button>
              {result && <span className="search-result">{result}</span>}
              {error && <span className="search-result search-error">{error}</span>}
            </form>
          </div>
        </div>
      )}
    </>
  )
}
