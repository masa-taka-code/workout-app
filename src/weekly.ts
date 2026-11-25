import { WEEKLY_MAX, WEEKLY_MIN, addDays, rampWeeklyTargets, weekStart, weeklyTarget } from './logic'
import type { AppData, Feedback, Muscle } from './types'

type Delta = -1 | 0 | 1

const avg = (xs: number[]): number | undefined => (xs.length === 0 ? undefined : xs.reduce((a, b) => a + b, 0) / xs.length)

/** 数値のある項目だけの平均。1つもなければ undefined */
function average(feedbacks: Feedback[], key: 'pump' | 'workload' | 'soreness'): number | undefined {
  return avg(feedbacks.map(f => f[key]).filter((v): v is 0 | 1 | 2 => v !== undefined))
}

/** 振り返りから、筋肉の週目標を動かす量を決める。振り返りがなければ undefined */
export function feedbackDelta(feedbacks: Feedback[]): Delta | undefined {
  if (feedbacks.length === 0) return undefined
  if (feedbacks.some(f => f.joint === true)) return -1
  const pump = average(feedbacks, 'pump')
  const soreness = average(feedbacks, 'soreness')
  const workload = average(feedbacks, 'workload')
  if (soreness !== undefined && soreness >= 1.5) return -1
  if (workload !== undefined && workload >= 1.5) return 0
  if (pump !== undefined && pump < 1 && soreness !== undefined && soreness <= 0.5 && workload !== undefined && workload <= 1) return 1
  return 0
}

/** [from, to) の振り返りを、種目の主働筋ごとに集める（削除済みの種目は無視） */
export function feedbackByMuscle(data: AppData, from: string, to: string): Partial<Record<Muscle, Feedback[]>> {
  const byId = new Map(data.exercises.map(e => [e.id, e]))
  const out: Partial<Record<Muscle, Feedback[]>> = {}
  for (const s of data.sessions) {
    if (s.date < from || s.date >= to) continue
    for (const en of s.entries) {
      const ex = byId.get(en.exerciseId)
      if (!ex || !en.feedback) continue
      for (const m of ex.primary) (out[m] ??= []).push(en.feedback)
    }
  }
  return out
}

/**
 * 週の初めに呼ぶ、筋肉ごとの週目標の見直し。
 * 達成率ルール（rampWeeklyTargets）を出発点に、先週の振り返りがある筋肉はその結果で上書きする。
 */
export function nextWeeklyTargets(data: AppData, today: string): AppData['weeklyTargets'] {
  const thisWeek = weekStart(today)
  const next = { ...rampWeeklyTargets(data, today) }
  const byMuscle = feedbackByMuscle(data, addDays(thisWeek, -7), thisWeek)
  for (const m of Object.keys(byMuscle) as Muscle[]) {
    const delta = feedbackDelta(byMuscle[m] ?? [])
    if (delta === undefined) continue
    next[m] = Math.max(WEEKLY_MIN, Math.min(WEEKLY_MAX, weeklyTarget(data.weeklyTargets, m) + delta))
  }
  return next
}

/** 調整の理由を短く説明する（週の振り返り画面で使う） */
export function explainDelta(delta: Delta | undefined, feedbacks: Feedback[]): string {
  if (delta === undefined) return '据え置き'
  if (delta === 1) return '余裕があったため+1'
  if (delta === -1) {
    return feedbacks.some(f => f.joint === true) ? '関節の痛みがあったため−1' : '筋肉痛が残っていたため−1'
  }
  const workload = average(feedbacks, 'workload')
  return workload !== undefined && workload >= 1.5 ? 'きつかったため据え置き' : '据え置き'
}
