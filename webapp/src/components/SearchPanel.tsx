import { useEffect, useState } from 'react'
import { ApiError, getSearchForm, getSearchStatus, runSearch } from '../api/client'
import type { SearchForm } from '../api/types'
import { SEARCHABLE_SITES, SITE_META } from './SiteIcon'

const EMPTY_FORM: SearchForm = { query: '', location: '', remote: false, sites: ['indeed', 'linkedin'] }

export function SearchPanel() {
  const [form, setForm] = useState<SearchForm>(EMPTY_FORM)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSearchForm().then(setForm).catch(() => {})
    getSearchStatus().then((status) => {
      if (status.running) setRunning(true)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(async () => {
      try {
        const status = await getSearchStatus()
        if (!status.running) {
          setRunning(false)
          setResult(status.error ? null : `${status.found} new job${status.found === 1 ? '' : 's'} found`)
          setError(status.error)
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
      await runSearch(form)
      setRunning(true)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setRunning(true)
      } else {
        setError(e instanceof Error ? e.message : 'Search failed to start')
      }
    }
  }

  return (
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
        {running ? 'Searching…' : 'Search'}
      </button>
      {result && <span className="search-result">{result}</span>}
      {error && <span className="search-result search-error">{error}</span>}
    </form>
  )
}
