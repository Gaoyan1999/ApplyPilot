import { useEffect, useRef, useState } from 'react'
import type { UserAction } from '../api/types'
import { CLASS_BY_USER_ACTION, LABEL_BY_USER_ACTION } from './UserActionBadge'
import { USER_ACTION_ORDER } from './userActionOrder'

interface Props {
  value: UserAction | null
  onChange: (value: UserAction | null) => void
}

export function UserActionSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  // Local state gives immediate visual feedback on select; re-synced whenever
  // the server value changes (e.g. the next poll confirms or reverts it).
  const [localValue, setLocalValue] = useState(value)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

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

  function select(next: UserAction | null) {
    setLocalValue(next)
    onChange(next)
    setOpen(false)
  }

  return (
    <div className="user-action-selector" ref={containerRef}>
      <button
        type="button"
        className={`user-action-select${localValue ? ` ${CLASS_BY_USER_ACTION[localValue]}` : ' user-action-select-empty'}`}
        onClick={() => setOpen((v) => !v)}
      >
        {localValue ? LABEL_BY_USER_ACTION[localValue] : 'Mark as…'}
      </button>
      {open && (
        <div className="user-action-popover">
          <button
            type="button"
            className={`user-action-option${localValue === null ? ' user-action-option-selected' : ''}`}
            onClick={() => select(null)}
          >
            <span className="user-action-empty">— None</span>
          </button>
          {USER_ACTION_ORDER.map((action) => (
            <button
              key={action}
              type="button"
              className={`user-action-option${localValue === action ? ' user-action-option-selected' : ''}`}
              onClick={() => select(action)}
            >
              <span className={`user-action-badge ${CLASS_BY_USER_ACTION[action]}`}>
                {LABEL_BY_USER_ACTION[action]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
