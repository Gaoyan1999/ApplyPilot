import type { Status } from '../api/types'
import { CLASS_BY_USER_ACTION, LABEL_BY_USER_ACTION } from './UserActionBadge'
import { APPLICATION_STATUS_ACTIONS } from './userActionOrder'

export function StatPills({ status }: { status: Status }) {
  const countByAction = Object.fromEntries(
    status.by_user_action.map((entry) => [entry.user_action, entry.count]),
  )
  const inProgressBreakdown = APPLICATION_STATUS_ACTIONS.map((action) => ({
    action,
    count: countByAction[action] ?? 0,
  })).filter((entry) => entry.count > 0)
  const inProgressTotal = inProgressBreakdown.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <div className="stat-pills">
      <div className="stat-pill">
        <div className="value">{status.total}</div>
        <div className="label">Total</div>
      </div>
      <div className="stat-pill">
        <div className="value">
          {status.high_fit}
          <span className="stat-pill-value-suffix">/ {status.total}</span>
        </div>
        <div className="label">High Fit (7+)</div>
      </div>
      <div className="stat-pill stat-pill-wide">
        <div className="value">{inProgressTotal}</div>
        <div className="label">In Progress</div>
        {inProgressBreakdown.length > 0 && (
          <div className="stat-pill-breakdown">
            {inProgressBreakdown.map(({ action, count }) => (
              <span
                key={action}
                className={`stat-pill-breakdown-chip ${CLASS_BY_USER_ACTION[action]}`}
                title={LABEL_BY_USER_ACTION[action]}
              >
                {count}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
