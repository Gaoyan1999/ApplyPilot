import { useMemo, useState } from 'react'
import { ApiError, getJobs, getStatus, setJobUserAction } from './api/client'
import type { Job, JobType, UserAction } from './api/types'
import { usePolling } from './hooks/usePolling'
import { useTheme } from './hooks/useTheme'
import { useLocalStorageState } from './hooks/useLocalStorageState'
import { StatPills } from './components/StatPills'
import { SearchFilterBar } from './components/SearchFilterBar'
import type { FilterMode } from './components/MultiSelectFilter'
import { JobsTable, type SortDir, type SortKey } from './components/JobsTable'
import { JobPreviewModal } from './components/JobPreviewModal'
import { SearchPanel } from './components/SearchPanel'
import { SettingsModal } from './components/SettingsModal'
import './styles/index.css'

function matchesMultiSelect<T extends string>(mode: FilterMode, selected: T[], value: T | null): boolean {
  if (selected.length === 0) return true
  const included = value !== null && selected.includes(value)
  return mode === 'is' ? included : !included
}

function sortJobs(jobs: Job[], key: SortKey, dir: SortDir): Job[] {
  const factor = dir === 'asc' ? 1 : -1
  return [...jobs].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    if (av < bv) return -1 * factor
    if (av > bv) return 1 * factor
    return 0
  })
}

function App() {
  const { theme, toggleTheme } = useTheme()
  const { data: status, error: statusError } = usePolling(getStatus)
  const { data: jobs, error: jobsError } = usePolling(getJobs)

  const [search, setSearch] = useState('')
  const [jobTypeFilter, setJobTypeFilter] = useLocalStorageState<JobType[]>('applypilot-filter-job-type', [])
  const [jobTypeFilterMode, setJobTypeFilterMode] = useLocalStorageState<FilterMode>(
    'applypilot-filter-job-type-mode',
    'is',
  )
  const [userActionFilter, setUserActionFilter] = useLocalStorageState<UserAction[]>(
    'applypilot-filter-user-action',
    [],
  )
  const [userActionFilterMode, setUserActionFilterMode] = useLocalStorageState<FilterMode>(
    'applypilot-filter-user-action-mode',
    'is',
  )
  const [showDismissed, setShowDismissed] = useLocalStorageState('applypilot-show-dismissed', false)
  const [sortKey, setSortKey] = useState<SortKey>('discovered_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const previewJob = jobs?.find((j) => j.url === previewUrl) ?? null

  const visibleJobs = useMemo(() => {
    if (!jobs) return []
    const q = search.trim().toLowerCase()
    const filtered = jobs.filter((job) => {
      if (job.user_action === 'not_for_me' && !showDismissed) return false
      if (!matchesMultiSelect(jobTypeFilterMode, jobTypeFilter, job.job_type ?? 'unknown')) return false
      if (!matchesMultiSelect(userActionFilterMode, userActionFilter, job.user_action)) return false
      if (!q) return true
      return (
        (job.title || '').toLowerCase().includes(q) ||
        (job.company || '').toLowerCase().includes(q) ||
        (job.site || '').toLowerCase().includes(q) ||
        (job.location || '').toLowerCase().includes(q)
      )
    })
    return sortJobs(filtered, sortKey, sortDir)
  }, [
    jobs,
    search,
    showDismissed,
    jobTypeFilter,
    jobTypeFilterMode,
    userActionFilter,
    userActionFilterMode,
    sortKey,
    sortDir,
  ])

  async function handleUserActionChange(job: Job, value: UserAction | null) {
    try {
      await setJobUserAction(job.url, value)
      setActionError(null)
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Failed to update action')
    }
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const error = statusError || jobsError

  return (
    <>
      <div className="app-header">
        <h1>ApplyPilot Dashboard</h1>
        <div className="app-header-actions">
          <SearchPanel />
          <SettingsModal
            theme={theme}
            onToggleTheme={toggleTheme}
            showDismissed={showDismissed}
            onToggleShowDismissed={() => setShowDismissed((v) => !v)}
          />
        </div>
      </div>
      <p className="subtitle">Live view of your job pipeline, refreshed every few seconds.</p>

      {error && (
        <div className="error-banner">
          Connection lost — retrying... ({error.message})
        </div>
      )}

      {actionError && <div className="error-banner">{actionError}</div>}

      {status && <StatPills status={status} />}

      <SearchFilterBar
        search={search}
        onSearchChange={setSearch}
        jobTypeFilter={jobTypeFilter}
        onJobTypeFilterChange={setJobTypeFilter}
        jobTypeFilterMode={jobTypeFilterMode}
        onJobTypeFilterModeChange={setJobTypeFilterMode}
        userActionFilter={userActionFilter}
        onUserActionFilterChange={setUserActionFilter}
        userActionFilterMode={userActionFilterMode}
        onUserActionFilterModeChange={setUserActionFilterMode}
      />

      <JobsTable
        jobs={visibleJobs}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        onPreview={(job) => setPreviewUrl(job.url)}
        onUserActionChange={handleUserActionChange}
      />

      {previewJob && (
        <JobPreviewModal
          job={previewJob}
          onClose={() => setPreviewUrl(null)}
          onUserActionChange={handleUserActionChange}
        />
      )}
    </>
  )
}

export default App
