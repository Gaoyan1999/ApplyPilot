import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  // Popover is portaled to <body> to escape .jobs-table-wrap's overflow-x:
  // auto clipping, so its position has to be computed in viewport
  // coordinates instead of relying on CSS position: absolute.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    function updatePosition() {
      const rect = buttonRef.current!.getBoundingClientRect()
      const popoverWidth = popoverRef.current?.offsetWidth ?? 180
      const left = Math.min(rect.left, window.innerWidth - popoverWidth - 8)
      setPosition({ top: rect.bottom + 6, left: Math.max(8, left) })
    }
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
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
        ref={buttonRef}
        type="button"
        className={`user-action-select${localValue ? ` ${CLASS_BY_USER_ACTION[localValue]}` : ' user-action-select-empty'}`}
        onClick={() => setOpen((v) => !v)}
      >
        {localValue ? LABEL_BY_USER_ACTION[localValue] : 'Mark as…'}
      </button>
      {open &&
        createPortal(
          <div
            className="user-action-popover user-action-popover-portal"
            ref={popoverRef}
            style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
          >
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
          </div>,
          document.body,
        )}
    </div>
  )
}
