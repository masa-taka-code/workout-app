import type { AppData, Equipment, Exercise } from './types'
import { EQUIPMENTS } from './types'
import { PATTERN_LABELS } from './catalog'
import type { CatalogItem, MovementPattern } from './catalog'
import { addDays, bestE1rm, historyFor } from './logic'

export interface Substitute {
  item: Exercise | CatalogItem
  reason: string
}

const MAX_SUBSTITUTES = 5
const STALL_DAYS = 42

/** 動きの型の近さ（設計値・暫定）。同じ型は 1、表にない組み合わせは 0（候補から外す） */
const PATTERN_SIM: [MovementPattern, MovementPattern, number][] = [
  ['squat', 'lunge', 0.75],
  ['squat', 'knee_extension', 0.5],
  ['lunge', 'knee_extension', 0.5],
  ['squat', 'hip_extension', 0.25],
  ['lunge', 'hip_extension', 0.25],
  ['hinge', 'hip_extension', 0.5],
  ['hinge', 'knee_flexion', 0.5],
  ['horizontal_push', 'chest_fly', 0.5],
  ['vertical_pull', 'horizontal_pull', 0.5],
  ['vertical_pull', 'shoulder_extension', 0.5],
  ['horizontal_pull', 'shoulder_extension', 0.25],
]

/** 型が不明（カタログにない自作種目）のときの近さ。外さない */
const UNKNOWN_SIM = 0.5

/**
 * スコアの重み（すべて設計値・暫定。根拠のある数値ではない）。
 * 動きの型 > 多関節/単関節の一致 > 主働筋の一致 > 強度 > 伸張位 の順の考え方。
 */
const W = {
  pattern: 100,
  compound: 30,
  primary: 20,
  loadability: 10,
  lengthened: 5,
  secondary: 5,
  equipment: 15, // 関節の痛み・停滞のとき、器具が違う種目に加点（設計値）
  stability: 8, // 関節の痛みのとき、元より安定させやすい種目に加点（設計値）
}

interface Attrs {
  pattern?: MovementPattern
  compound?: boolean
  loadability?: number
  stability?: number
  lengthened: boolean
  equipment: Equipment
}

function patternSim(a?: MovementPattern, b?: MovementPattern): number {
  if (!a || !b) return UNKNOWN_SIM
  if (a === b) return 1
  return PATTERN_SIM.find(([x, y]) => (x === a && y === b) || (x === b && y === a))?.[2] ?? 0
}

function jaccard<T>(a: T[], b: T[]): number {
  const union = new Set([...a, ...b])
  if (union.size === 0) return 0
  return a.filter(x => b.includes(x)).length / union.size
}

/** 種目の属性。カタログの種目はそのまま、自作の種目は同名のカタログから引く（なければ型不明） */
function attrsOf(item: Exercise | CatalogItem, catalog: CatalogItem[]): Attrs {
  const found: CatalogItem | undefined = 'lengthened' in item ? item : catalog.find(c => c.name === item.name)
  return {
    pattern: found?.pattern,
    compound: found?.compound,
    loadability: found?.loadability,
    stability: found?.stability,
    lengthened: found?.lengthened ?? false,
    equipment: item.equipment ?? 'other',
  }
}

/**
 * 代わりになる種目（最大5件）。主働筋が重なり、動きの型が近い種目だけを、
 * 動きの型 > 多関節/単関節 > 主働筋の重なり > 強度 > 伸張位 の順のスコアで並べる（同点は名前順）。
 * reason が 'joint'（関節の痛み）/ 'stall'（停滞）のときは器具違いなどを少し加点する。
 */
export function substitutes(
  ex: Exercise, catalog: CatalogItem[], owned: Exercise[], reason?: 'joint' | 'stall',
): Substitute[] {
  const ownedNames = new Set(owned.map(o => o.name))
  const pool: (Exercise | CatalogItem)[] = [
    ...owned.filter(o => o !== ex && o.id !== ex.id && o.name !== ex.name),
    ...catalog.filter(c => c.name !== ex.name && !ownedNames.has(c.name)),
  ]
  const exAttrs = attrsOf(ex, catalog)
  const joint = reason === 'joint'

  return pool
    .map(item => {
      const at = attrsOf(item, catalog)
      const sim = patternSim(exAttrs.pattern, at.pattern)
      const known = exAttrs.pattern !== undefined && at.pattern !== undefined
      const shared = item.primary.filter(m => ex.primary.includes(m))
      const exact = shared.length === ex.primary.length && item.primary.length === ex.primary.length
      const sameCompound = exAttrs.compound !== undefined && at.compound !== undefined && exAttrs.compound === at.compound
      const bothLoad = exAttrs.loadability !== undefined && at.loadability !== undefined
      const equipDiff = (reason === 'joint' || reason === 'stall') && sim > 0 && exAttrs.equipment !== at.equipment
      const stabGain = joint && exAttrs.stability !== undefined && at.stability !== undefined
        ? Math.max(0, exAttrs.stability - at.stability) : 0
      const lengthenedBonus = !joint && at.lengthened

      const score =
        W.pattern * sim +
        (sim > 0 && sameCompound ? W.compound : 0) +
        W.primary * jaccard(ex.primary, item.primary) +
        (!joint && bothLoad ? W.loadability * (1 - Math.abs(exAttrs.loadability! - at.loadability!) / 2) : 0) +
        (lengthenedBonus ? W.lengthened : 0) +
        W.secondary * jaccard(ex.secondary, item.secondary) +
        (equipDiff ? W.equipment : 0) +
        W.stability * stabGain

      return { item, at, sim, known, shared, exact, score, equipDiff, stabGain, lengthenedBonus }
    })
    .filter(x => x.shared.length > 0 && x.sim > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'ja'))
    .slice(0, MAX_SUBSTITUTES)
    .map(x => {
      const muscles = x.shared.join('・')
      let body: string
      if (!x.known) {
        body = x.exact ? `同じ主働筋（${muscles}）` : `主働筋が一部同じ（${muscles}）`
      } else if (x.sim === 1) {
        body = `同じ${PATTERN_LABELS[x.at.pattern!]}の${x.at.compound ? '多関節' : '単関節'}種目`
      } else if (x.sim >= 0.5) {
        body = `近い動き「${PATTERN_LABELS[x.at.pattern!]}」・主働筋（${muscles}）が同じ`
      } else {
        body = `主働筋が一部同じ（${muscles}）`
      }
      // 付け足しは最大1つ。当てはまる最初のもの
      let extra = ''
      if (joint && x.equipDiff) extra = `器具が違う（${EQUIPMENTS.find(q => q.value === x.at.equipment)?.label}）`
      else if (joint && x.stabGain > 0) extra = '安定させやすい'
      else if (reason === 'stall' && x.equipDiff) extra = '器具が違い刺激を変えられる'
      else if (exAttrs.compound === true && x.at.loadability === 2) extra = '高重量を扱える'
      else if (x.lengthenedBonus) extra = '伸びた位置で負荷'
      return { item: x.item, reason: extra ? `${body}・${extra}` : body }
    })
}

/** 入れ替えを勧める条件（関節の痛み・6週以上の停滞）を満たしたときだけメッセージを返す */
export function rotationHint(
  ex: Exercise, data: AppData, today: string,
): { kind: 'joint' | 'stall'; message: string } | undefined {
  const history = historyFor(ex.id, data.sessions, today) // 新しい順
  if (history.slice(0, 2).some(e => e.feedback?.joint === true)) {
    return { kind: 'joint', message: '関節の痛みが記録されています。痛みの出にくい種目への入れ替えを検討してください' }
  }

  if (history.length >= 4) {
    const first = data.sessions
      .filter(s => s.date < today && s.entries.some(e => e.exerciseId === ex.id && history.includes(e)))
      .map(s => s.date)
      .sort()[0]
    if (first && addDays(first, STALL_DAYS) <= today) {
      const recentBest = history.slice(0, 3).map(e => bestE1rm(e, ex))
      const priorBest = Math.max(0, ...history.slice(3).map(e => bestE1rm(e, ex)))
      if (recentBest.every(v => v <= priorBest)) {
        return { kind: 'stall', message: '6週以上続けて、直近3回は自己ベストを更新していません。入れ替えを検討する時期です' }
      }
    }
  }
  return undefined
}
