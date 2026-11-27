import { useEffect, useState } from 'react'
import type { AppData, Condition, Entry, Exercise, ScreenProps, Session, SetLog } from '../types'
import { BODY_PARTS } from '../types'
import { achieved, addVolume, bestE1rm, doneSets, historyFor, localToday, planExercise } from '../logic'
import type { Volume } from '../logic'
import { uid } from '../storage'
import NumInput from '../components/NumInput'
import CurrentSetBar from '../components/CurrentSetBar'
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
import CorruptNotice from '../components/CorruptNotice'
import {
  buildNextSet, centeredScrollTop, fillWeightAfterComplete, currentSetPos, feedbackComplete, firstUndone, hasWarmup, makeUndo, previousSetText, progressCount,
  restoreSession, withoutLastSet,
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
  const [scrollReq, setScrollReq] = useState<{ n: number } | null>(null)
  // 「今のセット」の基準にする種目（画面の中の状態。保存しない。再読み込みのあとは未設定＝一覧の先頭から）
  const [focusId, setFocusId] = useState<string | undefined>()
  // ユーザーが開いた「今のセットがない種目」（終わった種目・まだの種目）
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  // 最後のセットを終えた直後に、振り返りのために開いておく種目
  const [linger, setLinger] = useState<string | undefined>()
  // 畳んだ行から「振り返りを入力」だけを開いている種目
  const [feedbackOnly, setFeedbackOnly] = useState<Set<string>>(() => new Set())
  const [condOpen, setCondOpen] = useState(false)  // 調子の3択を開き直しているか
  // 直前に完了したセット（休憩中の余力入力の対象。画面の中の状態。保存しない）
  const [lastDone, setLastDone] = useState<{ exerciseId: string; index: number } | undefined>()

  /**
   * 今日のセッションを更新（なければ作る）。
   * 編集したら「元に戻す」は無効にする（後の操作まで消えないように）。
   * 取り消し可能な操作は、更新のあとに announceUndo を呼んでトーストを出す。
   */
  const updateSession = (fn: (s: Session) => Session, keepUndo = false) => {
    if (!keepUndo) setUndo(null)
    setData(prev => {
      const cur = prev.sessions.find(s => s.date === today)
      if (!cur) return { ...prev, sessions: [...prev.sessions, fn({ id: uid(), date: today, entries: [] })] }
      return { ...prev, sessions: prev.sessions.map(s => (s === cur ? fn(s) : s)) }
    })
  }

  const updateEntry = (exerciseId: string, fn: (e: Entry) => Entry, keepUndo = false) =>
    updateSession(s => ({ ...s, entries: s.entries.map(e => (e.exerciseId === exerciseId ? fn(e) : e)) }), keepUndo)

  const updateSetLog = (exerciseId: string, i: number, patch: Partial<SetLog>, keepUndo = false) =>
    updateEntry(exerciseId, e => ({ ...e, sets: e.sets.map((s, j) => (j === i ? { ...s, ...patch } : s)) }), keepUndo)

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
    // 今のセットがないときだけ、追加した種目を今のセットにする
    if (!currentSetPos(visible, focusId)) setFocusId(ex.id)
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
    setUndo(null)
    setFocusId(f => (f === from.id ? ex.id : f))
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
    // 反映の取り消しができるよう、反映前の状態を覚えておく（フォームの解析結果そのものは残す）
    updateSetLog(ex.id, i, { reps: result.reps, formScore: result.formScore })
    toggleDone(ex, entry, i, result.endedAt)
    announceUndo(`${ex.name} ${i + 1}セット目に反映しました`, true)  // 編集のあとに出す（編集で消えるため）
  }

  const toggleDone = (ex: Exercise, entry: Entry, i: number, restStartedAt?: number) => {
    const wasDone = entry.sets[i].done
    updateEntry(ex.id, e => {
      const sets = e.sets.map((s, j) => (j === i ? { ...s, done: !wasDone } : s))
      return { ...e, sets: wasDone ? sets : fillWeightAfterComplete(sets, i) }
    })
    if (!wasDone) {
      primeAudio()
      setTimerStartedAt(restStartedAt)
      setTimerRun(n => (n ?? 0) + 1)
      setScrollReq(r => ({ n: (r?.n ?? 0) + 1 }))
      setFocusId(ex.id)
      setLastDone({ exerciseId: ex.id, index: i })
      // この完了で種目が終わるなら、振り返りのために開いておく。ほかの種目のセットを完了したら畳む
      setLinger(entry.sets.every((x, j) => j === i || x.done) ? ex.id : undefined)
    } else if (lastDone && lastDone.exerciseId === ex.id && lastDone.index === i) {
      // 直前に完了したセットの完了を取り消したら、そのセットの休憩タイマーも止める
      setTimerRun(undefined)
      setTimerStartedAt(undefined)
      setLastDone(undefined)
    }
  }

  /** 画面下の固定バーの「✓ 完了」：今のセットを完了にし、取り消せるトーストを出す */
  const completeCurrent = () => {
    if (!pos) return
    const entry = visible[pos.entryIndex]
    const ex = exById.get(entry.exerciseId)
    if (!ex) return
    toggleDone(ex, entry, pos.setIndex)
    announceUndo(`${pos.setIndex + 1}セット目を完了しました`, true)  // 編集のあとに出す（編集で消えるため）
  }

  /** 削除・完了の直前の状態を覚えて、トーストを出す */
  const announceUndo = (message: string, stopTimer = false) => {
    if (session) setUndo(makeUndo(message, session, stopTimer))
  }

  const removeLastSet = (ex: Exercise, entry: Entry) => {
    if (entry.sets.length === 0) return
    const last = entry.sets[entry.sets.length - 1]
    if (last.done && !confirm(`${entry.sets.length}セット目は完了済みです。削除しますか？`)) return
    updateEntry(ex.id, withoutLastSet)
    announceUndo(`${entry.sets.length}セット目を削除しました`)
  }

  const removeEntry = (ex: Exercise) => {
    const entry = session?.entries.find(e => e.exerciseId === ex.id)
    if (entry?.sets.some(x => x.done) && !confirm(`「${ex.name}」を今日の記録から削除しますか？`)) return
    updateSession(s => ({ ...s, entries: s.entries.filter(e => e.exerciseId !== ex.id) }))
    announceUndo(`${ex.name}を外しました`)
  }

  const addedIds = new Set((session?.entries ?? []).map(e => e.exerciseId))
  const available = data.exercises.filter(e => !addedIds.has(e.id))
  const exById = new Map(data.exercises.map(e => [e.id, e]))
  const visible = (session?.entries ?? []).filter(e => exById.has(e.exerciseId))

  // トレーニング中（今日の種目がある間）は画面を消さない
  useWakeLock(visible.length > 0)

  // 今のセット：画面の印・固定バー・休憩の「次」・スクロール先はすべてここから取る
  const pos = currentSetPos(visible, focusId)
  const current = buildNextSet(visible, exById, focusId)
  const progress = progressCount(visible)

  // 休憩中に入れる「さっきのセットの余力」。押した値は直前に完了したセットの rir に入る（同じ値をもう一度押すと未入力に戻る）
  const lastDoneSet = lastDone ? visible.find(e => e.exerciseId === lastDone.exerciseId)?.sets[lastDone.index] : undefined
  const restRir =
    lastDone && lastDoneSet?.done
      ? {
          value: lastDoneSet.rir,
          // 余力の入力では、完了の取り消しトーストを消さない（取り消すと、入れた余力も完了前に戻る）
          onPick: (r: number) => updateSetLog(lastDone.exerciseId, lastDone.index, { rir: lastDoneSet.rir === r ? undefined : r }, true),
        }
      : undefined

  /** 今のセットを「見える範囲」（上端〜固定バーの上端）の中央へスクロールする */
  const scrollToCurrent = () => {
    if (!pos) return undefined
    const id = `${visible[pos.entryIndex].exerciseId}:${pos.setIndex}`
    return requestAnimationFrame(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('[data-set-id]')).find(x => x.dataset.setId === id)
      if (!el) return
      // 固定バーの高さは、レイアウト済みの実寸を測る（--timer-h は変化の直後は古いことがある）
      const barH = document.querySelector('.csb')?.getBoundingClientRect().height ?? 176
      const rect = el.getBoundingClientRect()
      const top = centeredScrollTop(rect.top, rect.height, window.scrollY, window.innerHeight, 56, barH)
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
    })
  }

  // 完了のあと、次の今のセットへスクロールする
  useEffect(() => {
    if (!scrollReq) return
    const raf = scrollToCurrent()
    return () => {
      if (raf !== undefined) cancelAnimationFrame(raf)
    }
    // scrollReq が変わった（完了を押した）ときだけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollReq])

  const openPicker = () => {
    setPicking(true)
    requestAnimationFrame(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      document.getElementById('today-picker')?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    })
  }

  const condLabel = CONDITIONS.find(c => c.value === condition)?.label ?? '普通'
  // 最初のセットを完了したら、調子は「調子：普通 ▸」の1行にたたむ（押すと開く）
  const showCond = progress.done === 0 || condOpen

  const toggleIn = (set: Set<string>, id: string, on: boolean): Set<string> => {
    const next = new Set(set)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }

  return (
    <section className="screen">
      <CorruptNotice />
      <div className="today-head">
        <h1 className="screen-title">{dateLabel()}</h1>
        {progress.total > 0 && <span className="today-progress-text">{progress.done} / {progress.total} セット</span>}
      </div>
      {progress.total > 0 && (
        <div
          className="today-progress"
          role="progressbar"
          aria-label="今日の進み具合"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
        >
          <div className="today-progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}

      {showCond ? (
        <div className="stack">
          <span className="muted">今日の調子</span>
          <div className="seg today-seg">
            {CONDITIONS.map(c => (
              <button
                key={c.value}
                className="btn"
                aria-pressed={condition === c.value}
                onClick={() => {
                  updateSession(s => ({ ...s, condition: c.value }))
                  setCondOpen(false)
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button type="button" className="today-cond" aria-expanded={false} onClick={() => setCondOpen(true)}>
          調子：{condLabel} <span aria-hidden="true">▸</span>
        </button>
      )}

      {visible.length === 0 && !picking && (
        <div className="empty">
          <p>まず種目を1つ選びましょう</p>
          <button className="btn-add-main" onClick={() => setPicking(true)}>＋ 種目を追加</button>
        </div>
      )}

      {visible.map((entry, idx) => {
        const ex = exById.get(entry.exerciseId)!
        const t = entry.target
        const last = historyFor(ex.id, data.sessions, today)
        const prev = previousText(last[0])
        const best = bestE1rm(entry, ex)
        const prevBest = Math.max(0, ...last.map(e => bestE1rm(e, ex)))
        const allDone = entry.sets.length > 0 && entry.sets.every(s => s.done)
        const ach = allDone ? achieved(entry) : undefined
        const fbDone = feedbackComplete(entry.feedback)
        const isCurrent = pos?.entryIndex === idx
        const lingering = linger === ex.id && allDone && !fbDone
        const cardOpen = isCurrent || opened.has(ex.id) || lingering
        const doneCount = entry.sets.filter(s => s.done).length

        // 畳んだ行（まだの種目／終わった種目）
        if (!cardOpen) {
          const undone = entry.sets.filter(s => !s.done)
          const nextSet = undone[0]
          return (
            <article key={ex.id} className="card today-rowcard">
              <button
                type="button"
                className="today-row"
                aria-expanded={false}
                onClick={() => {
                  if (firstUndone(entry) === -1) setOpened(o => toggleIn(o, ex.id, true))
                  else setFocusId(ex.id)  // 開いて、その種目を「次」にする
                }}
              >
                {allDone && <span className="today-rowdot" aria-hidden="true">✓</span>}
                <span className="today-rowname">{ex.name}</span>
                {allDone ? (
                  <>
                    <span className="today-rowsub">{entry.sets.length}/{entry.sets.length}</span>
                    <span className={`today-rowbadge${ach ? ' today-rowbadge-good' : ''}`}>{ach ? '✓ 達成' : '△ 未達'}</span>
                  </>
                ) : (
                  nextSet && (
                    <span className="today-rowsub">
                      {nextSet.weight > 0 ? `${num(nextSet.weight)}kg × ${nextSet.reps}回 × ${undone.length}` : `${nextSet.reps}回 × ${undone.length}`}
                    </span>
                  )
                )}
                <span className="today-rowcaret" aria-hidden="true">▸</span>
              </button>
              {allDone && !fbDone && (
                <button
                  type="button"
                  className="today-fbrow"
                  aria-expanded={feedbackOnly.has(ex.id)}
                  onClick={() => setFeedbackOnly(o => toggleIn(o, ex.id, !o.has(ex.id)))}
                >
                  <span className="today-fbdot" aria-hidden="true" />
                  振り返りを入力 <span aria-hidden="true">{feedbackOnly.has(ex.id) ? '▾' : '▸'}</span>
                </button>
              )}
              {allDone && feedbackOnly.has(ex.id) && (
                <FeedbackPanel ex={ex} entry={entry} onChange={feedback => updateEntry(ex.id, e => ({ ...e, feedback }))} />
              )}
            </article>
          )
        }

        const activeIdx = isCurrent && pos ? pos.setIndex : -1
        const isOpen = (i: number) => i === activeIdx || expanded.has(`${ex.id}:${i}`)
        const firstOpen = entry.sets.findIndex((_, i) => isOpen(i))
        const hint = t ? rotationHint(ex, data, today) : undefined
        const formKey = formKeyFor(ex)
        const firstSetDone = entry.sets.length > 0 && entry.sets[0].done
        const warm = !!t && hasWarmup(ex, t)
        // 「アップ」は1セット目が終わるまでセットの上に1つだけ出し、終わったらチップ列に移す
        const warmOnTop = warm && !firstSetDone
        const chips = [
          ...(warm && !warmOnTop ? [{ key: 'warmup', label: 'アップ' }] : []),
          { key: 'body', label: '筋肉' },
          ...(t ? [{ key: 'substitute', label: '代わり' }] : []),
          ...(formKey ? [{ key: 'form', label: '撮影β' }] : []),
        ]
        const toolSaved = openTool[ex.id]
        const tool = toolSaved === undefined ? (hint ? 'substitute' : null) : toolSaved
        const panelId = `${ex.id}-${tool}`
        const toggleTool = (k: string) => setOpenTool(m => ({ ...m, [ex.id]: tool === k ? null : k }))
        const panel = tool && (
          <div className="tool-panel" id={panelId}>
            {tool === 'warmup' && t && <WarmupPanel ex={ex} target={t} bare />}
            {tool === 'body' && <BodyMap highlights={exerciseHighlights(ex)} size="sm" mode="role" label={`${ex.name}で効く筋肉`} />}
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
        )
        const closeCard = () => {
          setOpened(o => toggleIn(o, ex.id, false))
          setLinger(l => (l === ex.id ? undefined : l))
          setFeedbackOnly(o => toggleIn(o, ex.id, false))
        }
        return (
          <article key={ex.id} className="card today-card">
            <div className="card-head">
              <h2 className="today-title">
                {isCurrent ? (
                  ex.name
                ) : (
                  <button type="button" className="today-title-btn" aria-expanded={true} onClick={closeCard}>
                    {ex.name} <span aria-hidden="true">▾</span>
                  </button>
                )}
              </h2>
              <span className="today-count">{isCurrent && pos ? `${pos.setIndex + 1}/${entry.sets.length}` : `${doneCount}/${entry.sets.length}`}</span>
              <OverflowMenu
                label={`${ex.name}のメニュー`}
                items={[
                  { label: '最後のセットを削除', disabled: entry.sets.length === 0, onSelect: () => removeLastSet(ex, entry) },
                  { label: 'この種目を外す', danger: true, onSelect: () => removeEntry(ex) },
                ]}
              />
            </div>
            {t && <TargetBlock ex={ex} target={t} />}
            {!t && prev && <p className="muted">前回 {prev}</p>}
            {hint && <p className="target-caution-line">{hint.message}</p>}
            {warmOnTop && (
              <>
                <ToolChips
                  solo
                  items={[{ key: 'warmup', label: 'アップ' }]}
                  openKey={tool}
                  idPrefix={ex.id}
                  onToggle={toggleTool}
                />
                {tool === 'warmup' && panel}
              </>
            )}

            <div className="today-sets">
              {entry.sets.map((s, i) => (
                <div key={i} data-set-id={`${ex.id}:${i}`}>
                  <SetRow
                    index={i}
                    set={s}
                    target={t}
                    increment={ex.increment}
                    total={entry.sets.length}
                    previous={previousSetText(last[0], i)}
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

            <ToolChips items={chips} openKey={tool} idPrefix={ex.id} onToggle={toggleTool} />
            {tool && !(tool === 'warmup' && warmOnTop) && panel}

            <button
              className="today-add-set"
              onClick={() => {
                setFocusId(ex.id)
                updateEntry(ex.id, e => {
                  const lastSet = e.sets[e.sets.length - 1]
                  const copy: SetLog = lastSet
                    ? { weight: lastSet.weight, reps: lastSet.reps, done: false }
                    : { weight: e.target?.kind === 'first' ? 0 : (e.target?.weight ?? 0), reps: e.target?.reps ?? ex.repMin, done: false }
                  return { ...e, sets: [...e.sets, copy] }
                })
              }}
            >
              ＋ セットを追加
            </button>

            {(ach !== undefined || best > 0) && (
              <div className="today-result">
                {ach === true && <span className="today-badge today-badge-good">✓ 目標達成</span>}
                {ach === false && (
                  <span className="today-badge today-badge-miss">△ 未達{t && t.kind !== 'first' ? `（目標 ${t.reps}回）` : ''}</span>
                )}
                {best > 0 && <span className="today-e1rm">推定1RM {num(Math.round(best * 10) / 10)}kg</span>}
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
        <div className="card" id="today-picker">
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
          <button className="btn btn-add-bottom" onClick={() => setPicking(true)}>＋ 種目を追加</button>
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

      {visible.length > 0 && (
        <CurrentSetBar
          current={current}
          rest={
            timerRun === undefined
              ? undefined
              : { run: timerRun, seconds: data.restSeconds, sound: data.sound ?? true, startedAt: timerStartedAt }
          }
          onComplete={completeCurrent}
          onJump={() => void scrollToCurrent()}
          restRir={restRir}
          onSkipRest={() => setTimerRun(undefined)}
          // 完了ボタンの押下と同時に呼ばれても、新しく始まった休憩を消さない（終わった休憩のときだけ消す）
          onRestFinishedShown={() => setTimerRun(cur => (cur === timerRun ? undefined : cur))}
          onAddExercise={openPicker}
        />
      )}

      {undo && (
        <UndoToast
          reportHeight
          message={undo.message}
          onUndo={() => {
            const snap = undo.session
            setData(prev => restoreSession(prev, snap))
            if (undo.stopTimer) setTimerRun(undefined)
            setUndo(null)
          }}
          onExpire={() => setUndo(null)}
        />
      )}
    </section>
  )
}
