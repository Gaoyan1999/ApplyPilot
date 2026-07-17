import type { UserAction } from '../api/types'

export const LABEL_BY_USER_ACTION: Record<UserAction, string> = {
  need_tailor: 'Need tailor',
  need_auto_apply: 'Need auto apply',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
  closed: 'Closed',
}

export const CLASS_BY_USER_ACTION: Record<UserAction, string> = {
  need_tailor: 'user-action-need_tailor',
  need_auto_apply: 'user-action-need_auto_apply',
  applied: 'user-action-applied',
  interviewing: 'user-action-interviewing',
  offer: 'user-action-offer',
  rejected: 'user-action-rejected',
  closed: 'user-action-closed',
}

export function UserActionBadge({ userAction }: { userAction: UserAction | null }) {
  if (!userAction) return <span className="user-action-empty">—</span>
  return (
    <span className={`user-action-badge ${CLASS_BY_USER_ACTION[userAction]}`}>
      {LABEL_BY_USER_ACTION[userAction]}
    </span>
  )
}
