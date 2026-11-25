import type { AppData, Entry, Exercise, Session, SetLog, Target } from '../types'
import { warmupSets } from '../warmup'
import type { NextSet } from './RestTimer'

export interface SetPos {
  /** entries 内の位置 */
  entryIndex: number
  /** その種目内の位置（0 始まり） */
  setIndex: number
}

/** 種目内の最初の未完了セット。なければ -1 */
export const firstUndone = (entry: Entry): number => entry.sets.findIndex(s => !s.done)

/** 種目の追加順→セット順で、最初の未完了セット */
export function findFirstUndone(entries: Entry[], isVisible: (e: Entry) => boolean = () => true): SetPos | undefined {
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    if (!isVisible(entries[entryIndex])) continue
    const setIndex = firstUndone(entries[entryIndex])
    if (setIndex !== -1) return { entryIndex, setIndex }
  }
  return undefined
}

/** 完了ボタンのあとにスクロールする先：同じ種目の次の未完了セット、なければ次の種目以降の最初の未完了セット */
export function findScrollTarget(entries: Entry[], fromEntryIndex: number, isVisible: (e: Entry) => boolean = () => true): SetPos | undefined {
  if (fromEntryIndex >= 0 && fromEntryIndex < entries.length && isVisible(entries[fromEntryIndex])) {
    const setIndex = firstUndone(entries[fromEntryIndex])
    if (setIndex !== -1) return { entryIndex: fromEntryIndex, setIndex }
  }
  for (let entryIndex = fromEntryIndex + 1; entryIndex < entries.length; entryIndex++) {
    if (!isVisible(entries[entryIndex])) continue
    const setIndex = firstUndone(entries[entryIndex])
    if (setIndex !== -1) return { entryIndex, setIndex }
  }
  return undefined
}

/** 休憩タイマーに渡す「次のセット」。種目が一覧にない（削除済みの）ものは飛ばす */
export function buildNextSet(entries: Entry[], exById: Map<string, Exercise>): NextSet | undefined {
  const pos = findFirstUndone(entries, e => exById.has(e.exerciseId))
  if (!pos) return undefined
  const entry = entries[pos.entryIndex]
  const set = entry.sets[pos.setIndex]
  return {
    exerciseName: exById.get(entry.exerciseId)!.name,
    setNo: pos.setIndex + 1,
    totalSets: entry.sets.length,
    weight: set.weight,
    reps: set.reps,
  }
}

/** 数値を delta ずつ増減する（0 未満にしない。小数の誤差は丸める） */
export function stepValue(value: number, delta: number): number {
  return Math.max(0, Math.round((value + delta) * 100) / 100)
}

/** スクロール先の top（ページ座標）。見える範囲（上端〜休憩タイマーの上端）の中央に要素を置く */
export function centeredScrollTop(
  elTop: number, elHeight: number, scrollY: number, viewportH: number, tabbarH: number, timerH: number,
): number {
  const visibleH = Math.max(0, viewportH - tabbarH - timerH)
  // 要素が見える範囲より高いときは、上端を少し空けて合わせる
  const offset = elHeight >= visibleH ? 8 : (visibleH - elHeight) / 2
  return Math.max(0, Math.round(scrollY + elTop - offset))
}

/** ウォームアップのチップを出すか（WarmupPanel が空にならない条件と同じ） */
export function hasWarmup(ex: Exercise, target: Target | undefined): boolean {
  if (!target || target.kind === 'first' || target.weight <= 0) return false
  return warmupSets(target.weight, ex.equipment, ex.increment).length > 0 || ex.equipment === 'barbell'
}

/** 削除を取り消すための記録。削除直前の session 丸ごと */
export interface UndoState {
  message: string
  session: Session
}

export const makeUndo = (message: string, session: Session): UndoState => ({ message, session })

/** 削除直前の session に戻す（同じ id の session を差し替える。無ければ足す） */
export function restoreSession(data: AppData, session: Session): AppData {
  const exists = data.sessions.some(s => s.id === session.id)
  return {
    ...data,
    sessions: exists ? data.sessions.map(s => (s.id === session.id ? session : s)) : [...data.sessions, session],
  }
}

/** 最後のセットを除いた種目 */
export const withoutLastSet = (e: Entry): Entry => ({ ...e, sets: e.sets.slice(0, -1) })

/** セットの文字（完了行・未着手行の表示用） */
export const setSummary = (s: SetLog): string => `${Math.round(s.weight * 100) / 100}kg × ${s.reps}回`
