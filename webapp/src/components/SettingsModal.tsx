import { useEffect, useState } from 'react'
import { ApiError, getPrompts, savePrompts } from '../api/client'
import type { Theme } from '../hooks/useTheme'
import { ThemeToggle } from './ThemeToggle'

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1" />
    </svg>
  )
}

interface PromptFieldProps {
  label: string
  description: string
  value: string
  onChange: (value: string) => void
  onReset: () => void
  resetDisabled: boolean
}

function PromptField({ label, description, value, onChange, onReset, resetDisabled }: PromptFieldProps) {
  return (
    <div className="prompt-field">
      <label>{label}</label>
      <p className="prompt-field-description">{description}</p>
      <textarea
        rows={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      <div className="prompt-field-footer">
        <button type="button" className="reset-btn" disabled={resetDisabled} onClick={onReset}>
          Reset to default
        </button>
      </div>
    </div>
  )
}

interface Props {
  theme: Theme
  onToggleTheme: () => void
}

const EMPTY_DEFAULTS = { cover_letter: '', tailoring: '', scoring: '' }

type SettingsTab = 'appearance' | 'prompts'

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'appearance', label: 'Appearance' },
  { key: 'prompts', label: 'Prompts' },
]

export function SettingsModal({ theme, onToggleTheme }: Props) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')

  const [promptsLoaded, setPromptsLoaded] = useState(false)
  const [promptsLoadError, setPromptsLoadError] = useState<string | null>(null)
  const [defaults, setDefaults] = useState(EMPTY_DEFAULTS)
  const [coverLetterText, setCoverLetterText] = useState('')
  const [tailoringText, setTailoringText] = useState('')
  const [scoringText, setScoringText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!open || promptsLoaded) return
    getPrompts()
      .then((cfg) => {
        setCoverLetterText(cfg.cover_letter.text)
        setTailoringText(cfg.tailoring.text)
        setScoringText(cfg.scoring.text)
        setDefaults({
          cover_letter: cfg.cover_letter.default,
          tailoring: cfg.tailoring.default,
          scoring: cfg.scoring.default,
        })
      })
      .catch(() => setPromptsLoadError('Could not load prompts'))
      .finally(() => setPromptsLoaded(true))
  }, [open, promptsLoaded])

  async function handleSavePrompts() {
    setSaving(true)
    setSaveMessage(null)
    setSaveError(null)
    try {
      const saved = await savePrompts({
        cover_letter: coverLetterText,
        tailoring: tailoringText,
        scoring: scoringText,
      })
      setCoverLetterText(saved.cover_letter.text)
      setTailoringText(saved.tailoring.text)
      setScoringText(saved.scoring.text)
      setSaveMessage('Prompts saved')
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Failed to save prompts')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="settings-trigger"
        onClick={() => setOpen(true)}
        title="Settings"
        aria-label="Settings"
      >
        <SettingsIcon />
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Settings</h2>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="settings-panel">
              <nav className="settings-sidebar">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`settings-nav-item${activeTab === tab.key ? ' active' : ''}`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>

              <div className="settings-content">
                {activeTab === 'appearance' && (
                  <>
                    <h3 className="settings-content-title">Appearance</h3>
                    <div className="config-row">
                      <span className="field-label-inline">Theme</span>
                      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
                    </div>
                  </>
                )}

                {activeTab === 'prompts' && (
                  <>
                    <h3 className="settings-content-title">Prompts</h3>
                    {promptsLoadError && <p className="search-result search-error">{promptsLoadError}</p>}
                    {!promptsLoaded && !promptsLoadError && <p className="search-result">Loading…</p>}
                    {promptsLoaded && (
                      <>
                        <PromptField
                          label="Cover Letter"
                          description="Structure and voice for the four paragraphs (Intro, Why This Company, Why You, Closing). Banned words, the anti-fabrication guardrails, and sign-off format are always enforced by the code, regardless of what you write here."
                          value={coverLetterText}
                          onChange={setCoverLetterText}
                          onReset={() => setCoverLetterText(defaults.cover_letter)}
                          resetDisabled={saving}
                        />
                        <PromptField
                          label="Resume Tailoring"
                          description="Recruiter-scan framing, tailoring rules, and voice guidance for rewriting your resume per job. Skills boundaries, banned words, hard fabrication rules, and the JSON output format are always enforced by the code."
                          value={tailoringText}
                          onChange={setTailoringText}
                          onReset={() => setTailoringText(defaults.tailoring)}
                          resetDisabled={saving}
                        />
                        <PromptField
                          label="Job Scoring"
                          description="The rubric (1-10 score bands, what factors matter) used to rate how well each job matches your resume. The exact response format the app parses is always enforced by the code."
                          value={scoringText}
                          onChange={setScoringText}
                          onReset={() => setScoringText(defaults.scoring)}
                          resetDisabled={saving}
                        />
                        <div className="config-actions">
                          <button type="button" disabled={saving} onClick={handleSavePrompts}>
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                        {saveMessage && <span className="search-result">{saveMessage}</span>}
                        {saveError && <span className="search-result search-error">{saveError}</span>}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
