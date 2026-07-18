import { useEffect, useState } from 'react'
import { ApiError, getPrompts, getSearchConfig, savePrompts, saveSearchConfig } from '../api/client'
import type { SearchConfig } from '../api/types'
import type { Theme } from '../hooks/useTheme'
import { SEARCHABLE_SITES, SITE_META } from './SiteIcon'
import { TIME_RANGES } from './SearchPanel'
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
      <p className="prompt-field-description">{description}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label={label}
      />
      <div className="prompt-field-footer">
        <button type="button" className="reset-btn" disabled={resetDisabled} onClick={onReset}>
          Reset to default
        </button>
      </div>
    </div>
  )
}

interface PromptTabContentProps {
  title: string
  field: PromptFieldProps
  loaded: boolean
  loadError: string | null
  saving: boolean
  saveMessage: string | null
  saveError: string | null
  onSave: () => void
}

function PromptTabContent({
  title, field, loaded, loadError, saving, saveMessage, saveError, onSave,
}: PromptTabContentProps) {
  return (
    <>
      <h3 className="settings-content-title">{title}</h3>
      <p className="prompt-field-description">
        Saved to <code>~/.applypilot/prompts/{title.toLowerCase().replace(' ', '_')}.md</code> — only written once you customize this prompt; until then it falls back to the built-in default.
      </p>
      {loadError && <p className="search-result search-error">{loadError}</p>}
      {!loaded && !loadError && <p className="search-result">Loading…</p>}
      {loaded && (
        <>
          <PromptField {...field} />
          <div className="config-actions">
            <button type="button" disabled={saving} onClick={onSave}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {saveMessage && <span className="search-result">{saveMessage}</span>}
          {saveError && <span className="search-result search-error">{saveError}</span>}
        </>
      )}
    </>
  )
}

interface Props {
  theme: Theme
  onToggleTheme: () => void
  showDismissed: boolean
  onToggleShowDismissed: () => void
}

const EMPTY_DEFAULTS = { cover_letter: '', tailoring: '', scoring: '' }

type SettingsTab = 'general' | 'search' | 'cover_letter' | 'scoring' | 'tailoring'

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'search', label: 'Search Defaults' },
  { key: 'cover_letter', label: 'Cover Letter' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'tailoring', label: 'Tailoring' },
]

export function SettingsModal({ theme, onToggleTheme, showDismissed, onToggleShowDismissed }: Props) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  const [promptsLoaded, setPromptsLoaded] = useState(false)
  const [promptsLoadError, setPromptsLoadError] = useState<string | null>(null)
  const [defaults, setDefaults] = useState(EMPTY_DEFAULTS)
  const [coverLetterText, setCoverLetterText] = useState('')
  const [tailoringText, setTailoringText] = useState('')
  const [scoringText, setScoringText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [searchConfig, setSearchConfig] = useState<SearchConfig | null>(null)
  const [searchConfigError, setSearchConfigError] = useState<string | null>(null)
  const [excludeTitlesText, setExcludeTitlesText] = useState('')
  const [searchSaving, setSearchSaving] = useState(false)
  const [searchSaveMessage, setSearchSaveMessage] = useState<string | null>(null)
  const [searchSaveError, setSearchSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Refetches on every open (same reasoning as SearchPanel's config load) so
  // a stale in-memory copy here can't clobber queries/locations edited from
  // the search modal in the meantime.
  useEffect(() => {
    if (!open) return
    setSearchConfigError(null)
    getSearchConfig()
      .then((cfg) => {
        setSearchConfig(cfg)
        setExcludeTitlesText(cfg.exclude_titles.join('\n'))
      })
      .catch(() => setSearchConfigError('Could not load search config'))
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

  function toggleBoard(board: string) {
    setSearchConfig((c) =>
      c && {
        ...c,
        boards: c.boards.includes(board) ? c.boards.filter((b) => b !== board) : [...c.boards, board],
      },
    )
  }

  async function handleSaveSearchDefaults() {
    if (!searchConfig) return
    setSearchSaving(true)
    setSearchSaveMessage(null)
    setSearchSaveError(null)
    try {
      const excludeTitles = excludeTitlesText
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean)
      const saved = await saveSearchConfig({ ...searchConfig, exclude_titles: excludeTitles })
      setSearchConfig(saved)
      setExcludeTitlesText(saved.exclude_titles.join('\n'))
      setSearchSaveMessage('Search defaults saved')
    } catch (e) {
      setSearchSaveError(e instanceof ApiError ? e.message : 'Failed to save search defaults')
    } finally {
      setSearchSaving(false)
    }
  }

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
                {activeTab === 'general' && (
                  <>
                    <h3 className="settings-content-title">General</h3>
                    <p className="prompt-field-description">
                      Saved in this browser's local storage — per-device, not synced or written to any file.
                    </p>
                    <div className="config-row">
                      <span className="field-label-inline">Theme</span>
                      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
                    </div>
                    <label className="toggle-check">
                      <input
                        type="checkbox"
                        checked={showDismissed}
                        onChange={onToggleShowDismissed}
                      />
                      Show dismissed jobs (marked "Not for me")
                    </label>
                    <p className="prompt-field-description">
                      Jobs marked "Not for me" are hidden from the dashboard by default. Turn this on to see them again.
                    </p>
                  </>
                )}

                {activeTab === 'search' && (
                  <>
                    <h3 className="settings-content-title">Search Defaults</h3>
                    <p className="prompt-field-description">
                      Saved to <code>~/.applypilot/searches.yaml</code> — the same file as the queries/locations in the Search modal, and also used by <code>applypilot run discover</code>.
                    </p>
                    {searchConfigError && <p className="search-result search-error">{searchConfigError}</p>}
                    {!searchConfig && !searchConfigError && <p className="search-result">Loading…</p>}
                    {searchConfig && (
                      <>
                        <div className="config-section">
                          <h3>Job boards</h3>
                          <div className="site-checks">
                            {SEARCHABLE_SITES.map((site) => (
                              <label key={site} className="toggle-check">
                                <input
                                  type="checkbox"
                                  checked={searchConfig.boards.includes(site)}
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
                                value={searchConfig.defaults.results_per_site}
                                onChange={(e) =>
                                  setSearchConfig((c) =>
                                    c && {
                                      ...c,
                                      defaults: { ...c.defaults, results_per_site: Number(e.target.value) },
                                    },
                                  )
                                }
                              />
                            </label>
                            <label className="field-label">
                              Posted within
                              <select
                                value={searchConfig.defaults.hours_old}
                                onChange={(e) =>
                                  setSearchConfig((c) =>
                                    c && { ...c, defaults: { ...c.defaults, hours_old: Number(e.target.value) } },
                                  )
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
                          <button type="button" disabled={searchSaving} onClick={handleSaveSearchDefaults}>
                            {searchSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                        {searchSaveMessage && <span className="search-result">{searchSaveMessage}</span>}
                        {searchSaveError && <span className="search-result search-error">{searchSaveError}</span>}
                      </>
                    )}
                  </>
                )}

                {activeTab === 'cover_letter' && (
                  <PromptTabContent
                    title="Cover Letter"
                    field={{
                      label: 'Cover Letter prompt',
                      description: 'Structure and voice for the four paragraphs (Intro, Why This Company, Why You, Closing). Banned words, the anti-fabrication guardrails, and sign-off format are always enforced by the code, regardless of what you write here.',
                      value: coverLetterText,
                      onChange: setCoverLetterText,
                      onReset: () => setCoverLetterText(defaults.cover_letter),
                      resetDisabled: saving,
                    }}
                    loaded={promptsLoaded}
                    loadError={promptsLoadError}
                    saving={saving}
                    saveMessage={saveMessage}
                    saveError={saveError}
                    onSave={handleSavePrompts}
                  />
                )}

                {activeTab === 'scoring' && (
                  <PromptTabContent
                    title="Scoring"
                    field={{
                      label: 'Scoring prompt',
                      description: 'The rubric (1-10 score bands, what factors matter) used to rate how well each job matches your resume. The exact response format the app parses is always enforced by the code.',
                      value: scoringText,
                      onChange: setScoringText,
                      onReset: () => setScoringText(defaults.scoring),
                      resetDisabled: saving,
                    }}
                    loaded={promptsLoaded}
                    loadError={promptsLoadError}
                    saving={saving}
                    saveMessage={saveMessage}
                    saveError={saveError}
                    onSave={handleSavePrompts}
                  />
                )}

                {activeTab === 'tailoring' && (
                  <PromptTabContent
                    title="Tailoring"
                    field={{
                      label: 'Tailoring prompt',
                      description: 'Recruiter-scan framing, tailoring rules, and voice guidance for rewriting your resume per job. Skills boundaries, banned words, hard fabrication rules, and the JSON output format are always enforced by the code.',
                      value: tailoringText,
                      onChange: setTailoringText,
                      onReset: () => setTailoringText(defaults.tailoring),
                      resetDisabled: saving,
                    }}
                    loaded={promptsLoaded}
                    loadError={promptsLoadError}
                    saving={saving}
                    saveMessage={saveMessage}
                    saveError={saveError}
                    onSave={handleSavePrompts}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
