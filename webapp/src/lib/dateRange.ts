// Local calendar dates as 'YYYY-MM-DD' keys -- comparable/sortable as
// strings and safe to send straight through as day-granularity API params.
export type DateKey = string

export function toDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseDateKey(key: DateKey): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}

function startOfWeek(d: Date): Date {
  // Monday-first week, matching the calendar grid below.
  const day = (d.getDay() + 6) % 7
  return addDays(d, -day)
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

export interface DateRange {
  from: DateKey
  to: DateKey
}

export interface DatePreset {
  label: string
  range: (today: Date) => DateRange
}

export const DATE_PRESETS: DatePreset[] = [
  { label: 'Today', range: (t) => ({ from: toDateKey(t), to: toDateKey(t) }) },
  { label: 'Yesterday', range: (t) => ({ from: toDateKey(addDays(t, -1)), to: toDateKey(addDays(t, -1)) }) },
  { label: 'This week', range: (t) => ({ from: toDateKey(startOfWeek(t)), to: toDateKey(t) }) },
  {
    label: 'Last week',
    range: (t) => {
      const start = addDays(startOfWeek(t), -7)
      return { from: toDateKey(start), to: toDateKey(addDays(start, 6)) }
    },
  },
  { label: 'Last 7 days', range: (t) => ({ from: toDateKey(addDays(t, -6)), to: toDateKey(t) }) },
  { label: 'This month', range: (t) => ({ from: toDateKey(startOfMonth(t)), to: toDateKey(t) }) },
  {
    label: 'Last month',
    range: (t) => {
      const lastMonthEnd = addDays(startOfMonth(t), -1)
      return { from: toDateKey(startOfMonth(lastMonthEnd)), to: toDateKey(endOfMonth(lastMonthEnd)) }
    },
  },
]

/** Cells for a Monday-first calendar month grid, including the leading/trailing days needed to fill whole weeks. */
export function monthGridDays(monthAnchor: Date): { date: Date; inMonth: boolean }[] {
  const first = startOfMonth(monthAnchor)
  const last = endOfMonth(monthAnchor)
  const gridStart = startOfWeek(first)
  const days: { date: Date; inMonth: boolean }[] = []
  let cursor = gridStart
  while (cursor <= last || days.length % 7 !== 0) {
    days.push({ date: cursor, inMonth: cursor.getMonth() === monthAnchor.getMonth() })
    cursor = addDays(cursor, 1)
    if (days.length > 42) break // safety net, should never trigger (6 full weeks max)
  }
  return days
}
