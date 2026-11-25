import { useState } from 'react'
import type { AppData, Condition, Entry, Exercise, ScreenProps, Session, SetLog } from '../types'
import { BODY_PARTS } from '../types'
import { achieved, addVolume, bestE1rm, doneSets, historyFor, localToday, planExercise } from '../logic'
import type { Volume } from '../logic'
import { uid } from '../storage'
import NumInput from '../components/NumInput'
import RestTimer from '../components/RestTimer'
import SetNote from '../components/SetNote'
import WarmupPanel from '../components/WarmupPanel'
import AmrapHint from '../components/AmrapHint'
import FeedbackPanel from '../components/FeedbackPanel'
import SubstitutePanel from '../components/SubstitutePanel'
import type { ReplaceWith } from '../components/SubstitutePanel'
import { useWakeLock } from '../hooks/useWakeLock'
import { primeAudio } from '../sound'

const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'good', label: '好調' },
  { value: 'normal', label: '普通' },
  { value: 'bad', label: '不調' },
]

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const dateLabel = () => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`
}

const num = (n: number) => String(Math.round(n * 100) / 100)

function previousText(entry: Entry | undefined): string | undefined {
  if (!entry) return undefined
  const sets = doneSets(entry)
  if (sets.length === 0) return undefined
  const sameWeight = sets.every(s => s.weight === sets[0].weight)
  return sameWeight
    ? `${num(sets[0].weight)}kg × ${sets.map(s => s.reps).join(', ')}`
    : sets.map(s => `${num(s.weight)}kg×${s.reps}`).join(', ')
}

export default function Today({ data, setData }: ScreenProps) {
  const today = localToday()
  const session = data.sessions.find(s => s.date === today)
  const condition: Condition = session?.condition ?? 'normal'
  const [picking, setPicking] = useState(false)
  const [timerRun, setTimerRun] = useState<number | undefined>()  // 休憩開始ごとに増える番号

  /** 今日のセッションを更新（なければ作る） */
  const updateSession = (fn: (s: Session) => Session) =>
    setData(prev => {
      const cur = prev.sessions.find(s => s.date === today)
      if (!cur) return { ...prev, sessions: [...prev.sessions, fn({ id: uid(), date: today, entries: [] })] }
      return { ...prev, sessions: prev.sessions.map(s => (s === cur ? fn(s) : s)) }
    })

  const updateEntry = (exerciseId: string, fn: (e: Entry) => Entry) =>
    updateSession(s => ({ ...s, entries: s.entries.map(e => (e.exerciseId === exerciseId ? fn(e) : e)) }))

  const updateSetLog = (exerciseId: string, i: number, patch: Partial<SetLog>) =>
    updateEntry(exerciseId, e => ({ ...e, sets: e.sets.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))

  /** 今日の計画から新しい Entry を作る。exceptId の種目は「今日すでに組んだ量」から除く（入れ替え用） */
  const buildEntry = (ex: Exercise, appData: AppData, exceptId?: string): Entry => {
    const byId = new Map(appData.exercises.map(e => [e.id, e]))
    let planned: Volume = {}
    for (const e of session?.entries ?? []) {
      if (e.exerciseId === exceptId) continue
      const other = byId.get(e.exerciseId)
      if (other) planned = addVolume(planned, other, e.target?.sets ?? e.sets.length)
    }
    const target = planExercise(ex, appData, today, condition, planned)
    const weight = target.kind === 'first' ? 0 : target.weight
    const sets: SetLog[] = Array.from({ length: target.sets }, () => ({ weight, reps: target.reps, done: false }))
    // 限界テストの日は最終セットを限界テストにする
    if (target.amrap && sets.length > 0) sets[sets.length - 1] = { ...sets[sets.length - 1], amrap: true }
    return { exerciseId: ex.id, target, sets }
  }

  const addExercise = (ex: Exercise) => {
    const entry = buildEntry(ex, data)
    updateSession(s => ({ ...s, entries: [...s.entries, entry] }))
    setPicking(false)
  }

  /** 今日のこの種目を別の種目に入れ替える（未登録の種目なら種目一覧にも追加する） */
  const replaceExercise = (from: Exercise, next: ReplaceWith) => {
    const existing = 'id' in next ? next : data.exercises.find(e => e.name === next.name)
    const ex: Exercise = existing ?? { ...next, id: uid() }
    if (ex.id !== from.id && session?.entries.some(e => e.exerciseId === ex.id)) {
      alert(`「${ex.name}」はすでに今日のメニューにあります`)
      return
    }
    const nextData = existing ? data : { ...data, exercises: [...data.exercises, ex] }
    const entry = buildEntry(ex, nextData, from.id)
    setData(prev => ({
      ...prev,
      exercises: existing ? prev.exercises : [...prev.exercises, ex],
      sessions: prev.sessions.map(s =>
        s.date === today ? { ...s, entries: s.entries.map(e => (e.exerciseId === from.id ? entry : e)) } : s,
      ),
    }))
  }

  const toggleDone = (ex: Exercise, entry: Entry, i: number) => {
    const wasDone = entry.sets[i].done
    updateSetLog(ex.id, i, { done: !wasDone })
    if (!wasDone) {
      primeAudio()
      setTimerRun(n => (n ?? 0) + 1)
    }
  }

  const removeEntry = (ex: Exercise) => {
    if (!confirm(`「${ex.name}」を今日の記録から削除しますか？`)) return
    updateSession(s => ({ ...s, entries: s.entries.filter(e => e.exerciseId !== ex.id) }))
  }

  const addedIds = new Set((session?.entries ?? []).map(e => e.exerciseId))
  const available = data.exercises.filter(e => !addedIds.has(e.id))
  const exById = new Map(data.exercises.map(e => [e.id, e]))
  const visible = (session?.entries ?? []).filter(e => exById.has(e.exerciseId))

  // トレーニング中（今日の種目がある間）は画面を消さない
  useWakeLock(visible.length > 0)

  return (
    <section className="screen">
      <h1 className="screen-title">{dateLabel()}</h1>

      <div className="stack">
        <span className="muted">今日の調子</span>
        <div className="seg">
          {CONDITIONS.map(c => (
            <button
              key={c.value}
              className="btn"
              aria-pressed={condition === c.value}
              onClick={() => updateSession(s => ({ ...s, condition: c.value }))}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && <p className="empty">＋ 種目を追加 から今日のトレーニングを始めましょう</p>}

      {visible.map(entry => {
        const ex = exById.get(entry.exerciseId)!
        const t = entry.target
        const last = historyFor(ex.id, data.sessions, today)
        const prev = previousText(last[0])
        const best = bestE1rm(entry, ex)
        const prevBest = Math.max(0, ...last.map(e => bestE1rm(e, ex)))
        const allDone = entry.sets.length > 0 && entry.sets.every(s => s.done)
        const ach = allDone ? achieved(entry) : undefined
        return (
          <article key={ex.id} className="card">
            <div className="card-head">
              <h2 className="card-title">{ex.name}</h2>
              <button className="btn btn-ghost" onClick={() => removeEntry(ex)}>削除</button>
            </div>
            {t && (
              <>
                <p className={`target-line${t.kind === 'deload' ? ' target-deload' : ''}`}>
                  {t.kind === 'first'
                    ? `目標：${ex.repMin}〜${ex.repMax}回でRIR ${t.rir}の重量を探す`
                    : `目標 ${num(t.weight)}kg × ${t.reps}回 × ${t.sets}セット（RIR ${t.rir}）`}
                </p>
                <p className="muted small">{t.reason}</p>
                {t.caution && <p className="target-caution">{t.caution}</p>}
                <WarmupPanel ex={ex} target={t} />
                <SubstitutePanel ex={ex} entry={entry} data={data} onReplace={next => replaceExercise(ex, next)} />
              </>
            )}
            {prev && <p className="muted">前回 {prev}</p>}

            {entry.sets.map((s, i) => (
              <div key={i} className={`set${s.done ? ' done' : ''}`}>
                <div className="set-main">
                  <span className="set-no">{i + 1}</span>
                  <NumInput
                    mode="decimal"
                    step={ex.increment}
                    label={`${i + 1}セット目の重量`}
                    placeholder="kg"
                    value={s.weight}
                    onChange={n => updateSetLog(ex.id, i, { weight: n })}
                  />
                  <span className="unit">kg ×</span>
                  <NumInput
                    mode="numeric"
                    label={`${i + 1}セット目のレップ`}
                    placeholder="回"
                    value={s.reps}
                    onChange={n => updateSetLog(ex.id, i, { reps: Math.floor(n) })}
                  />
                  <span className="unit">回</span>
                  <button
                    className="btn set-check"
                    aria-pressed={s.done}
                    aria-label={`${i + 1}セット目を完了`}
                    onClick={() => toggleDone(ex, entry, i)}
                  >
                    ✓
                  </button>
                </div>
                <div className="rir" role="group" aria-label={`${i + 1}セット目のRIR`}>
                  <span>RIR</span>
                  {[0, 1, 2, 3, 4, 5].map(r => (
                    <button
                      key={r}
                      className="btn"
                      aria-pressed={s.rir === r}
                      onClick={() => updateSetLog(ex.id, i, { rir: s.rir === r ? undefined : r })}
                    >
                      {r === 5 ? '5+' : r}
                    </button>
                  ))}
                </div>
                <AmrapHint set={s} target={t} />
                <SetNote
                  value={s.note}
                  label={`${i + 1}セット目のメモ`}
                  onChange={note => updateSetLog(ex.id, i, { note })}
                />
              </div>
            ))}

            <div className="row">
              <button
                className="btn"
                onClick={() =>
                  updateEntry(ex.id, e => {
                    const lastSet = e.sets[e.sets.length - 1]
                    const copy: SetLog = lastSet
                      ? { weight: lastSet.weight, reps: lastSet.reps, done: false }
                      : { weight: e.target?.kind === 'first' ? 0 : (e.target?.weight ?? 0), reps: e.target?.reps ?? ex.repMin, done: false }
                    return { ...e, sets: [...e.sets, copy] }
                  })
                }
              >
                セット追加
              </button>
              <button
                className="btn"
                disabled={entry.sets.length === 0}
                onClick={() => updateEntry(ex.id, e => ({ ...e, sets: e.sets.slice(0, -1) }))}
              >
                最後のセットを削除
              </button>
            </div>

            <div className="row">
              {ach === true && <span className="badge badge-good">目標達成</span>}
              {ach === false && <span className="badge badge-warn">未達</span>}
              {best > 0 && <span className="muted">推定1RM {num(Math.round(best * 10) / 10)}kg</span>}
              {best > 0 && prevBest > 0 && best > prevBest && <span className="badge badge-good">自己ベスト</span>}
            </div>

            {allDone && (
              <FeedbackPanel ex={ex} entry={entry} onChange={feedback => updateEntry(ex.id, e => ({ ...e, feedback }))} />
            )}
          </article>
        )
      })}

      {picking ? (
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">種目を選ぶ</h2>
            <button className="btn btn-ghost" onClick={() => setPicking(false)}>閉じる</button>
          </div>
          {available.length === 0 && <p className="muted">追加できる種目がありません</p>}
          {BODY_PARTS.map(part => {
            const list = available.filter(e => e.part === part)
            if (list.length === 0) return null
            return (
              <div key={part} className="stack">
                <div className="pick-group">{part}</div>
                <div className="pick-list">
                  {list.map(e => (
                    <button key={e.id} className="btn" onClick={() => addExercise(e)}>{e.name}</button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <button className="btn btn-primary" onClick={() => setPicking(true)}>＋ 種目を追加</button>
      )}

      <div className="card">
        <h2 className="card-title">メモ・体重</h2>
        <textarea
          rows={3}
          aria-label="今日のメモ"
          placeholder="メモ"
          value={session?.note ?? ''}
          onChange={e => updateSession(s => ({ ...s, note: e.target.value }))}
        />
        <div className="row">
          <label htmlFor="body-weight">体重</label>
          <NumInput
            mode="decimal"
            step={0.1}
            label="体重 (kg)"
            placeholder="任意"
            value={session?.bodyWeight ?? 0}
            onChange={n => updateSession(s => ({ ...s, bodyWeight: n > 0 ? n : undefined }))}
          />
          <span className="muted">kg</span>
        </div>
      </div>

      {timerRun !== undefined && (
        <RestTimer key={timerRun} seconds={data.restSeconds} sound={data.sound ?? true} onSkip={() => setTimerRun(undefined)} />
      )}
    </section>
  )
}
