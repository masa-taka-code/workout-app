import { WEEKLY_MAX, bestE1rm, historyFor } from '../logic'
import type { Entry, Exercise, Session } from '../types'

/**
 * 筋肉ごとの週セット数の見せ方（画面表示だけのための設計値・暫定。logic.ts の定数とは別物）。
 * 目標に対する割合で ◎ 達成（100%以上）／○ あと少し（70%以上）／△ 不足（70%未満）に分ける。
 */
export const LEVEL_ACHIEVED_RATIO = 1
export const LEVEL_CLOSE_RATIO = 0.7

export type MuscleLevel = 'achieved' | 'close' | 'short' | 'over'
export type LevelTone = 'good' | 'ink' | 'muted' | 'warn' | 'bad'

export const LEVEL_LABEL: Record<MuscleLevel, string> = {
  achieved: '◎ 達成',
  close: '○ あと少し',
  short: '△ 不足',
  over: '▲ 上限超え',
}

export function muscleLevel(volume: number, target: number): MuscleLevel {
  if (volume > WEEKLY_MAX) return 'over'
  const ratio = target > 0 ? volume / target : 1
  if (ratio >= LEVEL_ACHIEVED_RATIO) return 'achieved'
  if (ratio >= LEVEL_CLOSE_RATIO) return 'close'
  return 'short'
}

/** 色の使い方。不足は週が終わったあとだけ橙（週の途中は誰でも不足なので、色を付けず灰色にする） */
export function levelTone(level: MuscleLevel, weekEnded: boolean): LevelTone {
  if (level === 'achieved') return 'good'
  if (level === 'close') return 'ink'
  if (level === 'over') return 'bad'
  return weekEnded ? 'warn' : 'muted'
}

/** 横棒の長さ（0〜1）。目標に着いたら端まで */
export const barRatio = (volume: number, target: number): number =>
  target > 0 ? Math.min(1, Math.max(0, volume / target)) : 1

/** この日の種目が、それまでの記録より推定1RMを更新したか（初めての記録は更新に数えない） */
export function isPersonalBest(entry: Entry, ex: Exercise, sessions: Session[], date: string): boolean {
  const best = bestE1rm(entry, ex)
  if (best <= 0) return false
  const prev = Math.max(0, ...historyFor(ex.id, sessions, date).map(e => bestE1rm(e, ex)))
  return prev > 0 && best > prev
}
