import { useEffect, useState } from 'react'
import type { UserAction } from '../api/types'
import { CLASS_BY_USER_ACTION, LABEL_BY_USER_ACTION } from './UserActionBadge'
import { USER_ACTION_ORDER } from './userActionOrder'

interface Props {
  value: UserAction | null
  onChange: (value: UserAction | null) => void
}

export function UserActionSelect({ value, onChange }: Props) {
  // Local state gives immediate visual feedback on select; re-synced whenever
  // the server value changes (e.g. the next poll confirms or reverts it).
  const [localValue, setLocalValue] = useState(value)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  return (
    <label
      className={`user-action-select${localValue ? ` ${CLASS_BY_USER_ACTION[localValue]}` : ' user-action-select-empty'}`}
    >
      <select
        value={localValue ?? ''}
        onChange={(e) => {
          const next = (e.target.value || null) as UserAction | null
          setLocalValue(next)
          onChange(next)
        }}
      >
        <option value="">—</option>
        {USER_ACTION_ORDER.map((action) => (
          <option key={action} value={action}>
            {LABEL_BY_USER_ACTION[action]}
          </option>
        ))}
      </select>
    </label>
  )
}
