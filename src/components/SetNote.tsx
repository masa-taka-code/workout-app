import { useRef, useState } from 'react'
import { NOTE_CHIPS, NOTE_MAX, appendChip, normalizeNote } from './noteText'
import './SetNote.css'

interface Props {
  value: string | undefined
  onChange: (note: string | undefined) => void
  /** 読み上げ用（例「1セット目のメモ」） */
  label: string
}

export default function SetNote({ value, onChange, label }: Props) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // 確定の二重実行（Enter 後のフォーカス外れなど）を防ぐ
  const doneRef = useRef(false)

  const start = () => {
    doneRef.current = false
    setText(value ?? '')
    setEditing(true)
  }

  const commit = () => {
    if (doneRef.current) return
    doneRef.current = true
    setEditing(false)
    const next = normalizeNote(text)
    if (next !== value) onChange(next)
  }

  if (!editing) {
    return value ? (
      <button type="button" className="btn btn-ghost set-note-view" aria-label={`${label}を編集`} onClick={start}>
        <span className="set-note-text small">{value}</span>
      </button>
    ) : (
      <button type="button" className="btn btn-ghost set-note-add small" onClick={start}>
        ＋ メモ
      </button>
    )
  }

  return (
    <div className="set-note-edit">
      <div className="set-note-row">
        <input
          ref={inputRef}
          type="text"
          className="set-note-input"
          aria-label={label}
          maxLength={NOTE_MAX}
          value={text}
          autoFocus
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              commit()
            }
          }}
          onBlur={e => {
            // チップや「完了」を押した場合はそちらで処理する
            if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.dataset.noteAction) return
            commit()
          }}
        />
        <button type="button" className="btn" data-note-action="done" onClick={commit}>完了</button>
      </div>
      <div className="set-note-chips">
        {NOTE_CHIPS.map(chip => (
          <button
            key={chip}
            type="button"
            className="btn btn-ghost set-note-chip small"
            data-note-action="chip"
            onClick={() => {
              setText(t => appendChip(t, chip))
              inputRef.current?.focus()
            }}
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  )
}
