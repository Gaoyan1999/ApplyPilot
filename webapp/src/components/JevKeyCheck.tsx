import { useEffect, useState, type ReactNode } from 'react'
import { ApiError, getJevKey, saveJevKey, testJevConnection, type ConnectionTestResult, type JevKeyConfig } from '../api/client'
import { CheckItem, type CheckState } from './CheckItem'

/** Readiness row for TYPESAFE_API_KEY (the jev apply engine): live test, and
 * an editor that shows a saved key only as a mask. */
export function JevKeyCheck({ configured, onSaved }: { configured: boolean; onSaved: () => void }) {
  const [saved, setSaved] = useState<JevKeyConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<ConnectionTestResult | null>(null)

  useEffect(() => {
    getJevKey()
      .then(setSaved)
      .catch(() => setSaved({ has_api_key: false, api_key_masked: '' }))
  }, [])

  async function runTest() {
    setTesting(true)
    setTest(null)
    try {
      setTest(await testJevConnection())
    } catch (e) {
      setTest({ ok: false, model: null, latency_ms: null, error: e instanceof ApiError ? e.message : 'Test request failed' })
    } finally {
      setTesting(false)
    }
  }

  async function save(key: string) {
    setSaving(true)
    setSaveError(null)
    try {
      setSaved(await saveJevKey(key))
      close()
      onSaved()
      if (key) await runTest()
      else setTest(null)
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function close() {
    setApiKey('')
    setReplacing(false)
    setSaveError(null)
    setOpen(false)
  }

  let state: CheckState = configured ? 'ok' : 'warn'
  let hint: ReactNode = configured
    ? 'Fast form-filling engine, tried first on every auto-apply.'
    : 'Optional, but much faster. Get a key from TypeSafe (typesafe.ai). Without it, auto-apply uses Claude Code.'
  if (testing) {
    state = 'pending'
    hint = 'Sending a test request to TypeSafe…'
  } else if (test) {
    state = test.ok ? 'ok' : 'error'
    hint = test.ok ? `Connected to ${test.model} in ${test.latency_ms} ms.` : test.error ?? 'Connection failed.'
  }

  const showMask = saved?.has_api_key && !replacing

  return (
    <li className="check-item-group">
      <ul className="check-list-inner">
        <CheckItem
          label="Jev API key"
          hint={hint}
          state={state}
          actions={
            <>
              {configured && (
                <button type="button" className="ctx-btn" disabled={testing} onClick={runTest}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
              )}
              {!open && (
                <button type="button" className="ctx-btn ghost" onClick={() => setOpen(true)}>
                  {configured ? 'Edit' : 'Add key'}
                </button>
              )}
            </>
          }
        />
      </ul>

      {open && (
        <div className="llm-form check-item-form">
          <div className="ctx-field">
            <label className="ctx-field-label" htmlFor="jev-api-key">TYPESAFE_API_KEY</label>
            {showMask ? (
              <div className="ctx-inline-field">
                <input id="jev-api-key" type="text" className="ctx-input ctx-input-masked" value={saved.api_key_masked} disabled />
                <button type="button" className="ctx-btn" onClick={() => setReplacing(true)}>
                  Replace
                </button>
              </div>
            ) : (
              <input
                id="jev-api-key"
                type="password"
                className="ctx-input"
                placeholder="TypeSafe API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                autoFocus
              />
            )}
          </div>
          <p className="ctx-hint">Saved to ~/.applypilot/.env.</p>
          {saveError && <p className="search-result search-error">{saveError}</p>}
          <div className="ctx-actions">
            {saved?.has_api_key && (
              <button type="button" className="ctx-btn ghost" disabled={saving} onClick={() => save('')}>
                Remove key
              </button>
            )}
            <span className="ctx-actions-spacer" />
            <button type="button" className="ctx-btn ghost" disabled={saving} onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="ctx-btn primary"
              disabled={saving || showMask || !apiKey.trim()}
              onClick={() => save(apiKey.trim())}
            >
              {saving ? 'Saving…' : 'Save & test'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
