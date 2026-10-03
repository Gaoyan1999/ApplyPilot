import { useState, type ClipboardEvent, type KeyboardEvent } from 'react'

interface Props {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
}

/** Editable list of short strings shown as removable chips. Enter or comma
 * adds, Backspace on an empty input removes the last one, and pasting
 * multi-line text adds each line. Duplicates (case-insensitive) are skipped. */
export function TagInput({ values, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState('')

  function add(raw: string[]) {
    const seen = new Set(values.map((v) => v.toLowerCase()))
    const next = [...values]
    for (const item of raw.map((r) => r.trim()).filter(Boolean)) {
      if (seen.has(item.toLowerCase())) continue
      seen.add(item.toLowerCase())
      next.push(item)
    }
    if (next.length !== values.length) onChange(next)
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add([draft])
    } else if (e.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!/[\n,]/.test(text)) return
    e.preventDefault()
    add(text.split(/[\n,]/))
  }

  return (
    <div className="tag-input">
      {values.map((v) => (
        <span key={v} className="tag-chip">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={values.length === 0 ? placeholder : 'Add…'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => draft.trim() && add([draft])}
        aria-label={placeholder ?? 'Add item'}
      />
    </div>
  )
}
