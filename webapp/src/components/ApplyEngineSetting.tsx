import { useEffect, useState } from 'react'
import { ApiError, getApplyEngine, saveApplyEngine, type ApplyEngineConfig } from '../api/client'

/** One checkbox: on = jev (fast, TypeSafe), off = Claude Code CLI. Saved to
 * ~/.applypilot/.env on every change. */
export function ApplyEngineSetting() {
  const [config, setConfig] = useState<ApplyEngineConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getApplyEngine()
      .then(setConfig)
      .catch(() => setError('Could not load the auto-submit engine'))
  }, [])

  async function toggle() {
    if (!config) return
    const prev = config
    const next: ApplyEngineConfig = { ...config, engine: config.engine === 'jev' ? 'claude' : 'jev' }
    setConfig(next)
    setSaving(true)
    setError(null)
    try {
      setConfig(await saveApplyEngine(next))
    } catch (e) {
      setConfig(prev)
      setError(e instanceof ApiError ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <label className="toggle-check">
        <input type="checkbox" checked={config?.engine === 'jev'} disabled={!config || saving} onChange={toggle} />
        Speed up by jev
      </label>
      {error && <p className="search-result search-error">{error}</p>}
    </>
  )
}
