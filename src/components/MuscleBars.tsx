import type { Muscle } from '../types'
import { LEVEL_LABEL, barRatio, levelTone, muscleLevel } from './analysisView'
import './MuscleBars.css'

export interface MuscleBarItem {
  muscle: Muscle
  volume: number
  target: number
}

interface Props {
  items: MuscleBarItem[]
  /** 週が終わっているか（終わった週の不足だけ橙にする） */
  weekEnded: boolean
}

const num = (n: number) => String(Math.round(n * 10) / 10)

/** 筋肉ごとの週セット数：名前と ◎○△ の記号、横棒、「6 / 10」。色だけでなく記号と文字でも段階を伝える */
export default function MuscleBars({ items, weekEnded }: Props) {
  return (
    <ul className="mb-list">
      {items.map(m => {
        const level = muscleLevel(m.volume, m.target)
        const tone = levelTone(level, weekEnded)
        return (
          <li key={m.muscle} className="mb-row">
            <div className="mb-line1">
              <span className="mb-name">{m.muscle}</span>
              <span className={`mb-level mb-tone-${tone}`}>{LEVEL_LABEL[level]}</span>
            </div>
            <div className="mb-line2">
              <div className="mb-track" aria-hidden="true">
                <div className={`mb-fill mb-fill-${tone}`} style={{ width: `${barRatio(m.volume, m.target) * 100}%` }} />
              </div>
              <span className="mb-num">{num(m.volume)} / {num(m.target)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
