import type { Exercise, Target } from '../types'
import './TargetBlock.css'

interface Props {
  ex: Exercise
  target: Target
  /** 「前回 …」の文字（なければ省略） */
  previous?: string
}

const num = (n: number) => String(Math.round(n * 100) / 100)

/** 今日の目標。理由は畳み、注意は表に出す */
export default function TargetBlock({ ex, target: t, previous }: Props) {
  const deload = t.kind === 'deload'
  const rirText = t.rir === 0 ? '限界まで（RIR 0）' : `あと${t.rir}回残す（RIR ${t.rir}）`
  return (
    <div className="target-wrap">
      <div className={`target-block${deload ? ' target-block-deload' : ''}`}>
        <div className="target-label">
          <span>今日の目標</span>
          {deload && <span className="target-badge">回復の回</span>}
        </div>
        {t.kind === 'first' ? (
          <p className="target-first">{ex.repMin}〜{ex.repMax}回で、あと{t.rir}回残せる重量を探す</p>
        ) : (
          <p className="target-main">
            <span className="target-nowrap">{num(t.weight)}kg × {t.reps}回</span>{' '}
            <span className="target-nowrap">× {t.sets}セット</span>
          </p>
        )}
        {t.kind !== 'first' && <p className="target-rir">{rirText}</p>}
        {previous && <p className="target-prev">前回 {previous}</p>}
        <details className="target-why">
          <summary>なぜこの目標？</summary>
          <p>{t.reason}</p>
        </details>
      </div>
      {t.caution && <p className="target-caution-line">{t.caution}</p>}
    </div>
  )
}
