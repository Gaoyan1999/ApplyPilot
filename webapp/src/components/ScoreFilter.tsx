import { useEffect, useRef, useState } from 'react'

interface Props {
  min: number | null
  max: number | null
  onChange: (min: number | null, max: number | null) => void
}

const SCORE_MIN = 1
const SCORE_MAX = 10

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
  const lo = min ?? SCORE_MIN
  const hi = max ?? SCORE_MAX
  const summary = !active ? 'Score' : lo === hi ? `${lo}` : `${lo} – ${hi}`

  function handleLoChange(value: number) {
    const clamped = Math.min(value, hi)
    onChange(clamped === SCORE_MIN ? null : clamped, max)
  }

  function handleHiChange(value: number) {
    const clamped = Math.max(value, lo)
    onChange(min, clamped === SCORE_MAX ? null : clamped)
  }

  const loPct = ((lo - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 100
  const hiPct = ((hi - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 100

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
          <div className="score-range-labels">
            <span>{lo}</span>
            <span>{hi}</span>
          </div>
          <div className="score-range-slider">
            <div className="score-range-track" />
            <div className="score-range-track-fill" style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }} />
            <input
              type="range"
              className="score-range-thumb"
              min={SCORE_MIN}
              max={SCORE_MAX}
              step={1}
              value={lo}
              onChange={(e) => handleLoChange(Number(e.target.value))}
            />
            <input
              type="range"
              className="score-range-thumb"
              min={SCORE_MIN}
              max={SCORE_MAX}
              step={1}
              value={hi}
              onChange={(e) => handleHiChange(Number(e.target.value))}
            />
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
