import { describe, expect, it } from 'vitest'
import { defaultData, normalizeData } from './storage'
import type { Exercise } from './types'

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

describe('normalizeData（種目・週目標・セッションid）', () => {
  const exOf = (raw: Record<string, unknown>) =>
    normalizeData({ ...base(), exercises: [{ id: 'a', name: 'テスト', ...raw }] })?.exercises[0] as Exercise

  it('primary: null や筋肉にない値は既定値（part からの fallback）に戻る', () => {
    expect(exOf({ part: '胸', primary: null, secondary: 'x' }).primary).toEqual(['胸'])
    expect(exOf({ part: '胸', primary: null, secondary: 'x' }).secondary).toEqual([])
    expect(exOf({ part: '脚', primary: ['ほげ'] }).primary).toEqual(['大腿四頭筋'])
    expect(exOf({ primary: ['胸', 3, 'ほげ'], secondary: ['背中', 'ほげ'] })).toMatchObject({ primary: ['胸'], secondary: ['背中'] })
  })
  it('壊れた数値は既定値に戻り、他の項目は残る', () => {
    const e = exOf({ repMin: 'abc', repMax: NaN, sets: 2.5, increment: 0, targetRir: -1, part: 5, equipment: 'machine' })
    expect(e).toMatchObject({ repMin: 8, repMax: 12, sets: 3, increment: 2.5, targetRir: 2, part: 'その他', equipment: 'machine' })
  })
  it('正しい数値はそのまま残す', () => {
    expect(exOf({ repMin: 5, repMax: 7, sets: 4, increment: 1, targetRir: 0 })).toMatchObject({ repMin: 5, repMax: 7, sets: 4, increment: 1, targetRir: 0 })
  })
  it('repMin > repMax なら両方を既定値にする', () => {
    expect(exOf({ repMin: 15, repMax: 6 })).toMatchObject({ repMin: 8, repMax: 12 })
  })
  it('weeklyTargets：文字列・未知キーは捨て、範囲外は 10〜20 に収める', () => {
    const d = normalizeData({ ...base(), weeklyTargets: { 胸: '12', 背中: 25, 肩前部: 3, 臀筋: 14, ほげ: 15, 腹筋: NaN } })
    expect(d?.weeklyTargets).toEqual({ 背中: 20, 肩前部: 10, 臀筋: 14 })
  })
  it('session の id が無い・空・重複なら別々の新しい id になる（最初のものは元のまま）', () => {
    const d = normalizeData({
      ...base(),
      sessions: [
        { id: 'a', date: '2026-11-20', entries: [] },
        { id: 'a', date: '2026-11-21', entries: [] },
        { date: '2026-11-22', entries: [] },
        { id: '', date: '2026-11-23', entries: [] },
        { id: 5, date: '2026-11-24', entries: [] },
      ],
    })
    const ids = d?.sessions.map(s => s.id) ?? []
    expect(ids[0]).toBe('a')
    expect(ids.every(i => typeof i === 'string' && i !== '')).toBe(true)
    expect(new Set(ids).size).toBe(5)
  })
})
