import { useState } from 'react'
import type { Exercise } from '../types'
import { BODY_PARTS, EQUIPMENTS, MUSCLES } from '../types'
import NumInput from './NumInput'
import { cycleMuscle, normalizeDraft, validateExercise } from './exerciseValidation'
import type { ExerciseDraft } from './exerciseValidation'

const INCREMENTS = [0.5, 1, 1.25, 2.5, 5]
const RIRS = [0, 1, 2, 3, 4]

interface Props {
  initial: ExerciseDraft
  /** 自分以外の既存種目（同名チェック用） */
  others: Exercise[]
  onSave: (draft: ExerciseDraft) => void
  onCancel: () => void
  /** 編集時のみ。削除の確認は呼び出し側で行う */
  onDelete?: () => void
}

const Err = ({ msg }: { msg?: string }) => (msg ? <p className="ex-error" role="alert">{msg}</p> : null)

export default function ExerciseForm({ initial, others, onSave, onCancel, onDelete }: Props) {
  const [draft, setDraft] = useState<ExerciseDraft>(initial)
  const [errors, setErrors] = useState<ReturnType<typeof validateExercise>>({})
  const patch = (p: Partial<ExerciseDraft>) => setDraft(d => ({ ...d, ...p }))

  const submit = () => {
    const errs = validateExercise(draft, others)
    setErrors(errs)
    if (Object.keys(errs).length === 0) onSave(normalizeDraft(draft))
  }

  const roleOf = (m: (typeof MUSCLES)[number]) =>
    draft.primary.includes(m) ? '主' : draft.secondary.includes(m) ? '補助' : ''

  return (
    <div className="card ex-form">
      <label className="ex-field">
        <span className="ex-label">名前</span>
        <input type="text" value={draft.name} onChange={e => patch({ name: e.target.value })} placeholder="例：ベンチプレス" />
        <Err msg={errors.name} />
      </label>

      <div className="ex-field">
        <span className="ex-label">部位</span>
        <div className="ex-wrap">
          {BODY_PARTS.map(p => (
            <button key={p} type="button" className="btn" aria-pressed={draft.part === p} onClick={() => patch({ part: p })}>{p}</button>
          ))}
        </div>
        <Err msg={errors.part} />
      </div>

      <div className="ex-field">
        <span className="ex-label">器具</span>
        <div className="ex-wrap">
          {EQUIPMENTS.map(q => (
            <button key={q.value} type="button" className="btn" aria-pressed={draft.equipment === q.value} onClick={() => patch({ equipment: q.value })}>{q.label}</button>
          ))}
        </div>
        <p className="muted small">バーベルはプレート計算、バーベル・ダンベル・マシンはウォームアップを表示します</p>
      </div>

      <div className="ex-field">
        <span className="ex-label">レップ範囲（回）</span>
        <div className="ex-range">
          <NumInput value={draft.repMin} onChange={n => patch({ repMin: n })} mode="numeric" label="レップ下限" />
          <span>〜</span>
          <NumInput value={draft.repMax} onChange={n => patch({ repMax: n })} mode="numeric" label="レップ上限" />
        </div>
        <Err msg={errors.rep} />
      </div>

      <div className="ex-field">
        <span className="ex-label">重量の刻み（kg）</span>
        <div className="ex-wrap">
          {INCREMENTS.map(v => (
            <button key={v} type="button" className="btn" aria-pressed={draft.increment === v} onClick={() => patch({ increment: v })}>{v}</button>
          ))}
          <NumInput value={draft.increment} onChange={n => patch({ increment: n })} mode="decimal" step={0.25} label="刻み（任意の値）" />
        </div>
        <Err msg={errors.increment} />
      </div>

      <div className="ex-field">
        <span className="ex-label">標準セット数</span>
        <NumInput value={draft.sets} onChange={n => patch({ sets: n })} mode="numeric" label="標準セット数" />
        <Err msg={errors.sets} />
      </div>

      <div className="ex-field">
        <span className="ex-label">目標RIR（あと何回できる余力を残すか）</span>
        <div className="seg">
          {RIRS.map(r => (
            <button key={r} type="button" className="btn" aria-pressed={draft.targetRir === r} onClick={() => patch({ targetRir: r })}>{r}</button>
          ))}
        </div>
        <p className="muted small">多関節種目は1〜2、単関節種目は0〜1が目安</p>
        <Err msg={errors.targetRir} />
      </div>

      <div className="ex-field">
        <span className="ex-label">筋肉（タップで 主 → 補助 → なし）</span>
        <div className="ex-wrap">
          {MUSCLES.map(m => {
            const role = roleOf(m)
            return (
              <button
                key={m}
                type="button"
                className={`btn ex-chip${role === '補助' ? ' ex-chip-sub' : ''}`}
                aria-pressed={role !== ''}
                onClick={() => setDraft(d => cycleMuscle(d, m))}
              >
                {m}{role && <span className="ex-chip-role">{role}</span>}
              </button>
            )
          })}
        </div>
        <p className="muted small">週のセット数は主働筋1、補助筋0.5で数えます</p>
        <Err msg={errors.primary} />
        <Err msg={errors.secondary} />
      </div>

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={submit}>保存</button>
        <button type="button" className="btn" onClick={onCancel}>キャンセル</button>
        {onDelete && <button type="button" className="btn btn-ghost ex-delete" onClick={onDelete}>この種目を削除</button>}
      </div>
    </div>
  )
}
