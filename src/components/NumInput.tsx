import { useState } from 'react'

const parse = (s: string): number => {
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

interface Props {
  value: number
  onChange: (n: number) => void
  mode: 'decimal' | 'numeric'
  step?: number
  label: string
  placeholder?: string
}

/** 数値入力。入力途中の「62.」などを壊さないよう文字列を保持し、不正値は 0 にする。0 は空欄表示 */
export default function NumInput({ value, onChange, mode, step, label, placeholder }: Props) {
  const [text, setText] = useState(value ? String(value) : '')
  const shown = parse(text) === value ? text : value ? String(value) : ''
  return (
    <input
      type="number"
      inputMode={mode}
      step={step ?? 1}
      min={0}
      aria-label={label}
      placeholder={placeholder}
      value={shown}
      onChange={e => {
        setText(e.target.value)
        onChange(parse(e.target.value))
      }}
    />
  )
}
