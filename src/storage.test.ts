import { describe, expect, it } from 'vitest'
import { defaultData, normalizeData } from './storage'

const base = () => ({ ...defaultData() })

describe('normalizeData（壊れたデータの補正）', () => {
  it('entries の無い session は空の entries で残す（メモ・体重を失わない）。日付の無い session は捨てる', () => {
    const d = normalizeData({
      ...base(),
      sessions: [{ id: 'a', date: '2026-11-20', note: 'メモ' }, { id: 'b', date: '2026-11-21', entries: [] }, { id: 'c' }],
    })
    expect(d?.sessions.map(s => s.id)).toEqual(['a', 'b'])
    expect(d?.sessions[0].entries).toEqual([])
    expect(d?.sessions[0].note).toBe('メモ')
  })
  it('sets の無い entry は捨て、他は残す', () => {
    const d = normalizeData({
      ...base(),
      sessions: [{ id: 'a', date: '2026-11-20', entries: [{ exerciseId: 'x' }, { exerciseId: 'y', sets: [] }] }],
    })
    expect(d?.sessions[0].entries.map(e => e.exerciseId)).toEqual(['y'])
  })
  it('set の weight が文字列・欠けていても数値に補正し、done は boolean にする', () => {
    const d = normalizeData({
      ...base(),
      sessions: [{ id: 'a', date: '2026-11-20', entries: [{ exerciseId: 'y', sets: [{ weight: '50', reps: 8, done: true }, { weight: 'abc' }, null] }] }],
    })
    expect(d?.sessions[0].entries[0].sets).toEqual([
      { weight: 50, reps: 8, done: true },
      { weight: 0, reps: 0, done: false },
    ])
  })
  it('weeklyTargets が配列なら空のオブジェクトにする', () => {
    expect(normalizeData({ ...base(), weeklyTargets: [1, 2] })?.weeklyTargets).toEqual({})
  })
  it('name の無い種目は捨てる', () => {
    const d = normalizeData({ ...base(), exercises: [{ id: 'a' }, { id: 'b', name: 'テスト' }] })
    expect(d?.exercises.map(e => e.id)).toEqual(['b'])
  })
  it('形式が違えば undefined', () => {
    expect(normalizeData({ version: 2 })).toBeUndefined()
  })
})
