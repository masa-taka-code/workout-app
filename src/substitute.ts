import type { AppData, Exercise } from './types'
import type { CatalogItem } from './catalog'
import { addDays, bestE1rm, historyFor } from './logic'

export interface Substitute {
  item: Exercise | CatalogItem
  reason: string
}

const MAX_SUBSTITUTES = 5
const STALL_DAYS = 42

/** 同じ主働筋で代わりになる種目（最大5件）。完全一致 > 一部一致、同順位なら伸張位が先、さらに名前順 */
export function substitutes(ex: Exercise, catalog: CatalogItem[], owned: Exercise[]): Substitute[] {
  const ownedNames = new Set(owned.map(o => o.name))
  const pool: (Exercise | CatalogItem)[] = [
    ...owned.filter(o => o !== ex && o.id !== ex.id && o.name !== ex.name),
    ...catalog.filter(c => c.name !== ex.name && !ownedNames.has(c.name)),
  ]
  const lengthenedOf = (item: Exercise | CatalogItem) =>
    'lengthened' in item ? item.lengthened : catalog.find(c => c.name === item.name)?.lengthened ?? false

  return pool
    .map(item => {
      const shared = item.primary.filter(m => ex.primary.includes(m))
      const exact = shared.length === ex.primary.length && item.primary.length === ex.primary.length
      return { item, shared, exact, lengthened: lengthenedOf(item) }
    })
    .filter(x => x.shared.length > 0)
    .sort((a, b) =>
      Number(b.exact) - Number(a.exact) ||
      Number(b.lengthened) - Number(a.lengthened) ||
      a.item.name.localeCompare(b.item.name, 'ja'))
    .slice(0, MAX_SUBSTITUTES)
    .map(x => {
      const muscles = x.shared.join('・')
      const reason = x.exact
        ? `同じ主働筋（${muscles}）${x.lengthened ? '・伸びた位置で負荷' : ''}`
        : `主働筋が一部同じ（${muscles}）${x.lengthened ? '・伸びた位置で負荷' : ''}`
      return { item: x.item, reason }
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
