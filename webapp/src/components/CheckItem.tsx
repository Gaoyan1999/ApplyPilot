import type { ReactNode } from 'react'

export type CheckState = 'ok' | 'warn' | 'error' | 'pending'

const STATE_LABEL: Record<CheckState, string> = {
  ok: 'OK',
  warn: 'Missing',
  error: 'Failed',
  pending: 'Checking',
}

function StatusIcon({ state }: { state: CheckState }) {
  return (
    <span className={`check-icon ${state}`} role="img" aria-label={STATE_LABEL[state]} title={STATE_LABEL[state]}>
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {state === 'pending' ? (
          <circle cx="10" cy="10" r="7" strokeDasharray="30 14" />
        ) : (
          <>
            <circle cx="10" cy="10" r="8" />
            {state === 'ok' && <path d="M6.5 10.2l2.3 2.3 4.7-4.9" />}
            {state === 'warn' && <path d="M10 6v4.5M10 13.6v.1" />}
            {state === 'error' && <path d="M7.4 7.4l5.2 5.2M12.6 7.4l-5.2 5.2" />}
          </>
        )}
      </svg>
    </span>
  )
}

interface Props {
  label: string
  /** Short explanation under the label -- what it's for / how to fix it. */
  hint?: ReactNode
  state: CheckState
  /** Optional buttons shown just left of the status icon. */
  actions?: ReactNode
}

/** One setup check row: label (and hint) on the left, status icon on the right. */
export function CheckItem({ label, hint, state, actions }: Props) {
  return (
    <li className="check-item">
      <div className="check-item-text">
        <span className="check-item-label">{label}</span>
        {hint && <span className="check-item-hint">{hint}</span>}
      </div>
      {actions && <div className="check-item-actions">{actions}</div>}
      <StatusIcon state={state} />
    </li>
  )
}
