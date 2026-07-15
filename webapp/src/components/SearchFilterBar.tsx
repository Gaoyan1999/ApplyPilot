import type { JobType, Stage } from '../api/types'
import { CLASS_BY_JOB_TYPE, LABEL_BY_JOB_TYPE } from './JobTypeBadge'
import { JOB_TYPE_ORDER } from './jobTypeOrder'
import { MultiSelectFilter } from './MultiSelectFilter'
import { CLASS_BY_STAGE } from './StageBadge'
import { STAGE_ORDER } from './stageOrder'

interface Props {
  search: string
  onSearchChange: (value: string) => void
  stageFilter: Stage[]
  onStageFilterChange: (value: Stage[]) => void
  jobTypeFilter: JobType[]
  onJobTypeFilterChange: (value: JobType[]) => void
}

const STAGE_OPTIONS = STAGE_ORDER.map((stage) => ({
  value: stage,
  label: stage,
  colorClassName: CLASS_BY_STAGE[stage],
}))

const JOB_TYPE_OPTIONS = JOB_TYPE_ORDER.map((jobType) => ({
  value: jobType,
  label: LABEL_BY_JOB_TYPE[jobType],
  colorClassName: CLASS_BY_JOB_TYPE[jobType],
}))

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
        <MultiSelectFilter
          label="Stage"
          options={STAGE_OPTIONS}
          selected={stageFilter}
          onChange={onStageFilterChange}
        />
        <MultiSelectFilter
          label="Job Type"
          options={JOB_TYPE_OPTIONS}
          selected={jobTypeFilter}
          onChange={onJobTypeFilterChange}
        />
      </div>
    </div>
  )
}
