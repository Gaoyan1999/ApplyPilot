import type { Theme } from '../hooks/useTheme'
import { useHashRoute } from '../hooks/useHashRoute'
import { CvLibraryModal } from './CvLibraryModal'
import { SettingsModal } from './SettingsModal'
import type { SortKey } from './JobsTable'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  // Dashboard-only extras, passed through to SettingsModal/CvLibraryModal --
  // omitted on Tasks/Context since there's no job table or CV list activity
  // to react to there.
  onCvActivity?: () => void
  showDismissed?: boolean
  onToggleShowDismissed?: () => void
  hiddenColumns?: SortKey[]
  onToggleColumn?: (key: SortKey) => void
  // Width (px) of a right-side panel (the job detail drawer) to shrink away
  // from, so the bar stays fully visible instead of sliding under it.
  rightInset?: number
}

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard' },
  { path: '/tasks', label: 'Tasks' },
  { path: '/context', label: 'Context' },
]

function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect width="24" height="24" rx="7" fill="currentColor" />
      <path d="M12 6.5l5.5 5.5h-3.25v6h-4.5v-6H6.5z" fill="var(--bg)" />
    </svg>
  )
}

/** Persistent top bar: present on every page (Dashboard, Tasks, Context) so
 * page navigation and the global CV/Settings modals are always reachable,
 * regardless of which page is currently active. Page-specific actions (e.g.
 * Search, Check Job Status) live in the page body instead, not here. */
export function TopBar({
  theme, onToggleTheme, onCvActivity,
  showDismissed, onToggleShowDismissed, hiddenColumns, onToggleColumn, rightInset,
}: Props) {
  const path = useHashRoute()

  return (
    <div className="top-bar-wrap" style={{ marginRight: rightInset }}>
      <div className="top-bar">
        <a className="top-bar-brand" href="#/">
          <BrandMark />
          ApplyPilot
        </a>
        <nav className="top-bar-nav">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.path}
              className={`top-bar-nav-link${path === item.path ? ' active' : ''}`}
              href={`#${item.path}`}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="top-bar-actions">
          <CvLibraryModal onActivity={onCvActivity ?? (() => {})} />
          <SettingsModal
            theme={theme}
            onToggleTheme={onToggleTheme}
            showDismissed={showDismissed}
            onToggleShowDismissed={onToggleShowDismissed}
            hiddenColumns={hiddenColumns}
            onToggleColumn={onToggleColumn}
          />
        </div>
      </div>
    </div>
  )
}
