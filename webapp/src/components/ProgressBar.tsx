interface Props {
  done: number
  total: number
  label?: string
}

export function ProgressBar({ done, total, label }: Props) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0

  return (
    <div className="progress-bar-row">
      {label && <span className="progress-bar-label">{label}</span>}
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-bar-count">
        {done}/{total}
      </span>
    </div>
  )
}
