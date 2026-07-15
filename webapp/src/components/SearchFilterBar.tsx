import type { JobType, Stage } from '../api/types'
import { JOB_TYPE_ORDER } from './jobTypeOrder'
import { LABEL_BY_JOB_TYPE } from './JobTypeBadge'
import { STAGE_ORDER } from './stageOrder'

interface Props {
  search: string
  onSearchChange: (value: string) => void
  stageFilter: Stage | 'All'
  onStageFilterChange: (value: Stage | 'All') => void
  jobTypeFilter: JobType | 'All'
  onJobTypeFilterChange: (value: JobType | 'All') => void
}

export function SearchFilterBar({
  search,
  onSearchChange,
  stageFilter,
  onStageFilterChange,
  jobTypeFilter,
  onJobTypeFilterChange,
}: Props) {
  return (
    <div className="filter-bar">
      <div className="filter-search-row">
        <input
          type="text"
          className="filter-search-input"
          placeholder="Search title, site, location..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="filter-pills-row">
        <label className={`filter-pill${stageFilter !== 'All' ? ' filter-pill-active' : ''}`}>
          <select
            value={stageFilter}
            onChange={(e) => onStageFilterChange(e.target.value as Stage | 'All')}
          >
            <option value="All">Stage</option>
            {STAGE_ORDER.map((stage) => (
              <option key={stage} value={stage}>{`Stage: ${stage}`}</option>
            ))}
          </select>
        </label>
        <label className={`filter-pill${jobTypeFilter !== 'All' ? ' filter-pill-active' : ''}`}>
          <select
            value={jobTypeFilter}
            onChange={(e) => onJobTypeFilterChange(e.target.value as JobType | 'All')}
          >
            <option value="All">Type</option>
            {JOB_TYPE_ORDER.map((jobType) => (
              <option key={jobType} value={jobType}>{`Type: ${LABEL_BY_JOB_TYPE[jobType]}`}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
