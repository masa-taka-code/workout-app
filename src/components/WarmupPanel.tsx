import type { Exercise, Target } from '../types'
import { formatPlates, platesPerSide, warmupSets } from '../warmup'
import './WarmupPanel.css'

interface Props {
  ex: Exercise
  target: Target
  /** true なら見出し（details）なしで中身だけ表示する */
  bare?: boolean
}

const side = (kg: number) => formatPlates(platesPerSide(kg))

export default function WarmupPanel({ ex, target, bare }: Props) {
  if (target.kind === 'first' || target.weight <= 0) return null
  const sets = warmupSets(target.weight, ex.equipment, ex.increment)
  const barbell = ex.equipment === 'barbell'
  if (sets.length === 0 && !barbell) return null

  const list = (
      <div className="warmup-list muted">
        {sets.map((s, i) => (
          <span key={i} className="warmup-line">
            {i + 1}. {s.weight}kg × {s.reps}
            {barbell && `　（片側 ${side(s.weight)}）`}
          </span>
        ))}
        {barbell && (
          <span className="warmup-line warmup-work">本番 {target.weight}kg：片側 {side(target.weight)}</span>
        )}
        <span className="small">休憩は短めで構いません。ウォームアップは疲れない程度に</span>
      </div>
  )
  if (bare) return <div className="warmup-bare">{list}</div>
  return (
    <details className="warmup">
      <summary>ウォームアップ・プレート</summary>
      {list}
    </details>
  )
}
