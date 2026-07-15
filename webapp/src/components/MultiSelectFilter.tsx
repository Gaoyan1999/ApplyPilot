import { useEffect, useRef, useState } from 'react'

export type FilterMode = 'is' | 'is not'

export interface MultiSelectOption<T extends string> {
  value: T
  label: string
  colorClassName?: string
}

interface Props<T extends string> {
  label: string
  options: MultiSelectOption<T>[]
  selected: T[]
  onChange: (values: T[]) => void
  mode: FilterMode
  onModeChange: (mode: FilterMode) => void
}

export function MultiSelectFilter<T extends string>({
  label,
  options,
  selected,
  onChange,
  mode,
  onModeChange,
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
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

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(query.trim().toLowerCase()),
  )

  function toggleValue(value: T) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const modePrefix = mode === 'is not' ? 'Not ' : ''
  const summary =
    selected.length === 0
      ? label
      : selected.length === 1
        ? `${modePrefix}${options.find((o) => o.value === selected[0])?.label ?? label}`
        : `${modePrefix}${label} (${selected.length})`

  return (
    <div className="multi-select" ref={containerRef}>
      <button
        type="button"
        className={`filter-pill${selected.length > 0 ? ' filter-pill-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {summary}
      </button>
      {open && (
        <div className="multi-select-popover">
          <div className="multi-select-header">
            <span className="multi-select-header-label">{label}</span>
            <button
              type="button"
              className="multi-select-mode-toggle"
              onClick={() => onModeChange(mode === 'is' ? 'is not' : 'is')}
            >
              {mode}
            </button>
          </div>
          <input
            type="text"
            autoFocus
            className="multi-select-search"
            placeholder="Select one or more options..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="multi-select-options">
            {filteredOptions.length === 0 && <div className="multi-select-empty">No options</div>}
            {filteredOptions.map((opt) => (
              <label key={opt.value} className="multi-select-option">
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggleValue(opt.value)}
                />
                <span
                  className={`multi-select-option-badge${opt.colorClassName ? ` ${opt.colorClassName}` : ''}`}
                >
                  {opt.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
