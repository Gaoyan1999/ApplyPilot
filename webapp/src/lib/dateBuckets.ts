export type DateGroupKey = string // 'YYYY-MM-DD' or 'no_date'

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getDateGroupKey(iso: string | null): DateGroupKey {
  if (!iso) return 'no_date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'no_date'
  return toDateKey(d)
}

export function formatDateGroupLabel(key: DateGroupKey, now: Date = new Date()): string {
  if (key === 'no_date') return 'No date'

  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const today = startOfDay(now)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.getTime() === today.getTime()) return 'Today'
  if (date.getTime() === yesterday.getTime()) return 'Yesterday'

  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`
}

export function compareDateGroupKeysDesc(a: DateGroupKey, b: DateGroupKey): number {
  if (a === b) return 0
  if (a === 'no_date') return 1
  if (b === 'no_date') return -1
  return a < b ? 1 : -1
}
