import { useEffect, useState } from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import type { UserAction } from '../api/types'
import { CLASS_BY_USER_ACTION, LABEL_BY_USER_ACTION } from './UserActionBadge'
import { USER_ACTION_ORDER } from './userActionOrder'

interface Props {
  value: UserAction | null
  onChange: (value: UserAction | null) => void
  dismissed?: boolean
  onDismissChange?: (dismissed: boolean) => void
}

export function UserActionSelect({ value, onChange, dismissed = false, onDismissChange }: Props) {
  const [open, setOpen] = useState(false)
  // Local state gives immediate visual feedback on select; re-synced whenever
  // the server value changes (e.g. the next poll confirms or reverts it).
  const [localValue, setLocalValue] = useState(value)
  const [localDismissed, setLocalDismissed] = useState(dismissed)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  useEffect(() => {
    setLocalDismissed(dismissed)
  }, [dismissed])

  // Floating UI handles the parts that used to be hand-rolled here: it flips
  // the popover above the trigger when there's no room below (previously it
  // always opened downward and could render clipped off the bottom of the
  // viewport), shifts it to stay within the horizontal viewport, and keeps
  // position in sync on scroll/resize via autoUpdate -- all while staying
  // portaled to <body> to escape .jobs-table-wrap's overflow-x: auto.
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'listbox' }),
  ])

  function select(next: UserAction | null) {
    setLocalValue(next)
    onChange(next)
    setOpen(false)
  }

  function toggleDismissed() {
    const next = !localDismissed
    setLocalDismissed(next)
    onDismissChange?.(next)
    setOpen(false)
  }

  return (
    <div className="user-action-selector">
      <button
        ref={refs.setReference}
        type="button"
        className={
          localDismissed
            ? 'user-action-select user-action-not_for_me'
            : `user-action-select${localValue ? ` ${CLASS_BY_USER_ACTION[localValue]}` : ' user-action-select-empty'}`
        }
        {...getReferenceProps()}
      >
        {localDismissed ? 'Not for me' : localValue ? LABEL_BY_USER_ACTION[localValue] : 'Mark as…'}
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="user-action-popover user-action-popover-portal"
            {...getFloatingProps()}
          >
            <button
              type="button"
              className={`user-action-option${localValue === null ? ' user-action-option-selected' : ''}`}
              onClick={() => select(null)}
            >
              <span className="user-action-empty">— None</span>
            </button>
            {onDismissChange && (
              <button
                type="button"
                className={`user-action-option${localDismissed ? ' user-action-option-selected' : ''}`}
                onClick={toggleDismissed}
              >
                <span className="user-action-badge user-action-not_for_me">
                  {localDismissed ? 'Restore' : 'Not for me'}
                </span>
              </button>
            )}
            <div className="user-action-option-divider" />
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
        </FloatingPortal>
      )}
    </div>
  )
}
