import { describe, expect, it } from 'vitest'
import { defaultData } from './storage'
import type { AppData, Session } from './types'
import { bodyWeightAlert, weeklyBodyWeights } from './weight'

// 2026-11-26 は木曜。今週の月曜は 2026-11-23
const TODAY = '2026-11-26'
const MONDAYS = ['2026-11-02', '2026-11-09', '2026-11-16'] // 先週は 11-16、その前は 11-09, 11-02
const ses = (date: string, bodyWeight?: number): Session => ({ id: date, date, entries: [], bodyWeight })
/** 週の月曜と水曜に同じ体重を記録（週平均 = w） */
const week = (monday: string, w: number, wed: string): Session[] => [ses(monday, w), ses(wed, w)]
const wk = (offset: number, w: number): Session[] => {
  const mon = new Date(2026, 10, 23 + offset * 7)
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const wed = new Date(mon)
  wed.setDate(wed.getDate() + 2)
  return week(f(mon), w, f(wed))
}
const data = (sessions: Session[], bodyGoal?: AppData['bodyGoal']): AppData => ({ ...defaultData(), sessions, bodyGoal })
// 4週分（3週前〜先週）：70 → 69 → 68.5 → 68（約2.9%減、週約1.0%）
const losing = () => [...wk(-4, 70), ...wk(-3, 69.5), ...wk(-2, 69), ...wk(-1, 68)]

describe('weeklyBodyWeights', () => {
  it('週ごとに平均し、古い順に返す', () => {
    const r = weeklyBodyWeights([ses('2026-11-11', 70), ses('2026-11-09', 72), ses('2026-11-02', 60), ses('2026-11-03', 62)], TODAY)
    expect(r).toEqual([
      { week: '2026-11-02', avg: 61, n: 2 },
      { week: '2026-11-09', avg: 71, n: 2 },
    ])
  })
  it('記録が WEIGHT_MIN_PER_WEEK 未満の週は除く', () => {
    expect(weeklyBodyWeights([ses('2026-11-09', 70)], TODAY)).toEqual([])
  })
  it('today 以降は含めない', () => {
    const r = weeklyBodyWeights([ses('2026-11-23', 70), ses('2026-11-25', 70), ses('2026-11-26', 70)], TODAY)
    expect(r).toEqual([{ week: '2026-11-23', avg: 70, n: 2 }])
  })
  it('0・NaN・負・未記録は除外する', () => {
    const r = weeklyBodyWeights([ses('2026-11-09', 0), ses('2026-11-10', NaN), ses('2026-11-11', -5), ses('2026-11-12'), ses('2026-11-13', 70)], TODAY)
    expect(r).toEqual([])
  })
})

describe('bodyWeightAlert', () => {
  it('未設定は gain 扱いで、3週続けて 0.5%/週 以上減っていれば under-eating', () => {
    const a = bodyWeightAlert(data(losing()), TODAY)
    expect(a?.kind).toBe('under-eating')
    expect(a?.pctPerWeek).toBeCloseTo(((70 - 68) / 70 / 3) * 100, 5)
    expect(a?.message).toBe('体重が3週間で約2.9%減っています。筋肉を増やすには、食事量が足りていない可能性があります')
  })
  it('maintain でも通知する', () => {
    expect(bodyWeightAlert(data(losing(), 'maintain'), TODAY)?.kind).toBe('under-eating')
  })
  it("'off' は通知しない", () => {
    expect(bodyWeightAlert(data(losing(), 'off'), TODAY)).toBeUndefined()
  })
  it('減少率が 0.5%/週 以上なら通知し、それ未満なら通知しない', () => {
    // 100 → 99.5 → 99 → 98.5：総減少 1.5% = 0.5%/週
    const edge = [...wk(-4, 100), ...wk(-3, 99.5), ...wk(-2, 99), ...wk(-1, 98.5)]
    expect(bodyWeightAlert(data(edge), TODAY)?.pctPerWeek).toBeCloseTo(0.5, 10)
    const above = [...wk(-4, 100), ...wk(-3, 99.4), ...wk(-2, 98.8), ...wk(-1, 98.4)]
    expect(bodyWeightAlert(data(above), TODAY)?.kind).toBe('under-eating')
    const below = [...wk(-4, 100), ...wk(-3, 99.8), ...wk(-2, 99.6), ...wk(-1, 99.4)]
    expect(bodyWeightAlert(data(below), TODAY)).toBeUndefined()
  })
  it('途中で増えた週・同じ値の週があれば通知しない', () => {
    const up = [...wk(-4, 70), ...wk(-3, 68), ...wk(-2, 69), ...wk(-1, 67)]
    expect(bodyWeightAlert(data(up), TODAY)).toBeUndefined()
    const flat = [...wk(-4, 70), ...wk(-3, 69), ...wk(-2, 69), ...wk(-1, 67)]
    expect(bodyWeightAlert(data(flat), TODAY)).toBeUndefined()
  })
  it('3週分しかなければ通知しない', () => {
    expect(bodyWeightAlert(data([...wk(-3, 70), ...wk(-2, 69), ...wk(-1, 68)]), TODAY)).toBeUndefined()
  })
  it('途中に欠けた週があれば通知しない', () => {
    expect(bodyWeightAlert(data([...wk(-5, 72), ...wk(-4, 70), ...wk(-2, 69), ...wk(-1, 67)]), TODAY)).toBeUndefined()
  })
  it('直近が先週でない（先週の記録がない）なら通知しない', () => {
    expect(bodyWeightAlert(data([...wk(-5, 72), ...wk(-4, 70), ...wk(-3, 69), ...wk(-2, 67)]), TODAY)).toBeUndefined()
  })
  it('記録が1回しかない週があれば欠けた週と同じ扱いで通知しない', () => {
    const s = [...wk(-4, 70), ...wk(-3, 69), ses('2026-11-09', 68), ...wk(-1, 66)]
    expect(MONDAYS.length).toBe(3)
    expect(bodyWeightAlert(data(s), TODAY)).toBeUndefined()
  })
  it('今週の記録は判定に使わない', () => {
    const s = [...losing(), ses('2026-11-23', 90), ses('2026-11-24', 90)]
    expect(bodyWeightAlert(data(s), TODAY)?.kind).toBe('under-eating')
  })
  it('0・NaN・負の体重は無視する', () => {
    const s = [...losing(), ses('2026-11-10', 0), ses('2026-11-11', NaN), ses('2026-11-12', -3)]
    expect(bodyWeightAlert(data(s), TODAY)?.kind).toBe('under-eating')
  })
  it('cut：1.0%/週 ちょうどは通知せず、超えれば cut-too-fast', () => {
    const exact = [...wk(-4, 100), ...wk(-3, 99), ...wk(-2, 98), ...wk(-1, 97)]
    expect(bodyWeightAlert(data(exact, 'cut'), TODAY)).toBeUndefined()
    const fast = [...wk(-4, 100), ...wk(-3, 98.7), ...wk(-2, 97.4), ...wk(-1, 96.1)]
    const a = bodyWeightAlert(data(fast, 'cut'), TODAY)
    expect(a?.kind).toBe('cut-too-fast')
    expect(a?.message).toBe('体重が週約1.3%のペースで減っています。筋肉を保つには、もう少しゆっくり減らすのがおすすめです')
  })
  it('cut：ゆるやかな減少（0.5%/週）は通知しない', () => {
    const slow = [...wk(-4, 100), ...wk(-3, 99.5), ...wk(-2, 99), ...wk(-1, 98.5)]
    expect(bodyWeightAlert(data(slow, 'cut'), TODAY)).toBeUndefined()
  })
})
