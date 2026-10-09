import { useEffect, useState } from 'react'
import { ApplyEngineSetting } from './ApplyEngineSetting'
import { ApiError, getContextStatus, getSearchConfig, saveSearchConfig } from '../api/client'
import type { ContextStatus, SearchConfig } from '../api/types'
import type { Theme } from '../hooks/useTheme'
import { COLUMNS, type SortKey } from './JobsTable'
import { CheckItem } from './CheckItem'
import { JevKeyCheck } from './JevKeyCheck'
import { LlmProviderForm } from './LlmProviderForm'
import { SEARCHABLE_SITES, SITE_META, SiteIcon } from './SiteIcon'
import { TIME_RANGES } from './SearchPanel'
import { Switch } from './Switch'
import { TagInput } from './TagInput'
import { ThemeToggle } from './ThemeToggle'

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1" />
    </svg>
  )
}

interface Props {
  theme: Theme
  onToggleTheme: () => void
  // Dashboard-only -- the job table's row visibility/columns don't exist on
  // other pages, so these are omitted when SettingsModal is rendered from
  // the shared TopBar on a non-dashboard page.
  showDismissed?: boolean
  onToggleShowDismissed?: () => void
  hiddenColumns?: SortKey[]
  onToggleColumn?: (key: SortKey) => void
}

type SettingsTab = 'general' | 'setup' | 'search'

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'setup', label: 'AI & Setup' },
  { key: 'search', label: 'Search' },
]

export function SettingsModal({
  theme, onToggleTheme, showDismissed, onToggleShowDismissed, hiddenColumns, onToggleColumn,
}: Props) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(null)
  const [contextStatusError, setContextStatusError] = useState<string | null>(null)

  const [searchConfig, setSearchConfig] = useState<SearchConfig | null>(null)
  const [searchConfigError, setSearchConfigError] = useState<string | null>(null)
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
  // a stale in-memory copy here can't clobber locations edited from the
  // search modal in the meantime.
  useEffect(() => {
    if (!open) return
    setSearchConfigError(null)
    getSearchConfig()
      .then(setSearchConfig)
      .catch(() => setSearchConfigError('Could not load search config'))
  }, [open])

  function refreshContextStatus() {
    setContextStatusError(null)
    getContextStatus()
      .then(setContextStatus)
      .catch(() => setContextStatusError('Could not load setup status'))
  }

  useEffect(() => {
    if (open) refreshContextStatus()
  }, [open])

  function toggleBoard(board: string) {
    if (!searchConfig) return
    const boards = searchConfig.boards
    updateSearchConfig({ boards: boards.includes(board) ? boards.filter((b) => b !== board) : [...boards, board] })
  }

  async function handleSaveSearchDefaults() {
    if (!searchConfig) return
    setSearchSaving(true)
    setSearchSaveMessage(null)
    setSearchSaveError(null)
    try {
      setSearchConfig(await saveSearchConfig(searchConfig))
      setSearchSaveMessage('Saved')
    } catch (e) {
      setSearchSaveError(e instanceof ApiError ? e.message : 'Failed to save search settings')
    } finally {
      setSearchSaving(false)
    }
  }

  function updateQuery(i: number, query: string) {
    if (!searchConfig) return
    updateSearchConfig({ queries: searchConfig.queries.map((q, idx) => (idx === i ? { ...q, query } : q)) })
  }

  function updateSearchConfig(patch: Partial<SearchConfig>) {
    setSearchSaveMessage(null)
    setSearchConfig((c) => c && { ...c, ...patch })
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

                    {onToggleShowDismissed && (
                      <>
                        <label className="toggle-check">
                          <input
                            type="checkbox"
                            checked={showDismissed ?? false}
                            onChange={onToggleShowDismissed}
                          />
                          Show dismissed jobs (marked "Not for me")
                        </label>
                        <p className="prompt-field-description">
                          Jobs marked "Not for me" are hidden from the dashboard by default. Turn this on to see them again.
                        </p>
                      </>
                    )}

                    {hiddenColumns && onToggleColumn && (
                      <div className="config-section">
                        <h3>Visible columns</h3>
                        <div className="switch-grid">
                          {COLUMNS.map((col) => (
                            <Switch
                              key={col.key}
                              label={col.label}
                              checked={!hiddenColumns.includes(col.key)}
                              onChange={() => onToggleColumn(col.key)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {activeTab === 'setup' && (
                  <>
                    <h3 className="settings-content-title">AI & Setup</h3>
                    <p className="prompt-field-description">
                      Keys are saved to <code>~/.applypilot/.env</code>.
                    </p>
                    {contextStatusError && <p className="search-result search-error">{contextStatusError}</p>}
                    {!contextStatus && !contextStatusError && <p className="search-result">Loading…</p>}
                    {contextStatus && (
                      <>
                        <div className="config-section">
                          <h3>LLM provider</h3>
                          <LlmProviderForm configured={contextStatus.env.configured} onSaved={refreshContextStatus} />
                        </div>
                        <div className="config-section">
                          <h3>Auto-apply</h3>
                          <ApplyEngineSetting />
                          <ul className="check-list">
                            <JevKeyCheck configured={contextStatus.jev_key} onSaved={refreshContextStatus} />
                            <CheckItem
                              label="Claude Code CLI"
                              state={contextStatus.claude_cli ? 'ok' : 'warn'}
                              hint={
                                contextStatus.claude_cli
                                  ? 'Full apply agent. Used when it is the chosen engine, or when jev fails.'
                                  : 'Not found on PATH. Install it from claude.ai/code.'
                              }
                            />
                          </ul>
                        </div>
                      </>
                    )}
                  </>
                )}

                {activeTab === 'search' && (
                  <>
                    <h3 className="settings-content-title">Search</h3>
                    <p className="prompt-field-description">
                      Saved to <code>~/.applypilot/searches.yaml</code> — the same file as the locations in the Search modal, and also used by <code>applypilot run discover</code>.
                    </p>
                    {searchConfigError && <p className="search-result search-error">{searchConfigError}</p>}
                    {!searchConfig && !searchConfigError && <p className="search-result">Loading…</p>}
                    {searchConfig && (
                      <>
                        <div className="config-section">
                          <h3>Search queries ({searchConfig.queries.length})</h3>
                          {searchConfig.queries.map((q, i) => (
                            <div className="config-row" key={i}>
                              <input
                                type="text"
                                className="ctx-input"
                                placeholder="Job title or keywords"
                                value={q.query}
                                onChange={(e) => updateQuery(i, e.target.value)}
                              />
                              <button
                                type="button"
                                className="remove-btn"
                                onClick={() => updateSearchConfig({ queries: searchConfig.queries.filter((_, idx) => idx !== i) })}
                                aria-label="Remove query"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="add-btn"
                            onClick={() => updateSearchConfig({ queries: [...searchConfig.queries, { query: '', tier: 1 }] })}
                          >
                            + Add query
                          </button>
                        </div>

                        <div className="config-section">
                          <h3>Job boards</h3>
                          <div className="board-chips">
                            {SEARCHABLE_SITES.map((site) => {
                              const on = searchConfig.boards.includes(site)
                              return (
                                <button
                                  key={site}
                                  type="button"
                                  className={`board-chip${on ? ' on' : ''}`}
                                  aria-pressed={on}
                                  onClick={() => toggleBoard(site)}
                                >
                                  <SiteIcon site={site} />
                                  {SITE_META[site].label}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div className="config-section">
                          <h3>Exclude titles</h3>
                          <p className="ctx-hint">Jobs whose title contains any of these words are skipped.</p>
                          <TagInput
                            values={searchConfig.exclude_titles}
                            onChange={(exclude_titles) => updateSearchConfig({ exclude_titles })}
                            placeholder="Add a word, then press Enter"
                          />
                        </div>

                        <div className="config-section">
                          <h3>Defaults</h3>
                          <div className="field-grid">
                            <label className="ctx-field">
                              <span className="ctx-field-label">Results per board</span>
                              <input
                                type="number"
                                className="ctx-input"
                                min={1}
                                max={100}
                                value={searchConfig.defaults.results_per_site}
                                onChange={(e) =>
                                  updateSearchConfig({
                                    defaults: { ...searchConfig.defaults, results_per_site: Number(e.target.value) },
                                  })
                                }
                              />
                            </label>
                            <label className="ctx-field">
                              <span className="ctx-field-label">Posted within</span>
                              <select
                                className="ctx-input"
                                value={searchConfig.defaults.hours_old}
                                onChange={(e) =>
                                  updateSearchConfig({
                                    defaults: { ...searchConfig.defaults, hours_old: Number(e.target.value) },
                                  })
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

                        <div className="ctx-actions">
                          {searchSaveMessage && <span className="ctx-saved">{searchSaveMessage}</span>}
                          {searchSaveError && <span className="search-result search-error">{searchSaveError}</span>}
                          <span className="ctx-actions-spacer" />
                          <button type="button" className="ctx-btn primary" disabled={searchSaving} onClick={handleSaveSearchDefaults}>
                            {searchSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
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
