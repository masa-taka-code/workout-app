import { MUSCLES } from './types'
import type { Exercise, Muscle } from './types'

/** 種目の効いている筋肉：主働筋 1.0、補助筋 0.5 */
export function exerciseHighlights(ex: Exercise): Partial<Record<Muscle, number>> {
  const out: Partial<Record<Muscle, number>> = {}
  for (const m of ex.secondary) out[m] = 0.5
  for (const m of ex.primary) out[m] = 1
  return out
}

/** 人体図の部位（react-body-highlighter の部位名） */
export type Region =
  | 'chest' | 'upper-back' | 'front-deltoids' | 'back-deltoids' | 'biceps' | 'triceps'
  | 'quadriceps' | 'hamstring' | 'gluteal' | 'calves' | 'abs' | 'obliques'

/** アプリの筋肉 → 図の部位。weight は塗りの強さにかける倍率（肩側部は前後に弱めに） */
export const MUSCLE_TO_REGIONS: Record<Muscle, { region: Region; weight: number }[]> = {
  胸: [{ region: 'chest', weight: 1 }],
  背中: [{ region: 'upper-back', weight: 1 }],
  肩前部: [{ region: 'front-deltoids', weight: 1 }],
  肩側部: [{ region: 'front-deltoids', weight: 0.5 }, { region: 'back-deltoids', weight: 0.5 }],
  肩後部: [{ region: 'back-deltoids', weight: 1 }],
  上腕二頭筋: [{ region: 'biceps', weight: 1 }],
  上腕三頭筋: [{ region: 'triceps', weight: 1 }],
  大腿四頭筋: [{ region: 'quadriceps', weight: 1 }],
  ハムストリング: [{ region: 'hamstring', weight: 1 }],
  臀筋: [{ region: 'gluteal', weight: 1 }],
  ふくらはぎ: [{ region: 'calves', weight: 1 }],
  腹筋: [{ region: 'abs', weight: 1 }, { region: 'obliques', weight: 1 }],
}

/** 筋肉ごとの強さ（0〜1）を部位ごとの強さに変換する。同じ部位に複数かかる場合は強いほう */
export function regionIntensities(highlights: Partial<Record<Muscle, number>>): Partial<Record<Region, number>> {
  const out: Partial<Record<Region, number>> = {}
  for (const m of MUSCLES) {
    const v = Math.min(1, Math.max(0, highlights[m] ?? 0))
    if (!(v > 0)) continue
    for (const { region, weight } of MUSCLE_TO_REGIONS[m]) {
      out[region] = Math.max(out[region] ?? 0, v * weight)
    }
  }
  return out
}

/** 週のセット数 / 目標 を 0〜1 に丸める（目標 0 は 0） */
export function volumeHighlights(
  muscles: { muscle: Muscle; volume: number; target: number }[],
): Partial<Record<Muscle, number>> {
  const out: Partial<Record<Muscle, number>> = {}
  for (const m of muscles) {
    out[m.muscle] = m.target > 0 ? Math.min(1, Math.max(0, m.volume / m.target)) : 0
  }
  return out
}
