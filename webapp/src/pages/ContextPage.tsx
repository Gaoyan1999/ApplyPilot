import { useEffect, useState } from 'react'
import {
  ApiError,
  extractProfile,
  getContextStatus,
  getProfile,
  saveEnvConfig,
  saveManualProfile,
  suggestSearchConfig,
  getSearchConfig,
  saveSearchConfig,
  uploadCv,
} from '../api/client'
import type { ContextStatus, LlmProvider, Profile } from '../api/types'
import { SearchPanel } from '../components/SearchPanel'
import { TopBar } from '../components/TopBar'
import { useTheme } from '../hooks/useTheme'

function useAsyncAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function EnvForm({ configured, onSaved }: { configured: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(!configured)
  const [provider, setProvider] = useState<LlmProvider>('gemini')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [url, setUrl] = useState('')
  const { busy, error, run } = useAsyncAction()

  if (!open) {
    return (
      <div className="context-card-row">
        <span className="context-ok">LLM provider configured</span>
        <button type="button" className="cv-set-primary-btn" onClick={() => setOpen(true)}>
          Change
        </button>
      </div>
    )
  }

  return (
    <div className="context-form">
      <div className="config-row">
        <select value={provider} onChange={(e) => setProvider(e.target.value as LlmProvider)}>
          <option value="gemini">Gemini (recommended, free tier)</option>
          <option value="openai">OpenAI</option>
          <option value="local">Local (Ollama / llama.cpp)</option>
        </select>
      </div>
      {provider !== 'local' ? (
        <div className="config-row">
          <input
            type="password"
            placeholder={provider === 'gemini' ? 'Gemini API key (aistudio.google.com)' : 'OpenAI API key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
      ) : (
        <div className="config-row">
          <input
            type="text"
            placeholder="Local LLM endpoint URL (e.g. http://localhost:8080/v1)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      )}
      <div className="config-row">
        <input
          type="text"
          placeholder={`Model (default: ${provider === 'gemini' ? 'gemini-2.0-flash' : provider === 'openai' ? 'gpt-4o-mini' : 'local-model'})`}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </div>
      {error && <p className="search-result search-error">{error}</p>}
      <button
        type="button"
        className="cv-upload-btn"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await saveEnvConfig({ provider, api_key: apiKey, model, url })
            setOpen(false)
            onSaved()
          })
        }
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

function ResumeUpload({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const { busy, error, run } = useAsyncAction()

  return (
    <div className="context-form">
      <p className="prompt-field-description">
        Upload your resume PDF. It becomes your primary CV, and AI pre-fills your profile and
        search queries from it — you'll only need to fill in a few fields AI can't know.
      </p>
      <div className="config-row cv-upload-form">
        <input
          type="text"
          className="cv-name-input"
          placeholder="Name (e.g. Backend Engineer) — defaults to filename"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      {error && <p className="search-result search-error">{error}</p>}
      <button
        type="button"
        className="cv-upload-btn"
        disabled={!file || busy}
        onClick={() =>
          run(async () => {
            if (!file) return
            await uploadCv(file, name.trim())
            await extractProfile()
            try {
              const current = await getSearchConfig()
              const suggestion = await suggestSearchConfig()
              if (suggestion.queries.length > 0) {
                await saveSearchConfig({ ...current, queries: suggestion.queries, exclude_titles: suggestion.exclude_titles })
              }
            } catch {
              // Search suggestion is best-effort -- the CV/profile upload above already succeeded.
            }
            onDone()
          })
        }
      >
        {busy ? 'Uploading…' : 'Upload & extract'}
      </button>
    </div>
  )
}

function ManualFieldsForm({ profile, onSaved }: { profile: Profile | null; onSaved: () => void }) {
  const [authorized, setAuthorized] = useState(profile?.work_authorization.legally_authorized_to_work ?? true)
  const [sponsorship, setSponsorship] = useState(profile?.work_authorization.require_sponsorship ?? false)
  const [permitType, setPermitType] = useState(profile?.work_authorization.work_permit_type ?? '')
  const [salary, setSalary] = useState(profile?.compensation.salary_expectation ?? '')
  const [currency, setCurrency] = useState(profile?.compensation.salary_currency ?? 'USD')
  const [startDate, setStartDate] = useState(profile?.availability.earliest_start_date ?? 'Immediately')
  const [kbDir, setKbDir] = useState(profile?.knowledge_base_dir ?? '')
  const { busy, error, run } = useAsyncAction()

  return (
    <div className="context-form">
      <p className="prompt-field-description">
        Visa status, pay expectations, and availability aren't in your resume — AI can't guess
        these, they're yours to set.
      </p>
      <div className="config-row">
        <label className="toggle-check">
          <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
          Legally authorized to work in your target country
        </label>
      </div>
      <div className="config-row">
        <label className="toggle-check">
          <input type="checkbox" checked={sponsorship} onChange={(e) => setSponsorship(e.target.checked)} />
          Will need visa sponsorship
        </label>
      </div>
      <div className="config-row">
        <input type="text" placeholder="Work permit type (e.g. Citizen, PR — optional)" value={permitType} onChange={(e) => setPermitType(e.target.value)} />
      </div>
      <div className="config-row">
        <input type="text" placeholder="Expected salary" value={salary} onChange={(e) => setSalary(e.target.value)} />
        <input type="text" placeholder="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ maxWidth: 90 }} />
      </div>
      <div className="config-row">
        <input type="text" placeholder="Earliest start date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      <div className="config-row">
        <input type="text" placeholder="Knowledge base folder path (optional)" value={kbDir} onChange={(e) => setKbDir(e.target.value)} />
      </div>
      {error && <p className="search-result search-error">{error}</p>}
      <button
        type="button"
        className="cv-upload-btn"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await saveManualProfile({
              work_authorization: {
                legally_authorized_to_work: authorized,
                require_sponsorship: sponsorship,
                work_permit_type: permitType,
              },
              compensation: {
                salary_expectation: salary,
                salary_currency: currency,
                salary_range_min: profile?.compensation.salary_range_min ?? salary,
                salary_range_max: profile?.compensation.salary_range_max ?? salary,
              },
              availability: { earliest_start_date: startDate },
              knowledge_base_dir: kbDir,
            })
            onSaved()
          })
        }
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

export function ContextPage() {
  const { theme, toggleTheme } = useTheme()
  const [status, setStatus] = useState<ContextStatus | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const extractAction = useAsyncAction()

  function refresh() {
    getContextStatus()
      .then(setStatus)
      .catch(() => setLoadError('Could not load context status'))
    getProfile()
      .then(setProfile)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setProfile(null)
      })
  }

  useEffect(() => {
    refresh()
  }, [])

  if (!status) {
    return (
      <>
        <TopBar theme={theme} onToggleTheme={toggleTheme} />
        <div className="app-container">
          <div className="app-header">
            <h1>Context</h1>
          </div>
          {loadError ? <p className="search-result search-error">{loadError}</p> : <p className="subtitle">Loading…</p>}
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar theme={theme} onToggleTheme={toggleTheme} onCvActivity={refresh} />
      <div className="app-container">
      <div className="app-header">
        <h1>Context</h1>
      </div>
      <p className="subtitle">
        What ApplyPilot currently knows about you — where it comes from, and what's missing.
      </p>

      {status.missing.length > 0 ? (
        <div className="context-card context-gap-card">
          <h3>Needs attention</h3>
          <ul className="context-gap-list">
            {status.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="context-card context-ok-card">
          <span className="context-ok">Everything's set up — Tier {status.tier} ({status.tier_label})</span>
        </div>
      )}

      <div className="context-card">
        <h3>LLM Provider</h3>
        <EnvForm configured={status.env.configured} onSaved={refresh} />
      </div>

      <div className="context-card">
        <h3>Resume / CV</h3>
        {status.cv.primary_cv ? (
          <div className="context-card-row">
            <span>
              Primary: <strong>{status.cv.primary_cv}</strong> — {status.cv.resume_text_chars.toLocaleString()} chars extracted
              {status.cv.resume_text_chars === 0 && <span className="context-warn"> (no text — scanned PDF?)</span>}
            </span>
          </div>
        ) : (
          <ResumeUpload onDone={refresh} />
        )}
        <p className="prompt-field-description">Manage CVs from the library icon in the top bar.</p>
      </div>

      {status.cv.primary_cv && (
        <div className="context-card">
          <h3>Profile (AI-extracted)</h3>
          {profile ? (
            <div className="context-profile-grid">
              <div><span className="context-label">Name</span>{profile.personal.full_name || '—'}</div>
              <div><span className="context-label">Email</span>{profile.personal.email || '—'}</div>
              <div><span className="context-label">Current title</span>{profile.experience.current_title || '—'}</div>
              <div><span className="context-label">Target role</span>{profile.experience.target_role || '—'}</div>
              <div><span className="context-label">Experience</span>{profile.experience.years_of_experience_total || '—'} years</div>
              <div><span className="context-label">Education</span>{profile.experience.education_level || '—'}</div>
              <div className="context-profile-grid-wide">
                <span className="context-label">Skills ({status.profile.skills_count})</span>
                {[...profile.skills_boundary.programming_languages, ...profile.skills_boundary.frameworks, ...profile.skills_boundary.tools].join(', ') || '—'}
              </div>
            </div>
          ) : (
            <p className="prompt-field-description">No profile yet.</p>
          )}
          {extractAction.error && <p className="search-result search-error">{extractAction.error}</p>}
          <button
            type="button"
            className="cv-set-primary-btn"
            disabled={extractAction.busy}
            onClick={() => extractAction.run(async () => { await extractProfile(); refresh() })}
          >
            {extractAction.busy ? 'Extracting…' : 'Re-extract from resume'}
          </button>
        </div>
      )}

      <div className="context-card">
        <h3>Manual settings</h3>
        <ManualFieldsForm profile={profile} onSaved={refresh} />
      </div>

      {status.knowledge_base.dir && (
        <div className="context-card">
          <h3>Knowledge base</h3>
          <p className="context-card-row">{status.knowledge_base.dir} — {status.knowledge_base.folder_count} folder(s)</p>
          {status.knowledge_base.empty_folders.length > 0 && (
            <p className="context-warn">No content yet: {status.knowledge_base.empty_folders.join(', ')}</p>
          )}
        </div>
      )}

      <div className="context-card">
        <h3>Search queries</h3>
        <p className="context-card-row">{status.search.query_count} quer{status.search.query_count === 1 ? 'y' : 'ies'} configured</p>
        <SearchPanel onActivity={refresh} />
      </div>

      <div className="context-card">
        <h3>Auto-apply readiness</h3>
        <ul className="context-gap-list">
          <li className={status.env.configured ? 'context-ok' : 'context-warn'}>LLM API key: {status.env.configured ? 'configured' : 'missing'}</li>
          <li className={status.claude_cli ? 'context-ok' : 'context-warn'}>Claude Code CLI: {status.claude_cli ? 'found' : 'not found — install from claude.ai/code'}</li>
          <li className={status.chrome ? 'context-ok' : 'context-warn'}>Chrome: {status.chrome ? 'found' : 'not found'}</li>
        </ul>
      </div>
      </div>
    </>
  )
}
