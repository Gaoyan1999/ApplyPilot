import type { JobType, UserAction } from '../api/types'
import { DateRangeFilter } from './DateRangeFilter'
import type { DateKey } from '../lib/dateRange'
import { CLASS_BY_JOB_TYPE, LABEL_BY_JOB_TYPE } from './JobTypeBadge'
import { JOB_TYPE_ORDER } from './jobTypeOrder'
import { MultiSelectFilter, type FilterMode } from './MultiSelectFilter'
import { CLASS_BY_USER_ACTION, LABEL_BY_USER_ACTION } from './UserActionBadge'
import { USER_ACTION_ORDER } from './userActionOrder'

interface Props {
  search: string
  onSearchChange: (value: string) => void
  jobTypeFilter: JobType[]
  onJobTypeFilterChange: (value: JobType[]) => void
  jobTypeFilterMode: FilterMode
  onJobTypeFilterModeChange: (mode: FilterMode) => void
  userActionFilter: UserAction[]
  onUserActionFilterChange: (value: UserAction[]) => void
  userActionFilterMode: FilterMode
  onUserActionFilterModeChange: (mode: FilterMode) => void
  dateFrom: DateKey | null
  dateTo: DateKey | null
  onDateRangeChange: (from: DateKey | null, to: DateKey | null) => void
}

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
  jobTypeFilter,
  onJobTypeFilterChange,
  jobTypeFilterMode,
  onJobTypeFilterModeChange,
  userActionFilter,
  onUserActionFilterChange,
  userActionFilterMode,
  onUserActionFilterModeChange,
  dateFrom,
  dateTo,
  onDateRangeChange,
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
        <DateRangeFilter from={dateFrom} to={dateTo} onChange={onDateRangeChange} />
      </div>
    </div>
  )
}
