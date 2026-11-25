import type { Equipment } from './types'
import { roundTo } from './logic'

/** バーの重さ (kg) */
export const BAR_WEIGHT = 20
/** 使えるプレート（片側、kg）。大きい順 */
export const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25]

export interface WarmupSet {
  weight: number
  reps: number
}

const BARBELL_STEPS: { pct: number; reps: number }[] = [
  { pct: 0.4, reps: 8 },
  { pct: 0.6, reps: 5 },
  { pct: 0.8, reps: 3 },
]
const LIGHT_STEPS: { pct: number; reps: number }[] = [
  { pct: 0.5, reps: 10 },
  { pct: 0.75, reps: 5 },
]

/** 本番重量 work (kg) に向けたウォームアップのセット。不要なら空配列 */
export function warmupSets(work: number, equipment: Equipment | undefined, increment: number): WarmupSet[] {
  if (!(work > 0)) return []
  let candidates: WarmupSet[]
  if (equipment === 'barbell') {
    if (work <= BAR_WEIGHT) return []
    candidates = [
      { weight: BAR_WEIGHT, reps: 10 },
      ...BARBELL_STEPS.map(s => ({ weight: Math.max(BAR_WEIGHT, roundTo(work * s.pct, increment)), reps: s.reps })),
    ]
  } else if (equipment === 'dumbbell' || equipment === 'machine') {
    candidates = LIGHT_STEPS.map(s => ({ weight: roundTo(work * s.pct, increment), reps: s.reps })).filter(c => c.weight > 0)
  } else {
    return []
  }
  // 直前以下（重複・逆転）と、本番以上の重量は出さない
  const result: WarmupSet[] = []
  let prev = 0
  for (const c of candidates) {
    if (c.weight <= prev || c.weight >= work) continue
    result.push(c)
    prev = c.weight
  }
  return result
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface PlateResult {
  plates: number[]
  /** 片側で付けきれない端数 (kg) */
  remainder: number
}

/** 合計重量 total (kg) に必要な、バーの片側のプレートを大きい順に貪欲に求める */
export function platesPerSide(total: number, bar = BAR_WEIGHT, plates = PLATES): PlateResult {
  if (total <= bar) return { plates: [], remainder: 0 }
  let rest = round2((total - bar) / 2)
  const used: number[] = []
  for (const p of plates) {
    while (p <= rest + 1e-9) {
      used.push(p)
      rest = round2(rest - p)
    }
  }
  return { plates: used, remainder: rest > 0 ? rest : 0 }
}

/** 例：「20 + 5 + 1.25」。空なら「バーのみ」 */
export function formatPlates(r: PlateResult): string {
  const base = r.plates.length === 0 ? 'バーのみ' : r.plates.join(' + ')
  return r.remainder > 0 ? `${base}（片側 ${r.remainder}kg 足りません）` : base
}
