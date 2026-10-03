import { useEffect, useState } from 'react'
import { ApiError, getEnvConfig, saveEnvConfig, testLlmConnection, type LlmEnvConfig, type ConnectionTestResult } from '../api/client'
import { CheckItem, type CheckState } from './CheckItem'

/** LLM_URL / LLM_API_KEY / LLM_MODEL in ~/.applypilot/.env -- any
 * OpenAI-compatible endpoint (Gemini, OpenAI, Qwen, Ollama, ...). */
export function LlmProviderForm({ configured, onSaved }: { configured: boolean; onSaved: () => void }) {
  const [saved, setSaved] = useState<LlmEnvConfig | null>(null)
  const [open, setOpen] = useState(!configured)
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  // A saved key shows as a disabled mask until the user chooses to replace it.
  const [replacingKey, setReplacingKey] = useState(false)
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<ConnectionTestResult | null>(null)

  function loadSaved() {
    getEnvConfig()
      .then((cfg) => {
        setSaved(cfg)
        setUrl(cfg.url)
        setModel(cfg.model)
        setApiKey('')
        setReplacingKey(false)
      })
      .catch(() => setSaved({ url: '', model: '', has_api_key: false, api_key_masked: '' }))
  }

  useEffect(() => {
    loadSaved()
  }, [])

  async function runTest() {
    setTesting(true)
    setTest(null)
    try {
      setTest(await testLlmConnection())
    } catch (e) {
      setTest({ ok: false, model: null, latency_ms: null, error: e instanceof ApiError ? e.message : 'Test request failed' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await saveEnvConfig({ url, model, api_key: apiKey })
      setOpen(false)
      loadSaved()
      onSaved()
      await runTest()
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    if (saved) {
      setUrl(saved.url)
      setModel(saved.model)
    }
    setApiKey('')
    setReplacingKey(false)
    setSaveError(null)
    setOpen(false)
  }

  let state: CheckState = configured ? 'ok' : 'warn'
  let hint = configured && saved?.model
    ? `${saved.model} · ${saved.url}`
    : 'Required for scoring, tailoring, cover letters, and filling your profile from a CV.'
  if (testing) {
    state = 'pending'
    hint = 'Sending a test prompt…'
  } else if (test) {
    state = test.ok ? 'ok' : 'error'
    hint = test.ok ? `Connected to ${test.model} in ${test.latency_ms} ms.` : test.error ?? 'Connection failed.'
  }

  return (
    <>
      <ul className="check-list">
        <CheckItem
          label="LLM provider"
          hint={hint}
          state={state}
          actions={
            <>
              {configured && (
                <button type="button" className="ctx-btn" disabled={testing} onClick={runTest}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
              )}
              {configured && !open && (
                <button type="button" className="ctx-btn ghost" onClick={() => setOpen(true)}>
                  Edit
                </button>
              )}
            </>
          }
        />
      </ul>

      {open && (
        <div className="llm-form">
          <label className="ctx-field">
            <span className="ctx-field-label">LLM_URL</span>
            <input
              type="text"
              className="ctx-input"
              placeholder="https://api.openai.com/v1"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <div className="ctx-field">
            <label className="ctx-field-label" htmlFor="llm-api-key">LLM_API_KEY</label>
            {saved?.has_api_key && !replacingKey ? (
              <div className="ctx-inline-field">
                <input id="llm-api-key" type="text" className="ctx-input ctx-input-masked" value={saved.api_key_masked} disabled />
                <button type="button" className="ctx-btn" onClick={() => setReplacingKey(true)}>
                  Replace
                </button>
              </div>
            ) : (
              <input
                id="llm-api-key"
                type="password"
                className="ctx-input"
                placeholder="API key (blank for local models)"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                autoFocus={replacingKey}
              />
            )}
          </div>
          <label className="ctx-field">
            <span className="ctx-field-label">LLM_MODEL</span>
            <input
              type="text"
              className="ctx-input"
              placeholder="e.g. gpt-4o-mini, qwen-plus, gemini-2.0-flash"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <p className="ctx-hint">Any OpenAI-compatible endpoint works. Saved to ~/.applypilot/.env.</p>
          {saveError && <p className="search-result search-error">{saveError}</p>}
          <div className="ctx-actions">
            <span className="ctx-actions-spacer" />
            {configured && (
              <button type="button" className="ctx-btn ghost" disabled={saving} onClick={cancel}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="ctx-btn primary"
              disabled={saving || !url.trim() || !model.trim()}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : 'Save & test'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
