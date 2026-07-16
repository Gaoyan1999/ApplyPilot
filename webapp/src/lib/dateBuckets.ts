export type DateBucket = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'older' | 'no_date'

export const BUCKET_ORDER: DateBucket[] = ['today', 'yesterday', 'this_week', 'this_month', 'older', 'no_date']

export const BUCKET_LABELS: Record<DateBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'Earlier this week',
  this_month: 'Earlier this month',
  older: 'Older',
  no_date: 'No date',
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  const start = startOfDay(d)
  start.setDate(start.getDate() - daysSinceMonday)
  return start
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function getDateBucket(iso: string | null, now: Date = new Date()): DateBucket {
  if (!iso) return 'no_date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'no_date'

  const day = startOfDay(d)
  const today = startOfDay(now)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const weekStart = startOfWeek(now)
  const monthStart = startOfMonth(now)

  if (day.getTime() === today.getTime()) return 'today'
  if (day.getTime() === yesterday.getTime()) return 'yesterday'
  if (day.getTime() >= weekStart.getTime()) return 'this_week'
  if (day.getTime() >= monthStart.getTime()) return 'this_month'
  return 'older'
}
