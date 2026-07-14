import type { Stage } from '../api/types'
import { STAGE_ORDER } from './stageOrder'

interface Props {
  search: string
  onSearchChange: (value: string) => void
  stageFilter: Stage | 'All'
  onStageFilterChange: (value: Stage | 'All') => void
}

export function SearchFilterBar({ search, onSearchChange, stageFilter, onStageFilterChange }: Props) {
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
    </div>
  )
}
