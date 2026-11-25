import './ToolChips.css'

export interface ToolChip {
  key: string
  label: string
}

interface Props {
  items: ToolChip[]
  /** いま開いているチップ（なければ null）。同時に開くのは1つだけ */
  openKey: string | null
  onToggle: (key: string) => void
  /** 中身の要素の id を作る元（aria-controls 用） */
  idPrefix: string
}

/** 補助機能のチップ。中身は親がチップ列の下に出す */
export default function ToolChips({ items, openKey, onToggle, idPrefix }: Props) {
  if (items.length === 0) return null
  return (
    <div className="tool-chips">
      {items.map(c => {
        const open = openKey === c.key
        return (
          <button
            key={c.key}
            type="button"
            className="tool-chip"
            aria-expanded={open}
            aria-controls={`${idPrefix}-${c.key}`}
            onClick={() => onToggle(c.key)}
          >
            {c.label} <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
        )
      })}
    </div>
  )
}
