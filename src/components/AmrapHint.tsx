import type { SetLog, Target } from '../types'
import './AmrapHint.css'

interface Props {
  set: SetLog
  target: Target | undefined
}

/** 限界テストのセットの説明と、終わったあとの答え合わせ */
export default function AmrapHint({ set, target }: Props) {
  if (!set.amrap) return null
  const reps = target ? `${target.reps}回` : '目標回数'
  const hasResult = set.done && typeof set.rir === 'number' && target !== undefined
  const actual = hasResult ? set.reps - target.reps : 0
  return (
    <div className="amrap-hint">
      <p>
        限界テスト：{reps}の時点で『あと何回できそうか』を RIR に入れ、そのまま限界まで続けて、回数欄には合計回数を入れてください。安全に止められる範囲で。
      </p>
      {hasResult && (
        <p className="amrap-hint-result">
          答え合わせ：予測 RIR {set.rir} → 実際 {actual}（{actual - (set.rir as number) >= 0 ? '+' : ''}{actual - (set.rir as number)}）
        </p>
      )}
    </div>
  )
}
