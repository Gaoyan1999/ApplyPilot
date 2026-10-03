import { useEffect, useState } from 'react'
import { ApiError, getPrompts, savePrompts } from '../api/client'

type PromptKey = 'cover_letter' | 'scoring' | 'tailoring'

const PROMPTS: { key: PromptKey; label: string; description: string }[] = [
  {
    key: 'cover_letter',
    label: 'Cover Letter',
    description: 'Structure and voice for the four paragraphs (Intro, Why This Company, Why You, Closing). Banned words, the anti-fabrication guardrails, and sign-off format are always enforced by the code, regardless of what you write here.',
  },
  {
    key: 'scoring',
    label: 'Scoring',
    description: 'The rubric (1-10 score bands, what factors matter) used to rate how well each job matches your resume. The exact response format the app parses is always enforced by the code.',
  },
  {
    key: 'tailoring',
    label: 'Tailoring',
    description: 'Recruiter-scan framing, tailoring rules, and voice guidance for rewriting your resume per job. Skills boundaries, banned words, hard fabrication rules, and the JSON output format are always enforced by the code.',
  },
]

const EMPTY: Record<PromptKey, string> = { cover_letter: '', scoring: '', tailoring: '' }

/** Editor for the three AI prompts in ~/.applypilot/prompts/*.md. All three
 * are saved together (PUT /api/prompts takes the full set). */
export function PromptsEditor() {
  const [active, setActive] = useState<PromptKey>('cover_letter')
  const [texts, setTexts] = useState(EMPTY)
  const [defaults, setDefaults] = useState(EMPTY)
  const [savedTexts, setSavedTexts] = useState(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    getPrompts()
      .then((cfg) => {
        const loaded = { cover_letter: cfg.cover_letter.text, scoring: cfg.scoring.text, tailoring: cfg.tailoring.text }
        setTexts(loaded)
        setSavedTexts(loaded)
        setDefaults({ cover_letter: cfg.cover_letter.default, scoring: cfg.scoring.default, tailoring: cfg.tailoring.default })
        setLoaded(true)
      })
      .catch(() => setLoadError('Could not load prompts'))
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaveMessage(null)
    setSaveError(null)
    try {
      const saved = await savePrompts(texts)
      const next = { cover_letter: saved.cover_letter.text, scoring: saved.scoring.text, tailoring: saved.tailoring.text }
      setTexts(next)
      setSavedTexts(next)
      setSaveMessage('Saved')
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Failed to save prompts')
    } finally {
      setSaving(false)
    }
  }

  const prompt = PROMPTS.find((p) => p.key === active)!

  if (loadError) return <p className="search-result search-error">{loadError}</p>
  if (!loaded) return <p className="search-result">Loading…</p>

  const dirty = (Object.keys(texts) as PromptKey[]).some((k) => texts[k] !== savedTexts[k])

  return (
    <div className="ctx-editor-wrap">
      <div className="ctx-segmented" role="tablist">
        {PROMPTS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={active === p.key}
            className={`ctx-segment${active === p.key ? ' active' : ''}`}
            onClick={() => setActive(p.key)}
          >
            {p.label}
            {texts[p.key] !== defaults[p.key] && <span className="ctx-segment-badge">Custom</span>}
          </button>
        ))}
      </div>
      <p className="ctx-hint">{prompt.description}</p>
      <textarea
        className="ctx-editor"
        value={texts[active]}
        onChange={(e) => {
          setTexts((t) => ({ ...t, [active]: e.target.value }))
          setSaveMessage(null)
        }}
        spellCheck={false}
        aria-label={`${prompt.label} prompt`}
      />
      {saveError && <p className="search-result search-error">{saveError}</p>}
      <div className="ctx-actions">
        <span className="ctx-file-path">~/.applypilot/prompts/{active}.md</span>
        {dirty ? <span className="ctx-dirty">Unsaved changes</span> : saveMessage && <span className="ctx-saved">{saveMessage}</span>}
        <span className="ctx-actions-spacer" />
        <button
          type="button"
          className="ctx-btn ghost"
          disabled={saving || texts[active] === defaults[active]}
          onClick={() => setTexts((t) => ({ ...t, [active]: defaults[active] }))}
        >
          Reset to default
        </button>
        <button type="button" className="ctx-btn primary" disabled={saving || !dirty} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
