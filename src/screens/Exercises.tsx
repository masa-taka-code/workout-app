import { useState } from 'react'
import type { Exercise, ScreenProps } from '../types'
import { BODY_PARTS, EQUIPMENTS } from '../types'
import { doneSets } from '../logic'
import { uid } from '../storage'
import ExerciseForm from '../components/ExerciseForm'
import { newDraft } from '../components/exerciseValidation'
import type { ExerciseDraft } from '../components/exerciseValidation'
import './Exercises.css'

/** 編集中の対象：'new' は新規追加、それ以外は種目の id */
type Editing = 'new' | string | null

export default function Exercises({ data, setData }: ScreenProps) {
  const [editing, setEditing] = useState<Editing>(null)

  /** その種目の完了セットがある entry の数 */
  const recordCount = (id: string) =>
    data.sessions.reduce((n, s) => n + s.entries.filter(e => e.exerciseId === id && doneSets(e).length > 0).length, 0)

  const save = (draft: ExerciseDraft) => {
    const id = editing
    setData(prev => ({
      ...prev,
      exercises:
        id === 'new'
          ? [...prev.exercises, { id: uid(), ...draft }]
          : prev.exercises.map(e => (e.id === id ? { ...draft, id: e.id } : e)),
    }))
    setEditing(null)
  }

  const remove = (ex: Exercise) => {
    const n = recordCount(ex.id)
    const msg = n > 0
      ? `この種目の記録が${n}回あります。種目を削除しても過去の記録は残りますが、分析と目標算出には使われなくなります。削除しますか？`
      : '削除しますか？'
    if (!window.confirm(msg)) return
    setData(prev => ({ ...prev, exercises: prev.exercises.filter(e => e.id !== ex.id) }))
    setEditing(null)
  }

  const editingEx = editing && editing !== 'new' ? data.exercises.find(e => e.id === editing) : undefined

  if (editing === 'new' || editingEx) {
    return (
      <section className="screen">
        <h1 className="screen-title">{editingEx ? '種目を編集' : '種目を追加'}</h1>
        <ExerciseForm
          key={editing}
          initial={editingEx ? { ...editingEx } : newDraft()}
          others={data.exercises.filter(e => e.id !== editingEx?.id)}
          onSave={save}
          onCancel={() => setEditing(null)}
          onDelete={editingEx ? () => remove(editingEx) : undefined}
        />
      </section>
    )
  }

  return (
    <section className="screen">
      <div className="ex-head">
        <h1 className="screen-title">種目</h1>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>＋ 追加</button>
      </div>

      {data.exercises.length === 0 && <p className="empty">種目がありません。「＋ 追加」から登録してください。</p>}

      {BODY_PARTS.map(part => {
        const list = data.exercises.filter(e => e.part === part)
        if (list.length === 0) return null
        return (
          <div key={part} className="stack">
            <h2 className="ex-part">{part}</h2>
            {list.map(ex => (
              <button key={ex.id} type="button" className="ex-item" onClick={() => setEditing(ex.id)}>
                <span className="ex-name">{ex.name}</span>
                <span className="ex-meta">{EQUIPMENTS.find(q => q.value === (ex.equipment ?? 'other'))?.label}・{ex.repMin}〜{ex.repMax}回・+{ex.increment}kg・{ex.sets}セット・RIR {ex.targetRir}</span>
                <span className="ex-meta">
                  主：{ex.primary.join('・') || 'なし'}
                  {ex.secondary.length > 0 && `　補助：${ex.secondary.join('・')}`}
                </span>
                <span className="ex-meta">記録 {recordCount(ex.id)}回</span>
              </button>
            ))}
          </div>
        )
      })}
    </section>
  )
}
