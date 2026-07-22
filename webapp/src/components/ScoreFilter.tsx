import { useEffect, useRef, useState } from 'react'

interface Props {
  min: number | null
  max: number | null
  onChange: (min: number | null, max: number | null) => void
}

function parseInput(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function ScoreFilter({ min, max, onChange }: Props) {
  const [open, setOpen] = useState(false)
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

  const active = min !== null || max !== null
  const summary = !active
    ? 'Score'
    : min !== null && max !== null
      ? `${min} – ${max}`
      : min !== null
        ? `≥ ${min}`
        : `≤ ${max}`

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
        <div className="multi-select-popover score-range-popover">
          <div className="score-range-body">
            <label className="score-range-field">
              Min
              <input
                type="number"
                className="score-range-input"
                value={min ?? ''}
                onChange={(e) => onChange(parseInput(e.target.value), max)}
                placeholder="Any"
              />
            </label>
            <label className="score-range-field">
              Max
              <input
                type="number"
                className="score-range-input"
                value={max ?? ''}
                onChange={(e) => onChange(min, parseInput(e.target.value))}
                placeholder="Any"
              />
            </label>
          </div>
          <button
            type="button"
            className="date-range-preset"
            disabled={!active}
            onClick={() => onChange(null, null)}
          >
            All scores
          </button>
        </div>
      )}
    </div>
  )
}
