import { useCallback, useEffect, useState } from 'react'
import { ApiError, getJob, getStatus, listCvs, searchJobs, setJobDismissed, setJobUserAction } from './api/client'
import type { Job, JobType, SearchJobsParams, UserAction } from './api/types'
import { useRefreshable } from './hooks/useRefreshable'
import { useTheme } from './hooks/useTheme'
import { useLocalStorageState } from './hooks/useLocalStorageState'
import { StatPills } from './components/StatPills'
import { SearchFilterBar } from './components/SearchFilterBar'
import type { FilterMode } from './components/MultiSelectFilter'
import type { DateKey } from './lib/dateRange'
import { JobsTable, type SortDir, type SortKey } from './components/JobsTable'
import { JobPreviewModal } from './components/JobPreviewModal'
import { SearchPanel } from './components/SearchPanel'
import { SettingsModal } from './components/SettingsModal'
import { CvLibraryModal } from './components/CvLibraryModal'
import './styles/index.css'

const DEFAULT_PANEL_WIDTH = 480
const DEFAULT_PAGE_SIZE = 50

// JobsTable.SortKey includes 'stage' as a dead, never-selected option (no
// column wires it up) -- the server doesn't support sorting by it, so fall
// back to the default rather than sending it.
function toApiSortKey(key: SortKey): SearchJobsParams['sort_by'] {
  return key === 'stage' ? 'discovered_at' : key
}

function App() {
  const { theme, toggleTheme } = useTheme()
  const { data: status, error: statusError, refresh: refreshStatus } = useRefreshable(getStatus)
  const { data: cvs, refresh: refreshCvs } = useRefreshable(listCvs)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
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
  const [dateFrom, setDateFrom] = useState<DateKey | null>(null)
  const [dateTo, setDateTo] = useState<DateKey | null>(null)
  const [showDismissed, setShowDismissed] = useLocalStorageState('applypilot-show-dismissed', false)
  const [hiddenColumns, setHiddenColumns] = useLocalStorageState<SortKey[]>('applypilot-hidden-columns', [])
  const [panelWidth, setPanelWidth] = useLocalStorageState('applypilot-job-detail-width', DEFAULT_PANEL_WIDTH)
  const [sortKey, setSortKey] = useLocalStorageState<SortKey>('applypilot-sort-key', 'discovered_at')
  const [sortDir, setSortDir] = useLocalStorageState<SortDir>('applypilot-sort-dir', 'desc')
  const [pageSize, setPageSize] = useLocalStorageState('applypilot-page-size', DEFAULT_PAGE_SIZE)
  const [page, setPage] = useState(1)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewJob, setPreviewJob] = useState<Job | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Debounce free-text search so it doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Any filter/search/sort/page-size change invalidates the current page --
  // jump back to page 1 rather than showing an out-of-range page.
  useEffect(() => {
    setPage(1)
  }, [
    debouncedSearch,
    jobTypeFilter,
    jobTypeFilterMode,
    userActionFilter,
    userActionFilterMode,
    dateFrom,
    dateTo,
    showDismissed,
    sortKey,
    sortDir,
    pageSize,
  ])

  const {
    data: searchResult,
    error: jobsError,
    refresh: refreshJobs,
  } = useRefreshable(
    () =>
      searchJobs({
        page,
        page_size: pageSize,
        q: debouncedSearch,
        job_type: jobTypeFilter,
        job_type_mode: jobTypeFilterMode,
        user_action: userActionFilter,
        user_action_mode: userActionFilterMode,
        include_dismissed: showDismissed,
        discovered_after: dateFrom,
        discovered_before: dateTo,
        sort_by: toApiSortKey(sortKey),
        sort_dir: sortDir,
      }),
    [
      page,
      pageSize,
      debouncedSearch,
      jobTypeFilter,
      jobTypeFilterMode,
      userActionFilter,
      userActionFilterMode,
      dateFrom,
      dateTo,
      showDismissed,
      sortKey,
      sortDir,
    ],
  )

  const jobs = searchResult?.items ?? []
  const totalJobs = searchResult?.total ?? 0
  const totalPages = searchResult?.total_pages ?? 0

  // Refetches status + the current page on-demand -- passed down to whatever
  // just changed the DB (a local mutation, or SearchPanel while a run is
  // actively writing rows) instead of polling blindly on a timer.
  const refresh = useCallback(() => {
    refreshStatus()
    refreshJobs()
  }, [refreshStatus, refreshJobs])

  // The preview panel needs full_description, which list/search results omit
  // to keep page payloads small -- fetch the full record whenever the
  // preview target changes.
  useEffect(() => {
    if (!previewUrl) {
      setPreviewJob(null)
      return
    }
    let cancelled = false
    getJob(previewUrl)
      .then((detail) => {
        if (!cancelled) setPreviewJob(detail)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [previewUrl])

  async function refreshPreviewIfOpen(url: string) {
    if (url !== previewUrl) return
    try {
      setPreviewJob(await getJob(url))
    } catch {
      // ignore -- the list refresh triggered alongside this still reflects the mutation
    }
  }

  async function handleUserActionChange(job: Job, value: UserAction | null) {
    try {
      await setJobUserAction(job.url, value)
      setActionError(null)
      refresh()
      refreshPreviewIfOpen(job.url)
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Failed to update action')
    }
  }

  async function handleDismissChange(job: Job, dismissed: boolean) {
    try {
      await setJobDismissed(job.url, dismissed)
      setActionError(null)
      refresh()
      refreshPreviewIfOpen(job.url)
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Failed to update dismissed state')
    }
  }

  function handleCoverLetterGenerated() {
    refresh()
    if (previewUrl) refreshPreviewIfOpen(previewUrl)
  }

  function handleAutoSubmitComplete() {
    refresh()
    if (previewUrl) refreshPreviewIfOpen(previewUrl)
  }

  function toggleColumnVisibility(key: SortKey) {
    setHiddenColumns((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
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
    <div className="app-container" style={{ marginRight: previewJob ? panelWidth : undefined }}>
      <div className="app-header">
        <h1>ApplyPilot Dashboard</h1>
        <div className="app-header-actions">
          <SearchPanel onActivity={refresh} />
          <CvLibraryModal onActivity={refreshCvs} />
          <SettingsModal
            theme={theme}
            onToggleTheme={toggleTheme}
            showDismissed={showDismissed}
            onToggleShowDismissed={() => setShowDismissed((v) => !v)}
            hiddenColumns={hiddenColumns}
            onToggleColumn={toggleColumnVisibility}
          />
        </div>
      </div>
      <p className="subtitle">Live view of your job pipeline, updated as jobs are found or changed.</p>

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
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateRangeChange={(from, to) => {
          setDateFrom(from)
          setDateTo(to)
        }}
      />

      <JobsTable
        jobs={jobs}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        onPreview={(job) => setPreviewUrl(job.url)}
        onUserActionChange={handleUserActionChange}
        hiddenColumns={hiddenColumns}
      />

      {totalJobs > 0 && (
        <div className="pagination-bar">
          <span className="pagination-summary">
            {totalJobs} job{totalJobs === 1 ? '' : 's'} · page {page} of {totalPages}
          </span>
          <div className="pagination-controls">
            <button
              type="button"
              className="pagination-button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <button
              type="button"
              className="pagination-button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next →
            </button>
            <select
              className="pagination-page-size"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {[25, 50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {previewJob && (
        <JobPreviewModal
          job={previewJob}
          onClose={() => setPreviewUrl(null)}
          onUserActionChange={handleUserActionChange}
          onDismissChange={handleDismissChange}
          onCoverLetterGenerated={handleCoverLetterGenerated}
          onAutoSubmitComplete={handleAutoSubmitComplete}
          cvCount={cvs?.length ?? 0}
          width={panelWidth}
          onWidthChange={setPanelWidth}
        />
      )}
    </div>
  )
}

export default App
