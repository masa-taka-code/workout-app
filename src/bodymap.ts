import type { Exercise, Muscle } from './types'

/** 種目の効いている筋肉：主働筋 1.0、補助筋 0.5 */
export function exerciseHighlights(ex: Exercise): Partial<Record<Muscle, number>> {
  const out: Partial<Record<Muscle, number>> = {}
  for (const m of ex.secondary) out[m] = 0.5
  for (const m of ex.primary) out[m] = 1
  return out
}
