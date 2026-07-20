import { useEffect, useRef, useState } from 'react'
import { DATE_PRESETS, monthGridDays, parseDateKey, toDateKey, type DateKey } from '../lib/dateRange'

interface Props {
  from: DateKey | null
  to: DateKey | null
  onChange: (from: DateKey | null, to: DateKey | null) => void
}

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function formatShort(key: DateKey): string {
  return parseDateKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function DateRangeFilter({ from, to, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => (from ? parseDateKey(from) : new Date()))
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function pickDay(key: DateKey) {
    if (!from || (from && to)) {
      // Nothing selected yet, or a full range already picked -- start fresh.
      onChange(key, null)
    } else if (key < from) {
      onChange(key, from)
    } else {
      onChange(from, key)
    }
  }

  function applyPreset(range: { from: DateKey; to: DateKey }) {
    onChange(range.from, range.to)
    setViewMonth(parseDateKey(range.from))
    setOpen(false)
  }

  const active = Boolean(from || to)
  const summary = !active
    ? 'Discovered'
    : from && to && from !== to
      ? `${formatShort(from)} – ${formatShort(to)}`
      : formatShort(from ?? to!)

  const days = monthGridDays(viewMonth)
  const today = toDateKey(new Date())

  return (
    <div className="multi-select" ref={containerRef}>
      <button
        type="button"
        className={`filter-pill${active ? ' filter-pill-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {summary}
      </button>
      {open && (
        <div className="multi-select-popover date-range-popover">
          <div className="date-range-body">
            <div className="date-range-presets">
              {DATE_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.label}
                  className="date-range-preset"
                  onClick={() => applyPreset(preset.range(new Date()))}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className="date-range-preset"
                disabled={!active}
                onClick={() => {
                  onChange(null, null)
                  setOpen(false)
                }}
              >
                All time
              </button>
            </div>
            <div className="date-range-calendar">
              <div className="date-range-calendar-nav">
                <button
                  type="button"
                  className="date-range-nav-button"
                  onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                  aria-label="Previous month"
                >
                  ‹
                </button>
                <span className="date-range-month-label">
                  {viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
                <button
                  type="button"
                  className="date-range-nav-button"
                  onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
              <div className="date-range-weekdays">
                {WEEKDAY_LABELS.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="date-range-days">
                {days.map(({ date, inMonth }) => {
                  const key = toDateKey(date)
                  const isFrom = key === from
                  const isTo = key === to
                  const inRange = Boolean(from && to && key > from && key < to)
                  const classNames = [
                    'date-range-day',
                    !inMonth && 'date-range-day-outside',
                    key === today && 'date-range-day-today',
                    (isFrom || isTo) && 'date-range-day-endpoint',
                    inRange && 'date-range-day-inrange',
                  ]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <button type="button" key={key} className={classNames} onClick={() => pickDay(key)}>
                      {date.getDate()}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
