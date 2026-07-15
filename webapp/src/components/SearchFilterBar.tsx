import type { JobType, Stage, UserAction } from '../api/types'
import { CLASS_BY_JOB_TYPE, LABEL_BY_JOB_TYPE } from './JobTypeBadge'
import { JOB_TYPE_ORDER } from './jobTypeOrder'
import { MultiSelectFilter, type FilterMode } from './MultiSelectFilter'
import { CLASS_BY_STAGE } from './StageBadge'
import { STAGE_ORDER } from './stageOrder'
import { CLASS_BY_USER_ACTION, LABEL_BY_USER_ACTION } from './UserActionBadge'
import { USER_ACTION_ORDER } from './userActionOrder'

interface Props {
  search: string
  onSearchChange: (value: string) => void
  stageFilter: Stage[]
  onStageFilterChange: (value: Stage[]) => void
  stageFilterMode: FilterMode
  onStageFilterModeChange: (mode: FilterMode) => void
  jobTypeFilter: JobType[]
  onJobTypeFilterChange: (value: JobType[]) => void
  jobTypeFilterMode: FilterMode
  onJobTypeFilterModeChange: (mode: FilterMode) => void
  userActionFilter: UserAction[]
  onUserActionFilterChange: (value: UserAction[]) => void
  userActionFilterMode: FilterMode
  onUserActionFilterModeChange: (mode: FilterMode) => void
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

const USER_ACTION_OPTIONS = USER_ACTION_ORDER.map((action) => ({
  value: action,
  label: LABEL_BY_USER_ACTION[action],
  colorClassName: CLASS_BY_USER_ACTION[action],
}))

export function SearchFilterBar({
  search,
  onSearchChange,
  stageFilter,
  onStageFilterChange,
  stageFilterMode,
  onStageFilterModeChange,
  jobTypeFilter,
  onJobTypeFilterChange,
  jobTypeFilterMode,
  onJobTypeFilterModeChange,
  userActionFilter,
  onUserActionFilterChange,
  userActionFilterMode,
  onUserActionFilterModeChange,
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
          mode={stageFilterMode}
          onModeChange={onStageFilterModeChange}
        />
        <MultiSelectFilter
          label="Job Type"
          options={JOB_TYPE_OPTIONS}
          selected={jobTypeFilter}
          onChange={onJobTypeFilterChange}
          mode={jobTypeFilterMode}
          onModeChange={onJobTypeFilterModeChange}
        />
        <MultiSelectFilter
          label="Action"
          options={USER_ACTION_OPTIONS}
          selected={userActionFilter}
          onChange={onUserActionFilterChange}
          mode={userActionFilterMode}
          onModeChange={onUserActionFilterModeChange}
        />
      </div>
    </div>
  )
}
