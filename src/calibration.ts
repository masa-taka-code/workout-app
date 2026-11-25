/**
 * RIR（あと何回できたか）の個人補正。
 * 限界テスト（amrap）のセットで、予測した RIR と実際に挙げられた回数のずれを測り、以後の目標算出で補正する。
 * types.ts だけに依存する（logic.ts から import しても循環しない）。
 */
import type { AppData, Entry, Exercise } from './types'

const RECENT = 5
const MIN_SAMPLES = 2
const BIAS_MIN = -2
const BIAS_MAX = 3

/**
 * 限界テストの誤差 = (reps − target.reps) − rir（プラスなら余力を少なめに見積もっている）。
 * exerciseId が undefined なら全種目。新しい順。
 */
export function rirSamples(exerciseId: string | undefined, data: AppData, before: string): number[] {
  const out: number[] = []
  const sessions = data.sessions.filter(s => s.date < before).sort((a, b) => b.date.localeCompare(a.date))
  for (const session of sessions) {
    for (const entry of session.entries) {
      if (exerciseId !== undefined && entry.exerciseId !== exerciseId) continue
      const target = entry.target
      if (!target) continue
      for (const set of entry.sets) {
        if (!set.amrap || !set.done || typeof set.rir !== 'number') continue
        // 目標回数に届かずに限界が来たセットも含める（余力を多く見積もった例＝マイナスの誤差）。
        // 除くと補正値がプラス側にかたよる（論文本文の確認で判明、2026-11-26）
        out.push(set.reps - target.reps - set.rir)
      }
    }
  }
  return out
}

const recentMean = (xs: number[]) => {
  const r = xs.slice(0, RECENT)
  return r.reduce((a, b) => a + b, 0) / r.length
}

/** 記録した RIR に足す補正値。種目別 → 全種目 → なし の順にフォールバック。−2〜+3、0.5 刻み */
export function rirBias(
  exerciseId: string,
  data: AppData,
  before: string,
): { bias: number; samples: number; scope: 'exercise' | 'all' | 'none' } {
  const finish = (xs: number[], scope: 'exercise' | 'all') => {
    const clamped = Math.min(BIAS_MAX, Math.max(BIAS_MIN, recentMean(xs)))
    // -0 を避けるため + 0
    return { bias: Math.round(clamped * 2) / 2 + 0, samples: Math.min(xs.length, RECENT), scope }
  }
  const own = rirSamples(exerciseId, data, before)
  if (own.length >= MIN_SAMPLES) return finish(own, 'exercise')
  const all = rirSamples(undefined, data, before)
  if (all.length >= MIN_SAMPLES) return finish(all, 'all')
  return { bias: 0, samples: 0, scope: 'none' }
}

/** 4回に1回、最終セットを限界テストにする。バーベルは補助者なしで限界まで挙げるのは危険なので除外 */
export function isCalibrationDue(ex: Exercise, history: Entry[]): boolean {
  if (ex.equipment === 'barbell') return false
  return (history.length + 1) % 4 === 0
}
