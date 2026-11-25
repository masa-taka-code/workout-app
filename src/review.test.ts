import { describe, expect, it } from 'vitest'
import { weekReview } from './review'
import type { AppData, Exercise, Session } from './types'

const bench: Exercise = {
  id: 'bench', name: 'ベンチプレス', part: '胸', repMin: 5, repMax: 8, increment: 2.5, sets: 3, targetRir: 2,
  primary: ['胸'], secondary: ['上腕三頭筋'], equipment: 'barbell',
}

const sess = (date: string, weight: number, reps: number, n = 3, extra: Partial<Session['entries'][0]> = {}): Session => ({
  id: date,
  date,
  entries: [{ exerciseId: 'bench', sets: Array.from({ length: n }, () => ({ weight, reps, done: true, rir: 0 })), ...extra }],
})

const mk = (sessions: Session[], weeklyTargets: AppData['weeklyTargets'] = {}): AppData => ({
  version: 1, exercises: [bench], sessions, restSeconds: 90, weeklyTargets,
})

// 2026-11-25 は水曜。先週 = 11/16(月)〜11/22(日)
const TODAY = '2026-11-25'

describe('weekReview', () => {
  it('記録なしは全部0・空', () => {
    const r = weekReview(mk([]), TODAY)
    expect(r.week).toBe('2026-11-16')
    expect(r.sessions).toBe(0)
    expect(r.totalSets).toBe(0)
    expect(r.muscles).toEqual([])
    expect(r.rate).toBeUndefined()
    expect(r.prs).toEqual([])
    expect(r.activeWeeks).toEqual({ count: 0, of: 8 })
  })

  it('先週のセッション数とセット数（今週・先々週は数えない）', () => {
    const r = weekReview(mk([sess('2026-11-16', 60, 8), sess('2026-11-22', 60, 8, 2), sess('2026-11-23', 60, 8), sess('2026-11-15', 60, 8)]), TODAY)
    expect(r.sessions).toBe(2)
    expect(r.totalSets).toBe(5)
  })

  it('完了セットのないセッションは数えない', () => {
    const s = sess('2026-11-17', 60, 8)
    s.entries[0].sets.forEach(x => { x.done = false })
    expect(weekReview(mk([s]), TODAY).sessions).toBe(0)
  })

  it('筋肉ごとの部分セットと目標', () => {
    const r = weekReview(mk([sess('2026-11-17', 60, 8, 3)], { 背中: 12 }), TODAY)
    expect(r.muscles).toEqual([
      { muscle: '胸', volume: 3, target: 10, met: false },
      { muscle: '背中', volume: 0, target: 12, met: false },
      { muscle: '上腕三頭筋', volume: 1.5, target: 10, met: false },
    ])
  })

  it('目標達成の判定（volume >= target）', () => {
    const r = weekReview(mk([sess('2026-11-17', 60, 8, 5), sess('2026-11-19', 60, 8, 5)]), TODAY)
    expect(r.muscles.find(m => m.muscle === '胸')?.met).toBe(true)
  })

  it('目標達成率', () => {
    const t = { kind: 'reps' as const, weight: 60, reps: 8, sets: 3, rir: 2, reason: '' }
    const r = weekReview(mk([sess('2026-11-17', 60, 8, 3, { target: t })]), TODAY)
    expect(r.rate).toBe(1)
  })

  it('自己ベスト更新：以前より高ければ含む（小数1桁）', () => {
    const r = weekReview(mk([sess('2026-11-01', 60, 8), sess('2026-11-17', 62.5, 8)]), TODAY)
    expect(r.prs).toHaveLength(1)
    expect(r.prs[0].name).toBe('ベンチプレス')
    expect(r.prs[0].e1rm).toBe(Math.round(62.5 * (1 + 8 / 30) * 10) / 10)
    expect(r.prs[0].previous).toBe(Math.round(60 * (1 + 8 / 30) * 10) / 10)
  })

  it('初記録・同じ・下回りは自己ベストに含めない', () => {
    expect(weekReview(mk([sess('2026-11-17', 60, 8)]), TODAY).prs).toEqual([])
    expect(weekReview(mk([sess('2026-11-01', 60, 8), sess('2026-11-17', 60, 8)]), TODAY).prs).toEqual([])
    expect(weekReview(mk([sess('2026-11-01', 70, 8), sess('2026-11-17', 60, 8)]), TODAY).prs).toEqual([])
  })

  it('今週の記録は自己ベスト判定に影響しない', () => {
    const r = weekReview(mk([sess('2026-11-01', 60, 8), sess('2026-11-17', 62.5, 8), sess('2026-11-24', 100, 8)]), TODAY)
    expect(r.prs[0].previous).toBe(Math.round(60 * (1 + 8 / 30) * 10) / 10)
  })

  describe('activeWeeks', () => {
    it('週2回以上の週を数える（1回の週は数えない）', () => {
      const r = weekReview(mk([
        sess('2026-11-16', 60, 8), sess('2026-11-18', 60, 8), // 先週：2回
        sess('2026-11-09', 60, 8), // 1回
        sess('2026-11-02', 60, 8), sess('2026-11-08', 60, 8), // 2回
      ]), TODAY)
      expect(r.activeWeeks).toEqual({ count: 2, of: 8 })
    })

    it('今週は含まない', () => {
      const r = weekReview(mk([sess('2026-11-23', 60, 8), sess('2026-11-24', 60, 8)]), TODAY)
      expect(r.activeWeeks.count).toBe(0)
    })

    it('8週前（境界）は含み、9週前は含まない', () => {
      // 先週=11/16。8週前の月曜 = 11/16 - 49日 = 2026-09-28、9週前 = 2026-09-21
      const in8 = [sess('2026-09-28', 60, 8), sess('2026-09-29', 60, 8)]
      const in9 = [sess('2026-09-21', 60, 8), sess('2026-09-22', 60, 8)]
      expect(weekReview(mk(in8), TODAY).activeWeeks.count).toBe(1)
      expect(weekReview(mk(in9), TODAY).activeWeeks.count).toBe(0)
    })
  })
})
