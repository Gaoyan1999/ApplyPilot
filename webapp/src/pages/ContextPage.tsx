import { useEffect, useState } from 'react'
import {
  ApiError,
  extractProfile,
  getContextStatus,
  getProfileMarkdown,
  getSearchConfig,
  saveKnowledgeBaseDir,
  saveProfileMarkdown,
  saveSearchConfig,
  suggestSearchConfig,
} from '../api/client'
import type { ContextStatus } from '../api/types'
import { CvLibrary } from '../components/CvLibrary'
import { PromptsEditor } from '../components/PromptsEditor'
import { TopBar } from '../components/TopBar'
import { useLocalStorageState } from '../hooks/useLocalStorageState'
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

/** First CV only: AI fills Profile.md and search queries from it. Search
 * suggestion is best-effort -- the upload and profile fill already succeeded. */
async function onboardFromFirstCv() {
  await extractProfile()
  try {
    const current = await getSearchConfig()
    const suggestion = await suggestSearchConfig()
    if (suggestion.queries.length > 0) {
      await saveSearchConfig({ ...current, queries: suggestion.queries, exclude_titles: suggestion.exclude_titles })
    }
  } catch {
    // ignore
  }
}

/** Raw editor for ~/.applypilot/profile.md. Remounted (via `key`) after an
 * AI extraction rewrites the file, so it never shows stale text. */
function ProfileEditor({ hasCv, onSaved, onExtracted }: { hasCv: boolean; onSaved: () => void; onExtracted: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [savedText, setSavedText] = useState('')
  const [path, setPath] = useState('~/.applypilot/profile.md')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const save = useAsyncAction()
  const extract = useAsyncAction()

  useEffect(() => {
    getProfileMarkdown()
      .then((p) => {
        setText(p.text)
        // A starter skeleton isn't saved yet -- leave Save enabled for it.
        setSavedText(p.exists ? p.text : '')
        setPath(p.path)
      })
      .catch(() => setLoadError('Could not load Profile.md'))
  }, [])

  if (loadError) return <p className="search-result search-error">{loadError}</p>
  if (text === null) return <p className="search-result">Loading…</p>

  const dirty = text !== savedText

  return (
    <div className="ctx-editor-wrap">
      <textarea
        className="ctx-editor ctx-editor-tall"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setMessage(null)
        }}
        spellCheck={false}
        aria-label="Profile.md"
      />
      {save.error && <p className="search-result search-error">{save.error}</p>}
      {extract.error && <p className="search-result search-error">{extract.error}</p>}
      <div className="ctx-actions">
        <span className="ctx-file-path" title={path}>{path}</span>
        {dirty ? <span className="ctx-dirty">Unsaved changes</span> : message && <span className="ctx-saved">{message}</span>}
        <span className="ctx-actions-spacer" />
        {hasCv && (
          <button
            type="button"
            className="ctx-btn"
            disabled={extract.busy || dirty}
            title={dirty ? 'Save or undo your edits first' : 'Refill basic info and skills from your primary CV. Your summary, visa and salary fields are kept.'}
            onClick={() => extract.run(async () => { await extractProfile(); onExtracted() })}
          >
            {extract.busy ? 'Filling…' : 'Refill from CV with AI'}
          </button>
        )}
        <button
          type="button"
          className="ctx-btn primary"
          disabled={!dirty || save.busy}
          onClick={() =>
            save.run(async () => {
              const saved = await saveProfileMarkdown(text)
              setText(saved.text)
              setSavedText(saved.text)
              setMessage('Saved')
              onSaved()
            })
          }
        >
          {save.busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function KnowledgeBaseForm({ status, onSaved }: { status: ContextStatus['knowledge_base']; onSaved: () => void }) {
  const [dir, setDir] = useState(status.dir ?? '')
  const { busy, error, run } = useAsyncAction()

  return (
    <div className="context-form">
      <label className="ctx-field-label" htmlFor="kb-dir">Folder path</label>
      <div className="ctx-inline-field">
        <input
          id="kb-dir"
          type="text"
          className="ctx-input"
          placeholder="/Users/you/Notes/Career"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
        />
        <button
          type="button"
          className="ctx-btn primary"
          disabled={busy || dir === (status.dir ?? '')}
          onClick={() => run(async () => { await saveKnowledgeBaseDir(dir); onSaved() })}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <p className="search-result search-error">{error}</p>}
      {status.dir && (
        <div className="ctx-stat-row">
          <span className="ctx-stat"><strong>{status.folder_count}</strong> folder(s) with an index.md</span>
          {status.empty_folders.length > 0 && (
            <span className="ctx-stat warn">No content yet: {status.empty_folders.join(', ')}</span>
          )}
        </div>
      )}
    </div>
  )
}

type SectionKey = 'prompts' | 'profile' | 'cv' | 'kb'
type SectionState = 'ok' | 'warn' | 'none'

const SECTIONS: { key: SectionKey; label: string; title: string; description: string }[] = [
  {
    key: 'prompts',
    label: 'Prompts',
    title: 'Prompts',
    description: 'How the AI writes cover letters, scores jobs, and tailors your resume.',
  },
  {
    key: 'profile',
    label: 'Profile',
    title: 'Profile.md',
    description:
      'A high-level summary of you. The --- block at the top holds basic info that forms are filled from (name, address, title, visa, salary). Below it, write a few lines about who you are and what you want. Detailed work history belongs in your CV and knowledge base.',
  },
  {
    key: 'cv',
    label: 'CV',
    title: 'CV',
    description: 'Master resumes you maintain yourself. The primary CV is the base resume for scoring, tailoring, and cover letters. When auto-submitting a job with no tailored resume, the best-matching CV here is used as-is.',
  },
  {
    key: 'kb',
    label: 'Knowledge base',
    title: 'Knowledge base',
    description:
      "A folder of Markdown notes (e.g. an Obsidian vault) with the detail your CV is too short for: projects, courses, prepared answers. Each subfolder's index.md is read as a summary of that folder.",
  },
]

function sectionState(key: SectionKey, status: ContextStatus): SectionState {
  switch (key) {
    case 'prompts':
      return 'none'
    case 'profile':
      return status.profile.has_name && status.profile.work_authorization_set ? 'ok' : 'warn'
    case 'cv':
      return status.cv.primary_cv && status.cv.resume_text_chars > 0 ? 'ok' : 'warn'
    case 'kb':
      if (!status.knowledge_base.dir) return 'none'
      return status.knowledge_base.empty_folders.length > 0 ? 'warn' : 'ok'
  }
}

export function ContextPage() {
  const { theme, toggleTheme } = useTheme()
  const [status, setStatus] = useState<ContextStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Bumped whenever profile.md is rewritten outside the editor (AI extraction).
  const [profileVersion, setProfileVersion] = useState(0)
  const [active, setActive] = useLocalStorageState<SectionKey>('applypilot-context-section', 'prompts')

  function refresh() {
    getContextStatus()
      .then(setStatus)
      .catch(() => setLoadError('Could not load context status'))
  }

  function onProfileRewritten() {
    setProfileVersion((v) => v + 1)
    refresh()
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
      <TopBar theme={theme} onToggleTheme={toggleTheme} />
      <div className="app-container">
      <div className="app-header">
        <h1>Context</h1>
      </div>
      <p className="subtitle">
        Everything the AI uses about you: how it writes, who you are, and the detail behind it.
      </p>

      <div className="ctx-layout">
        <nav className="ctx-nav" aria-label="Context sections">
          {SECTIONS.map((sec, i) => {
            const state = sectionState(sec.key, status)
            return (
              <button
                key={sec.key}
                type="button"
                className={`ctx-nav-item${active === sec.key ? ' active' : ''}`}
                aria-current={active === sec.key ? 'page' : undefined}
                onClick={() => setActive(sec.key)}
              >
                <span className="ctx-nav-num">{i + 1}</span>
                <span className="ctx-nav-label">{sec.label}</span>
                {state !== 'none' && (
                  <span className={`ctx-nav-dot ${state}`} title={state === 'ok' ? 'Set up' : 'Needs attention'} />
                )}
              </button>
            )
          })}
        </nav>

        <section className="ctx-panel">
          {SECTIONS.filter((sec) => sec.key === active).map((sec) => (
            <header key={sec.key} className="ctx-panel-header">
              <h2>{sec.title}</h2>
              <p>{sec.description}</p>
            </header>
          ))}

          {active === 'prompts' && <PromptsEditor />}

          {active === 'profile' && (
            <ProfileEditor
              key={profileVersion}
              hasCv={!!status.cv.primary_cv}
              onSaved={refresh}
              onExtracted={onProfileRewritten}
            />
          )}

          {active === 'cv' && (
            <CvLibrary
              onActivity={onProfileRewritten}
              afterUpload={async (isFirst) => {
                if (isFirst) await onboardFromFirstCv()
              }}
            />
          )}

          {active === 'kb' && <KnowledgeBaseForm status={status.knowledge_base} onSaved={refresh} />}
        </section>
      </div>
      </div>
    </>
  )
}
