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
import { APPLICATION_STATUS_ACTIONS, USER_ACTION_ORDER } from './userActionOrder'

interface Props {
  value: UserAction | null
  onChange: (value: UserAction | null) => void
}

export function UserActionSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  // Local state gives immediate visual feedback on select; re-synced whenever
  // the server value changes (e.g. the next poll confirms or reverts it).
  const [localValue, setLocalValue] = useState(value)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

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

  return (
    <div className="user-action-selector">
      <button
        ref={refs.setReference}
        type="button"
        className={`user-action-select${localValue ? ` ${CLASS_BY_USER_ACTION[localValue]}` : ' user-action-select-empty'}`}
        {...getReferenceProps()}
      >
        {localValue ? LABEL_BY_USER_ACTION[localValue] : 'Mark as…'}
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
            {USER_ACTION_ORDER.map((action, i) => (
              <div key={action}>
                {APPLICATION_STATUS_ACTIONS[0] === action && i > 0 && (
                  <div className="user-action-option-divider" />
                )}
                <button
                  type="button"
                  className={`user-action-option${localValue === action ? ' user-action-option-selected' : ''}`}
                  onClick={() => select(action)}
                >
                  <span className={`user-action-badge ${CLASS_BY_USER_ACTION[action]}`}>
                    {LABEL_BY_USER_ACTION[action]}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </FloatingPortal>
      )}
    </div>
  )
}
