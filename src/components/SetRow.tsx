import type { SetLog, Target } from '../types'
import NumInput from './NumInput'
import SetNote from './SetNote'
import AmrapHint from './AmrapHint'
import { setSummary, stepValue } from './todayLogic'
import './SetRow.css'

interface Props {
  /** 0 始まり */
  index: number
  set: SetLog
  target: Target | undefined
  /** 重量の刻み */
  increment: number
  /** 今のセット（最初の未完了セット）。常に展開し、閉じられない */
  active: boolean
  expanded: boolean
  /** 「余力（あと何回できた？）」の説明をこの行に出す（カードの最初の展開セットだけ） */
  showRirHelp: boolean
  onToggleExpand: () => void
  onChange: (patch: Partial<SetLog>) => void
  onToggleDone: () => void
}

function Stepper({ value, step, mode, label, unit, onChange }: {
  value: number
  step: number
  mode: 'decimal' | 'numeric'
  label: string
  unit: string
  onChange: (n: number) => void
}) {
  return (
    <div className="stepper">
      <button type="button" className="stepper-btn" aria-label={`${label}を減らす`} onClick={() => onChange(stepValue(value, -step))}>−</button>
      <NumInput mode={mode} step={step} label={label} placeholder={unit} value={value} className="stepper-input" onChange={onChange} />
      <button type="button" className="stepper-btn" aria-label={`${label}を増やす`} onClick={() => onChange(stepValue(value, step))}>＋</button>
      <span className="stepper-unit">{unit}</span>
    </div>
  )
}

/** 1セット分の表示。今のセットと展開中のセットは入力欄つき、それ以外は1行 */
export default function SetRow({ index, set: s, target, increment, active, expanded, showRirHelp, onToggleExpand, onChange, onToggleDone }: Props) {
  const no = index + 1
  const open = active || expanded
  const state = s.done ? 'done' : active ? 'active' : 'pending'

  const summary = (
    <>
      <span className="setrow-no">{s.done ? `✓ ${no}` : no}</span>
      <span className="setrow-text">{setSummary(s)}</span>
      {s.done && typeof s.rir === 'number' && <span className="setrow-meta">余力{s.rir}</span>}
      {s.note && <span className="setrow-meta">メモ</span>}
    </>
  )

  return (
    <div className={`setrow setrow-${state}${open ? ' setrow-open' : ''}`} data-set-key={active ? 'active' : undefined}>
      {active ? (
        <div className="setrow-head setrow-head-active">
          <span className="setrow-no">{no}</span>
          <span className="setrow-text">{no}セット目</span>
        </div>
      ) : (
        <button type="button" className="setrow-head" aria-expanded={open} onClick={onToggleExpand}>
          {summary}
          <span className="setrow-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
      )}

      {open && (
        <div className="setrow-body">
          <Stepper
            mode="decimal"
            step={increment}
            label={`${no}セット目の重量`}
            unit="kg"
            value={s.weight}
            onChange={n => onChange({ weight: n })}
          />
          <Stepper
            mode="numeric"
            step={1}
            label={`${no}セット目のレップ`}
            unit="回"
            value={s.reps}
            onChange={n => onChange({ reps: Math.floor(n) })}
          />
          <div className="setrow-rirwrap">
            {showRirHelp && <p className="setrow-help">余力（あと何回できた？）</p>}
            <div className="setrow-rir" role="group" aria-label={`${no}セット目の余力（RIR）`}>
              {[0, 1, 2, 3, 4, 5].map(r => (
                <button
                  key={r}
                  type="button"
                  className="setrow-rirbtn"
                  aria-pressed={s.rir === r}
                  onClick={() => onChange({ rir: s.rir === r ? undefined : r })}
                >
                  {r === 5 ? '5+' : r}
                </button>
              ))}
            </div>
          </div>
          <AmrapHint set={s} target={target} />
          <SetNote value={s.note} label={`${no}セット目のメモ`} onChange={note => onChange({ note })} />
          {s.done ? (
            <div className="setrow-actions">
              <button type="button" className="setrow-sub" onClick={onToggleDone}>完了を取り消す</button>
              <button type="button" className="setrow-sub" onClick={onToggleExpand}>閉じる</button>
            </div>
          ) : (
            <button type="button" className="setrow-donebtn" aria-label={`${no}セット目を完了`} onClick={onToggleDone}>✓ 完了</button>
          )}
        </div>
      )}
    </div>
  )
}
