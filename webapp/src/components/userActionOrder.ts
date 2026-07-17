import type { UserAction } from '../api/types'

export const USER_ACTION_ORDER: UserAction[] = [
  'not_for_me',
  'need_tailor',
  'need_auto_apply',
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'closed',
]

// Where the "applied and tracking status" group starts in USER_ACTION_ORDER,
// so UI that lists all actions (e.g. the Mark-as popover) can render a
// divider between pre-application reminders and post-application tracking.
export const APPLICATION_STATUS_ACTIONS: UserAction[] = [
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'closed',
]
