import type { UserAction } from '../api/types'

export const LABEL_BY_USER_ACTION: Record<UserAction, string> = {
  not_for_me: 'Not for me',
  need_tailor: 'Need tailor',
  need_auto_apply: 'Need auto apply',
}

export const CLASS_BY_USER_ACTION: Record<UserAction, string> = {
  not_for_me: 'user-action-not_for_me',
  need_tailor: 'user-action-need_tailor',
  need_auto_apply: 'user-action-need_auto_apply',
}

export function UserActionBadge({ userAction }: { userAction: UserAction | null }) {
  if (!userAction) return <span className="user-action-empty">—</span>
  return (
    <span className={`user-action-badge ${CLASS_BY_USER_ACTION[userAction]}`}>
      {LABEL_BY_USER_ACTION[userAction]}
    </span>
  )
}
