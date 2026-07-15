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
      <input
        type="text"
        placeholder="Search title, site, location..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <select
        value={stageFilter}
        onChange={(e) => onStageFilterChange(e.target.value as Stage | 'All')}
      >
        <option value="All">All stages</option>
        {STAGE_ORDER.map((stage) => (
          <option key={stage} value={stage}>
            {stage}
          </option>
        ))}
      </select>
      <select
        value={jobTypeFilter}
        onChange={(e) => onJobTypeFilterChange(e.target.value as JobType | 'All')}
      >
        <option value="All">All types</option>
        {JOB_TYPE_ORDER.map((jobType) => (
          <option key={jobType} value={jobType}>
            {LABEL_BY_JOB_TYPE[jobType]}
          </option>
        ))}
      </select>
    </div>
  )
}
