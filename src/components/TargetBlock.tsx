import type { Exercise, Target, TargetKind } from '../types'
import SetQuantity from './SetQuantity'
import './TargetBlock.css'

interface Props {
  ex: Exercise
  target: Target
}

const KIND_BADGE: Record<TargetKind, { text: string; className: string }> = {
  increase: { text: '↑ 重量アップ', className: 'target-kind-increase' },
  reps: { text: '回数を伸ばす', className: 'target-kind-reps' },
  deload: { text: '回復の回', className: 'target-kind-deload' },
  first: { text: '初回', className: 'target-kind-first' },
}

/** 今日の目標。理由は畳み、注意は表に出す（前回の値は各セット行に出す） */
export default function TargetBlock({ ex, target: t }: Props) {
  const rirText = t.rir === 0 ? '限界まで（RIR 0）' : `あと${t.rir}回残す（RIR ${t.rir}）`
  const badge = KIND_BADGE[t.kind]
  return (
    <div className="target-wrap">
      <div className="target-block">
        <div className="target-label">
          <span>今日の目標</span>
          <span className={`target-badge ${badge.className}`}>{badge.text}</span>
        </div>
        {t.kind === 'first' ? (
          <p className="target-first">{ex.repMin}〜{ex.repMax}回で、あと{t.rir}回残せる重量を探す</p>
        ) : (
          <p className="target-main">
            <span className="target-nowrap"><SetQuantity weight={t.weight} reps={t.reps} /></span>
            <span className="target-sets">× {t.sets}セット</span>
          </p>
        )}
        {t.kind !== 'first' && <p className="target-rir">{rirText}</p>}
        <details className="target-why">
          <summary>なぜこの目標？</summary>
          <p>{t.reason}</p>
        </details>
      </div>
      {t.caution && <p className="target-caution-line">{t.caution}</p>}
    </div>
  )
}
