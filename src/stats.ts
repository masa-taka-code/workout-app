/**
 * 分析画面用の集計（純粋関数）。計算の本体は logic.ts の関数を再利用する。
 */
import { WEEKLY_MAX, achieved, achievementRate, addDays, bestE1rm, doneSets, volumeBetween, weekStart, weeklyTarget } from './logic'
import { MUSCLES } from './types'
import type { AppData, Exercise, Muscle, Session } from './types'

const round1 = (n: number) => Math.round(n * 10) / 10

const byDate = (sessions: Session[]) => [...sessions].sort((a, b) => a.date.localeCompare(b.date))

export interface SeriesPoint { date: string; e1rm: number; topWeight: number; volume: number }

/** 種目ごとの推移（完了セットがあるセッションごとに1点、古い順） */
export function exerciseSeries(exerciseId: string, data: AppData): SeriesPoint[] {
  const ex = data.exercises.find(e => e.id === exerciseId)
  if (!ex) return []
  const points: SeriesPoint[] = []
  for (const s of byDate(data.sessions)) {
    const sets = s.entries.filter(e => e.exerciseId === exerciseId).flatMap(e => doneSets(e))
    if (sets.length === 0) continue
    const best = Math.max(...s.entries.filter(e => e.exerciseId === exerciseId).map(e => bestE1rm(e, ex)))
    points.push({
      date: s.date,
      e1rm: round1(best),
      topWeight: Math.max(...sets.map(x => x.weight)),
      volume: sets.reduce((sum, x) => sum + x.weight * x.reps, 0),
    })
  }
  return points
}

export interface PersonalBests {
  e1rm: { value: number; date: string }
  weight: { value: number; reps: number; date: string }
}

/** 自己ベスト。記録がなければ undefined */
export function personalBests(exerciseId: string, data: AppData): PersonalBests | undefined {
  const series = exerciseSeries(exerciseId, data)
  if (series.length === 0) return undefined

  let e1rm = { value: series[0].e1rm, date: series[0].date }
  for (const p of series) if (p.e1rm > e1rm.value) e1rm = { value: p.e1rm, date: p.date }

  // 古い日付から見ていき、厳密に上回ったときだけ更新する（同じなら古い日付が残る）
  let weight: PersonalBests['weight'] | undefined
  for (const s of byDate(data.sessions)) {
    for (const en of s.entries) {
      if (en.exerciseId !== exerciseId) continue
      for (const set of doneSets(en)) {
        if (!weight || set.weight > weight.value || (set.weight === weight.value && set.reps > weight.reps)) {
          weight = { value: set.weight, reps: set.reps, date: s.date }
        }
      }
    }
  }
  if (!weight) return undefined
  return { e1rm, weight }
}

/** 目標どおりにできた回数（目標なし・初回は数えない） */
export function exerciseAchievement(exerciseId: string, data: AppData): { achieved: number; total: number } {
  let ok = 0
  let total = 0
  for (const s of data.sessions) {
    for (const en of s.entries) {
      if (en.exerciseId !== exerciseId) continue
      const r = achieved(en)
      if (r === undefined) continue
      total++
      if (r) ok++
    }
  }
  return { achieved: ok, total }
}

/** today を含む週から遡った count 週分の月曜日（古い順） */
export function recentWeeks(today: string, count: number): string[] {
  const thisWeek = weekStart(today)
  return Array.from({ length: count }, (_, i) => addDays(thisWeek, -7 * (count - 1 - i)))
}

export interface WeekSummary { week: string; sessions: number; rate: number | undefined }

/** 週ごとのトレーニング回数と目標達成率（古い順） */
export function weeklySummary(data: AppData, today: string, weeks = 8): WeekSummary[] {
  return recentWeeks(today, weeks).map(week => {
    const to = addDays(week, 7)
    const sessions = data.sessions.filter(s => s.date >= week && s.date < to && s.entries.some(e => doneSets(e).length > 0)).length
    return { week, sessions, rate: achievementRate(data.sessions, week, to) }
  })
}

export interface MuscleWeek { muscle: Muscle; volume: number; target: number; status: 'under' | 'ok' | 'over' }

/** 今週の筋肉ごとの部分セット数と目標 */
export function muscleVolumeThisWeek(data: AppData, today: string): MuscleWeek[] {
  const start = weekStart(today)
  const end = addDays(start, 7)
  const thisWeek = volumeBetween(data.sessions, data.exercises, start, end)
  const recent = volumeBetween(data.sessions, data.exercises, addDays(start, -28), end)
  return MUSCLES
    .filter(m => (recent[m] ?? 0) > 0 || data.weeklyTargets[m] !== undefined)
    .map(muscle => {
      const volume = thisWeek[muscle] ?? 0
      const target = weeklyTarget(data.weeklyTargets, muscle)
      const status = volume < target ? 'under' : volume > WEEKLY_MAX ? 'over' : 'ok'
      return { muscle, volume, target, status }
    })
}

/** 完了セットのある種目（最後に記録した日の新しい順） */
export function exercisesWithHistory(data: AppData): Exercise[] {
  const last = new Map<string, string>()
  for (const s of data.sessions) {
    for (const en of s.entries) {
      if (doneSets(en).length === 0) continue
      const prev = last.get(en.exerciseId)
      if (!prev || s.date > prev) last.set(en.exerciseId, s.date)
    }
  }
  return data.exercises
    .filter(e => last.has(e.id))
    .sort((a, b) => (last.get(b.id) ?? '').localeCompare(last.get(a.id) ?? ''))
}
