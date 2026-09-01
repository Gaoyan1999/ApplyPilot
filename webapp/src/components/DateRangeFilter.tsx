import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DATE_PRESETS, monthGridDays, parseDateKey, toDateKey, type DateKey } from '../lib/dateRange'

interface Props {
  from: DateKey | null
  to: DateKey | null
  onChange: (from: DateKey | null, to: DateKey | null) => void
  // Hides the "All time" preset for callers that always need a bounded
  // range (e.g. a scan that has to check *some* date span) -- true (shows
  // it) for the default open-ended filter-bar use.
  allowClear?: boolean
}

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function formatShort(key: DateKey): string {
  return parseDateKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function DateRangeFilter({ from, to, onChange, allowClear = true }: Props) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => (from ? parseDateKey(from) : new Date()))
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // The popover portals to document.body (see render below) so it isn't
  // clipped when this filter is used inside an `overflow: hidden` container
  // like a modal -- position is tracked in viewport coordinates (`position:
  // fixed`) instead of relying on CSS being a positioned ancestor.
  useEffect(() => {
    if (!open) return
    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setPosition({ top: rect.bottom + 6, left: rect.left })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
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
  const now = new Date()
  const today = toDateKey(now)
  const isCurrentOrFutureViewMonth =
    viewMonth.getFullYear() > now.getFullYear() ||
    (viewMonth.getFullYear() === now.getFullYear() && viewMonth.getMonth() >= now.getMonth())

  return (
    <div className="multi-select">
      <button
        type="button"
        ref={triggerRef}
        className={`filter-pill${active ? ' filter-pill-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {summary}
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            className="multi-select-popover date-range-popover"
            style={{ position: 'fixed', top: position.top, left: position.left }}
          >
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
                {allowClear && (
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
                )}
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
                    disabled={isCurrentOrFutureViewMonth}
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
                    const isFuture = key > today
                    const isFrom = key === from
                    const isTo = key === to
                    const inRange = Boolean(from && to && key > from && key < to)
                    const classNames = [
                      'date-range-day',
                      !inMonth && 'date-range-day-outside',
                      key === today && 'date-range-day-today',
                      (isFrom || isTo) && 'date-range-day-endpoint',
                      inRange && 'date-range-day-inrange',
                      isFuture && 'date-range-day-disabled',
                    ]
                      .filter(Boolean)
                      .join(' ')
                    return (
                      <button
                        type="button"
                        key={key}
                        className={classNames}
                        disabled={isFuture}
                        onClick={() => pickDay(key)}
                      >
                        {date.getDate()}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
