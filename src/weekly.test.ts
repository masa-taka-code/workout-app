import { describe, expect, it } from 'vitest'
import { explainDelta, feedbackByMuscle, feedbackDelta, nextWeeklyTargets } from './weekly'
import type { AppData, Exercise, Feedback, Session } from './types'

const bench: Exercise = {
  id: 'bench', name: 'ベンチプレス', part: '胸', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2,
  primary: ['胸'], secondary: ['上腕三頭筋'],
}
const sets = [{ weight: 60, reps: 8, done: true }]
const sess = (date: string, feedback?: Feedback, exerciseId = 'bench'): Session => ({
  id: date, date, entries: [{ exerciseId, sets, feedback }],
})
const mk = (sessions: Session[], weeklyTargets: AppData['weeklyTargets'] = {}): AppData => ({
  version: 1, exercises: [bench], sessions, restSeconds: 120, weeklyTargets,
})

// 2026-11-25 は水曜。今週の月曜は 11-23、先週は 11-16〜11-22
const TODAY = '2026-11-25'
const EASY: Feedback = { pump: 0, soreness: 0, workload: 1 }

describe('feedbackDelta', () => {
  it('空なら undefined', () => expect(feedbackDelta([])).toBeUndefined())
  it('関節の痛みがあれば −1', () => expect(feedbackDelta([{ ...EASY, joint: true }])).toBe(-1))
  it('筋肉痛の平均 1.5 ちょうどで −1', () => {
    expect(feedbackDelta([{ soreness: 1 }, { soreness: 2 }])).toBe(-1)
    expect(feedbackDelta([{ soreness: 1 }, { soreness: 1 }])).toBe(0)
  })
  it('きつさの平均 1.5 以上で据え置き', () => {
    expect(feedbackDelta([{ workload: 1 }, { workload: 2 }, { pump: 0, soreness: 0 }])).toBe(0)
  })
  it('パンプ弱め・回復済み・きつくない なら +1', () => expect(feedbackDelta([EASY])).toBe(1))
  it('+1 の境界：パンプ平均 1 は対象外、筋肉痛 0.5 ときつさ 1 は対象', () => {
    expect(feedbackDelta([{ pump: 1, soreness: 0, workload: 1 }])).toBe(0)
    expect(feedbackDelta([{ pump: 0, soreness: 0, workload: 1 }, { pump: 0, soreness: 1, workload: 1 }])).toBe(1)
  })
  it('値が欠けている項目があると +1 にならない', () => {
    expect(feedbackDelta([{ soreness: 0, workload: 1 }])).toBe(0)
    expect(feedbackDelta([{ pump: 0, workload: 1 }])).toBe(0)
    expect(feedbackDelta([{ pump: 0, soreness: 0 }])).toBe(0)
    expect(feedbackDelta([{}])).toBe(0)
  })
  it('joint が false なら無視', () => expect(feedbackDelta([{ ...EASY, joint: false }])).toBe(1))
})

describe('feedbackByMuscle', () => {
  it('主働筋だけに集め、補助筋には入れない', () => {
    const r = feedbackByMuscle(mk([sess('2026-11-17', EASY)]), '2026-11-16', '2026-11-23')
    expect(r).toEqual({ 胸: [EASY] })
  })
  it('削除済みの種目・振り返りなし・期間外は無視（to は含まない）', () => {
    const d = mk([
      sess('2026-11-17', EASY, 'gone'),
      sess('2026-11-18'),
      sess('2026-11-15', EASY),
      sess('2026-11-23', EASY),
    ])
    expect(feedbackByMuscle(d, '2026-11-16', '2026-11-23')).toEqual({})
  })
  it('from は含む', () => {
    expect(feedbackByMuscle(mk([sess('2026-11-16', EASY)]), '2026-11-16', '2026-11-23')).toEqual({ 胸: [EASY] })
  })
})

describe('nextWeeklyTargets', () => {
  it('振り返りがある筋肉は +1 で上書き', () => {
    expect(nextWeeklyTargets(mk([sess('2026-11-17', EASY)], { 胸: 12 }), TODAY)).toMatchObject({ 胸: 13 })
  })
  it('未設定の目標は WEEKLY_MIN から計算', () => {
    expect(nextWeeklyTargets(mk([sess('2026-11-17', { joint: true })]), TODAY).胸).toBe(10)
  })
  it('関節の痛みで −1', () => {
    expect(nextWeeklyTargets(mk([sess('2026-11-17', { joint: true })], { 胸: 14 }), TODAY).胸).toBe(13)
  })
  it('上限 20・下限 10 に収める', () => {
    expect(nextWeeklyTargets(mk([sess('2026-11-17', EASY)], { 胸: 20 }), TODAY).胸).toBe(20)
    expect(nextWeeklyTargets(mk([sess('2026-11-17', { joint: true })], { 胸: 10 }), TODAY).胸).toBe(10)
  })
  it('先週に振り返りがなければ既存の結果（変更なし）のまま', () => {
    const d = mk([sess('2026-11-10', EASY)], { 胸: 12, 背中: 15 })
    expect(nextWeeklyTargets(d, TODAY)).toEqual({ 胸: 12, 背中: 15 })
  })
  it('他の筋肉の目標は変えない', () => {
    expect(nextWeeklyTargets(mk([sess('2026-11-17', EASY)], { 胸: 12, 背中: 15 }), TODAY)).toEqual({ 胸: 13, 背中: 15 })
  })
})

describe('空の振り返り', () => {
  it('値が1つも無い振り返りは集めない', () => {
    const d = mk([sess('2026-11-17', {}), sess('2026-11-18', { pump: undefined })])
    expect(feedbackByMuscle(d, '2026-11-16', '2026-11-23')).toEqual({})
  })
  it('空の振り返りで達成率ルールの +1 を打ち消さない', () => {
    const target = { kind: 'reps' as const, weight: 60, reps: 8, sets: 1, rir: 2, reason: '' }
    const good = (date: string, feedback?: Feedback): Session => ({
      id: date, date, entries: [{ exerciseId: 'bench', sets, target, feedback }],
    })
    const d = mk([good('2026-11-02'), good('2026-11-09'), good('2026-11-17', {})])
    expect(nextWeeklyTargets(d, TODAY).胸).toBe(11)
  })
})

describe('explainDelta', () => {
  it('理由の文', () => {
    expect(explainDelta(-1, [{ joint: true }])).toBe('関節の痛みがあったため−1')
    expect(explainDelta(-1, [{ soreness: 2 }])).toBe('筋肉痛が残っていたため−1')
    expect(explainDelta(0, [{ workload: 2 }])).toBe('きつかったため据え置き')
    expect(explainDelta(1, [EASY])).toBe('余裕があったため+1')
    expect(explainDelta(0, [{ pump: 1 }])).toBe('据え置き')
    expect(explainDelta(undefined, [])).toBe('据え置き')
  })
})
