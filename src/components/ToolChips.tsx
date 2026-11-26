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
  /** 1つだけを全幅で出す（セットの上に置く「アップ」用） */
  solo?: boolean
}

/** 補助機能のチップ。中身は親がチップ列の下に出す。開いたものは濃いグレー塗り＋✓ */
export default function ToolChips({ items, openKey, onToggle, idPrefix, solo = false }: Props) {
  if (items.length === 0) return null
  return (
    <div className={`tool-chips${solo ? ' tool-chips-solo' : ''}`}>
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
            {c.label}
            {solo && <span aria-hidden="true">{open ? ' ▾' : ' ▸'}</span>}
          </button>
        )
      })}
    </div>
  )
}
