import { rampWeeklyTargets } from './logic'
import type { AppData } from './types'

/**
 * 週の初めに呼ぶ、筋肉ごとの週目標の見直し。
 * 仮実装：振り返りによる調整は implementer が実装する。今は達成率ルールだけ。
 */
export function nextWeeklyTargets(data: AppData, today: string): AppData['weeklyTargets'] {
  return rampWeeklyTargets(data, today)
}
