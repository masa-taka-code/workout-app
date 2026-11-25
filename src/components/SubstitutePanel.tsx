import { useMemo } from 'react'
import type { AppData, Entry, Exercise } from '../types'
import { CATALOG, catalogToExercise } from '../catalog'
import { doneSets, localToday } from '../logic'
import { rotationHint, substitutes } from '../substitute'
import './SubstitutePanel.css'

/** 置き換え先。既存の種目ならそのもの、カタログ等の新しい種目なら id なし */
export type ReplaceWith = Exercise | Omit<Exercise, 'id'>

interface Props {
  ex: Exercise
  entry: Entry
  data: AppData
  onReplace: (next: ReplaceWith) => void
}

export default function SubstitutePanel({ ex, entry, data, onReplace }: Props) {
  const hint = useMemo(() => rotationHint(ex, data, localToday()), [ex, data])
  const list = useMemo(() => substitutes(ex, CATALOG, data.exercises), [ex, data.exercises])

  const replace = (item: Exercise | (typeof list)[number]['item']) => {
    if (doneSets(entry).length > 0 &&
      !window.confirm(`今日の${ex.name}を${item.name}に替えますか？入力済みの${ex.name}の記録は消えます`)) return
    onReplace('lengthened' in item ? catalogToExercise(item) : item)
  }

  return (
    <div className="substitute">
      {hint && <p className="substitute-hint">{hint.message}</p>}
      <details open={!!hint}>
        <summary>代わりの種目</summary>
        {list.length === 0 && <p className="muted">同じ主働筋の種目が見つかりません</p>}
        {list.map(({ item, reason }) => (
          <div key={item.name} className="substitute-row">
            <div className="substitute-text">
              <span className="substitute-name">{item.name}</span>
              <span className="muted">{reason}</span>
            </div>
            <button type="button" className="btn" onClick={() => replace(item)}>今日はこれに替える</button>
          </div>
        ))}
      </details>
    </div>
  )
}
