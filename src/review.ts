/**
 * 週の振り返り用の集計（純粋関数）。計算の本体は logic.ts の関数を再利用する。
 */
import { achievementRate, addDays, bestE1rm, doneSets, volumeBetween, weekStart, weeklyTarget } from './logic'
import { MUSCLES } from './types'
import type { AppData, Muscle, Session } from './types'

const round1 = (n: number) => Math.round(n * 10) / 10

export const ACTIVE_WEEKS_OF = 8
/** 「週に何回できたら1週と数えるか」 */
export const ACTIVE_WEEK_MIN_SESSIONS = 2

export interface MuscleReview { muscle: Muscle; volume: number; target: number; met: boolean }
export interface PrReview { name: string; e1rm: number; previous: number }

export interface WeekReview {
  /** 先週の月曜日 */
  week: string
  sessions: number
  totalSets: number
  muscles: MuscleReview[]
  rate: number | undefined
  prs: PrReview[]
  activeWeeks: { count: number; of: number }
}

const hasDone = (s: Session) => s.entries.some(e => doneSets(e).length > 0)

const countSessions = (sessions: Session[], from: string, to: string) =>
  sessions.filter(s => s.date >= from && s.date < to && hasDone(s)).length

/** 先週（今週の月曜の前の7日間）の振り返り */
export function weekReview(data: AppData, today: string): WeekReview {
  const to = weekStart(today)
  const from = addDays(to, -7)

  const inWeek = data.sessions.filter(s => s.date >= from && s.date < to)
  const sessions = countSessions(data.sessions, from, to)
  const totalSets = inWeek.reduce((sum, s) => sum + s.entries.reduce((n, e) => n + doneSets(e).length, 0), 0)

  const vol = volumeBetween(data.sessions, data.exercises, from, to)
  const muscles = MUSCLES
    .filter(m => (vol[m] ?? 0) > 0 || data.weeklyTargets[m] !== undefined)
    .map(muscle => {
      const volume = vol[muscle] ?? 0
      const target = weeklyTarget(data.weeklyTargets, muscle)
      return { muscle, volume, target, met: volume >= target }
    })

  const prs: PrReview[] = []
  for (const ex of data.exercises) {
    let week = 0
    let before = 0
    for (const s of data.sessions) {
      if (s.date >= to) continue
      for (const en of s.entries) {
        if (en.exerciseId !== ex.id) continue
        const v = bestE1rm(en, ex)
        if (s.date >= from) week = Math.max(week, v)
        else before = Math.max(before, v)
      }
    }
    const e = round1(week)
    const previous = round1(before)
    // 初記録（それ以前が0）は自己ベスト更新に数えない
    if (previous > 0 && e > previous) prs.push({ name: ex.name, e1rm: e, previous })
  }

  let count = 0
  for (let i = 1; i <= ACTIVE_WEEKS_OF; i++) {
    const wFrom = addDays(to, -7 * i)
    if (countSessions(data.sessions, wFrom, addDays(wFrom, 7)) >= ACTIVE_WEEK_MIN_SESSIONS) count++
  }

  return {
    week: from,
    sessions,
    totalSets,
    muscles,
    rate: achievementRate(data.sessions, from, to),
    prs,
    activeWeeks: { count, of: ACTIVE_WEEKS_OF },
  }
}
