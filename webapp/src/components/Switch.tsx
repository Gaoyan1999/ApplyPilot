interface Props {
  checked: boolean
  onChange: () => void
  label: string
}

export function Switch({ checked, onChange, label }: Props) {
  return (
    <label className="switch-row">
      <span className="switch-label">{label}</span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="switch-track" />
      </span>
    </label>
  )
}
