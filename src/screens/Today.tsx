import { useEffect, useState } from 'react'
import type { AppData, Condition, Entry, Exercise, ScreenProps, Session, SetLog } from '../types'
import { BODY_PARTS } from '../types'
import { achieved, addVolume, bestE1rm, doneSets, historyFor, localToday, planExercise } from '../logic'
import type { Volume } from '../logic'
import { uid } from '../storage'
import NumInput from '../components/NumInput'
import RestTimer from '../components/RestTimer'
import WarmupPanel from '../components/WarmupPanel'
import BodyMap from '../components/BodyMap'
import FormCheckButton from '../components/FormCheckButton'
import { exerciseHighlights } from '../bodymap'
import FeedbackPanel from '../components/FeedbackPanel'
import SubstitutePanel from '../components/SubstitutePanel'
import type { ReplaceWith } from '../components/SubstitutePanel'
import { useWakeLock } from '../hooks/useWakeLock'
import { primeAudio } from '../sound'
import { formKeyFor } from '../form/engine'
import { rotationHint } from '../substitute'
import TargetBlock from '../components/TargetBlock'
import ToolChips from '../components/ToolChips'
import SetRow from '../components/SetRow'
import OverflowMenu from '../components/OverflowMenu'
import UndoToast from '../components/UndoToast'
import {
  buildNextSet, centeredScrollTop, findScrollTarget, firstUndone, hasWarmup, makeUndo, restoreSession, withoutLastSet,
} from '../components/todayLogic'
import type { UndoState } from '../components/todayLogic'
import './Today.css'

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
  // 休憩の開始時刻（動画撮影の自動終了時刻から数えるとき）。通常は undefined＝完了を押した時点から
  const [timerStartedAt, setTimerStartedAt] = useState<number | undefined>()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())  // 手動で展開したセット（種目id:位置）
  const [openTool, setOpenTool] = useState<Record<string, string | null>>({})  // 種目ごとに開いている補助機能
  const [undo, setUndo] = useState<UndoState | null>(null)
  const [scrollReq, setScrollReq] = useState<{ n: number; exerciseId: string } | null>(null)

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

  /** 動画で撮影したセットの回数と点数を、次の未完了セットに入れて完了にする */
  const applyFormResult = (ex: Exercise, entry: Entry, result: { reps: number; formScore: number; endedAt?: number }) => {
    const i = entry.sets.findIndex(s => !s.done)
    if (i === -1) {
      alert('未完了のセットがありません。「セット追加」してから反映してください')
      return
    }
    updateSetLog(ex.id, i, { reps: result.reps, formScore: result.formScore })
    toggleDone(ex, entry, i, result.endedAt)
  }

  const toggleDone = (ex: Exercise, entry: Entry, i: number, restStartedAt?: number) => {
    const wasDone = entry.sets[i].done
    updateSetLog(ex.id, i, { done: !wasDone })
    if (!wasDone) {
      primeAudio()
      setTimerStartedAt(restStartedAt)
      setTimerRun(n => (n ?? 0) + 1)
      setScrollReq(r => ({ n: (r?.n ?? 0) + 1, exerciseId: ex.id }))
    }
  }

  /** 削除の直前の状態を覚えて、トーストを出す */
  const announceUndo = (message: string) => {
    if (session) setUndo(makeUndo(message, session))
  }

  const removeLastSet = (ex: Exercise, entry: Entry) => {
    if (entry.sets.length === 0) return
    const last = entry.sets[entry.sets.length - 1]
    if (last.done && !confirm(`${entry.sets.length}セット目は完了済みです。削除しますか？`)) return
    announceUndo(`${entry.sets.length}セット目を削除しました`)
    updateEntry(ex.id, withoutLastSet)
  }

  const removeEntry = (ex: Exercise) => {
    const entry = session?.entries.find(e => e.exerciseId === ex.id)
    if (entry?.sets.some(x => x.done) && !confirm(`「${ex.name}」を今日の記録から削除しますか？`)) return
    announceUndo(`${ex.name}を外しました`)
    updateSession(s => ({ ...s, entries: s.entries.filter(e => e.exerciseId !== ex.id) }))
  }

  const addedIds = new Set((session?.entries ?? []).map(e => e.exerciseId))
  const available = data.exercises.filter(e => !addedIds.has(e.id))
  const exById = new Map(data.exercises.map(e => [e.id, e]))
  const visible = (session?.entries ?? []).filter(e => exById.has(e.exerciseId))

  // トレーニング中（今日の種目がある間）は画面を消さない
  useWakeLock(visible.length > 0)

  const nextSet = buildNextSet(visible, exById)

  // 完了ボタンのあと、次の未完了セットを「見える範囲」の中央へスクロールする
  useEffect(() => {
    if (!scrollReq) return
    const from = visible.findIndex(e => e.exerciseId === scrollReq.exerciseId)
    const pos = findScrollTarget(visible, from)
    if (!pos) return
    const id = `${visible[pos.entryIndex].exerciseId}:${pos.setIndex}`
    const raf = requestAnimationFrame(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('[data-set-id]')).find(x => x.dataset.setId === id)
      if (!el) return
      const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timer-h'))
      const timerH = Number.isFinite(raw) ? raw : 140
      const rect = el.getBoundingClientRect()
      const top = centeredScrollTop(rect.top, rect.height, window.scrollY, window.innerHeight, 56, timerH)
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
    // scrollReq が変わった（完了を押した）ときだけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollReq])

  return (
    <section className="screen">
      <h1 className="screen-title">{dateLabel()}</h1>

      <div className="stack">
        <span className="muted">今日の調子</span>
        <div className="seg today-seg">
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

      {visible.length === 0 && !picking && (
        <div className="empty">
          <p>今日の種目を選んで始めましょう</p>
          <button className="btn-add-main" onClick={() => setPicking(true)}>＋ 種目を追加</button>
        </div>
      )}

      {visible.map(entry => {
        const ex = exById.get(entry.exerciseId)!
        const t = entry.target
        const last = historyFor(ex.id, data.sessions, today)
        const prev = previousText(last[0])
        const best = bestE1rm(entry, ex)
        const prevBest = Math.max(0, ...last.map(e => bestE1rm(e, ex)))
        const allDone = entry.sets.length > 0 && entry.sets.every(s => s.done)
        const ach = allDone ? achieved(entry) : undefined
        const activeIdx = firstUndone(entry)
        const isOpen = (i: number) => i === activeIdx || expanded.has(`${ex.id}:${i}`)
        const firstOpen = entry.sets.findIndex((_, i) => isOpen(i))
        const hint = t ? rotationHint(ex, data, today) : undefined
        const formKey = formKeyFor(ex)
        const chips = [
          ...(t && hasWarmup(ex, t) ? [{ key: 'warmup', label: 'アップ' }] : []),
          { key: 'body', label: '筋肉' },
          ...(t ? [{ key: 'substitute', label: '代わり' }] : []),
          ...(formKey ? [{ key: 'form', label: '撮影β' }] : []),
        ]
        const toolSaved = openTool[ex.id]
        const tool = toolSaved === undefined ? (hint ? 'substitute' : null) : toolSaved
        const panelId = `${ex.id}-${tool}`
        return (
          <article key={ex.id} className="card today-card">
            <div className="card-head">
              <h2 className="today-title">{ex.name}</h2>
              <OverflowMenu
                label={`${ex.name}のメニュー`}
                items={[
                  { label: '最後のセットを削除', disabled: entry.sets.length === 0, onSelect: () => removeLastSet(ex, entry) },
                  { label: 'この種目を外す', danger: true, onSelect: () => removeEntry(ex) },
                ]}
              />
            </div>
            {t && <TargetBlock ex={ex} target={t} previous={prev} />}
            {!t && prev && <p className="muted">前回 {prev}</p>}
            {hint && <p className="target-caution-line">{hint.message}</p>}
            <ToolChips
              items={chips}
              openKey={tool}
              idPrefix={ex.id}
              onToggle={k => setOpenTool(m => ({ ...m, [ex.id]: tool === k ? null : k }))}
            />
            {tool && (
              <div className="tool-panel" id={panelId}>
                {tool === 'warmup' && t && <WarmupPanel ex={ex} target={t} bare />}
                {tool === 'body' && <BodyMap highlights={exerciseHighlights(ex)} size="sm" label={`${ex.name}で効く筋肉`} />}
                {tool === 'substitute' && (
                  <SubstitutePanel ex={ex} entry={entry} data={data} bare onReplace={next => replaceExercise(ex, next)} />
                )}
                {tool === 'form' && (
                  <FormCheckButton
                    ex={ex}
                    entry={entry}
                    data={data}
                    bare
                    onApply={result => applyFormResult(ex, entry, result)}
                    setData={setData}
                    onSaveBaseline={(key, baseline) =>
                      setData(prev => ({
                        ...prev,
                        formBaselines: { ...prev.formBaselines, [key]: { ...baseline, savedAt: today } },
                      }))
                    }
                  />
                )}
              </div>
            )}

            <div className="today-sets">
              {entry.sets.map((s, i) => (
                <div key={i} data-set-id={`${ex.id}:${i}`}>
                  <SetRow
                    index={i}
                    set={s}
                    target={t}
                    increment={ex.increment}
                    active={i === activeIdx}
                    expanded={expanded.has(`${ex.id}:${i}`)}
                    showRirHelp={i === firstOpen}
                    onToggleExpand={() =>
                      setExpanded(prevSet => {
                        const next = new Set(prevSet)
                        const k = `${ex.id}:${i}`
                        if (next.has(k)) next.delete(k)
                        else next.add(k)
                        return next
                      })
                    }
                    onChange={patch => updateSetLog(ex.id, i, patch)}
                    onToggleDone={() => toggleDone(ex, entry, i)}
                  />
                </div>
              ))}
            </div>

            <button
              className="today-add-set"
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
              ＋ セットを追加
            </button>

            {(ach !== undefined || best > 0) && (
              <div className="today-result">
                {ach === true && <span className="today-badge today-badge-good">目標達成</span>}
                {ach === false && <span className="today-badge today-badge-warn">未達</span>}
                {best > 0 && <span className="muted">推定1RM {num(Math.round(best * 10) / 10)}kg</span>}
                {best > 0 && prevBest > 0 && best > prevBest && <span className="today-pr">★ 自己ベスト</span>}
              </div>
            )}

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
        visible.length > 0 && (
          <button className="btn btn-primary btn-add-bottom" onClick={() => setPicking(true)}>＋ 種目を追加</button>
        )
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
        <div className="today-bw">
          <label htmlFor="body-weight">体重</label>
          <NumInput
            mode="decimal"
            step={0.1}
            label="体重 (kg)"
            className="today-bw-input"
            placeholder="任意"
            value={session?.bodyWeight ?? 0}
            onChange={n => updateSession(s => ({ ...s, bodyWeight: n > 0 ? n : undefined }))}
          />
          <span className="muted">kg</span>
        </div>
      </div>

      {timerRun !== undefined && (
        <RestTimer
          key={timerRun}
          seconds={data.restSeconds}
          sound={data.sound ?? true}
          next={nextSet}
          startedAt={timerStartedAt}
          onSkip={() => setTimerRun(undefined)}
        />
      )}

      {undo && (
        <UndoToast
          message={undo.message}
          onUndo={() => {
            const snap = undo.session
            setData(prev => restoreSession(prev, snap))
            setUndo(null)
          }}
          onExpire={() => setUndo(null)}
        />
      )}
    </section>
  )
}
