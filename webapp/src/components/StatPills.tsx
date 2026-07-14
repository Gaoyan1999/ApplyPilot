import type { Status } from '../api/types'

export function StatPills({ status }: { status: Status }) {
  const items = [
    { label: 'Total', value: status.total },
    { label: 'Scored', value: status.scored },
    { label: 'High Fit (7+)', value: status.high_fit },
    { label: 'Tailored', value: status.tailored },
    { label: 'Applied', value: status.applied },
    { label: 'Failed', value: status.stage_counts.Failed },
  ]

  return (
    <div className="stat-pills">
      {items.map((item) => (
        <div className="stat-pill" key={item.label}>
          <div className="value">{item.value}</div>
          <div className="label">{item.label}</div>
        </div>
      ))}
    </div>
  )
}
