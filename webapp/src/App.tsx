import { useMemo, useState } from 'react'
import { getJobs, getStatus } from './api/client'
import type { Job, JobType, Stage } from './api/types'
import { usePolling } from './hooks/usePolling'
import { useTheme } from './hooks/useTheme'
import { StatPills } from './components/StatPills'
import { SearchFilterBar } from './components/SearchFilterBar'
import { JobsTable, type SortDir, type SortKey } from './components/JobsTable'
import { ThemeToggle } from './components/ThemeToggle'
import { JobPreviewModal } from './components/JobPreviewModal'
import { SearchPanel } from './components/SearchPanel'
import './styles/index.css'

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
  const [stageFilter, setStageFilter] = useState<Stage[]>([])
  const [jobTypeFilter, setJobTypeFilter] = useState<JobType[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('discovered_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewJob = jobs?.find((j) => j.url === previewUrl) ?? null

  const visibleJobs = useMemo(() => {
    if (!jobs) return []
    const q = search.trim().toLowerCase()
    const filtered = jobs.filter((job) => {
      if (stageFilter.length > 0 && !stageFilter.includes(job.stage)) return false
      if (jobTypeFilter.length > 0 && !jobTypeFilter.includes(job.job_type ?? 'unknown')) return false
      if (!q) return true
      return (
        (job.title || '').toLowerCase().includes(q) ||
        (job.site || '').toLowerCase().includes(q) ||
        (job.location || '').toLowerCase().includes(q)
      )
    })
    return sortJobs(filtered, sortKey, sortDir)
  }, [jobs, search, stageFilter, jobTypeFilter, sortKey, sortDir])

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
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </div>
      <p className="subtitle">Live view of your job pipeline, refreshed every few seconds.</p>

      {error && (
        <div className="error-banner">
          Connection lost — retrying... ({error.message})
        </div>
      )}

      {status && <StatPills status={status} />}

      <SearchFilterBar
        search={search}
        onSearchChange={setSearch}
        stageFilter={stageFilter}
        onStageFilterChange={setStageFilter}
        jobTypeFilter={jobTypeFilter}
        onJobTypeFilterChange={setJobTypeFilter}
      />

      <JobsTable
        jobs={visibleJobs}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        onPreview={(job) => setPreviewUrl(job.url)}
      />

      {previewJob && <JobPreviewModal job={previewJob} onClose={() => setPreviewUrl(null)} />}
    </>
  )
}

export default App
