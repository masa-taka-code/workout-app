import { describe, expect, it } from 'vitest'
import { formatPlates, platesPerSide, warmupSets } from './warmup'

describe('warmupSets', () => {
  it('バーベル100kg', () => {
    expect(warmupSets(100, 'barbell', 2.5)).toEqual([
      { weight: 20, reps: 10 },
      { weight: 40, reps: 8 },
      { weight: 60, reps: 5 },
      { weight: 80, reps: 3 },
    ])
  })
  it('バーベル25kgはバーのみ', () => {
    expect(warmupSets(25, 'barbell', 2.5)).toEqual([{ weight: 20, reps: 10 }])
  })
  it('バーベル20kg以下は空', () => {
    expect(warmupSets(20, 'barbell', 2.5)).toEqual([])
    expect(warmupSets(15, 'barbell', 2.5)).toEqual([])
  })
  it('ダンベル20kg', () => {
    expect(warmupSets(20, 'dumbbell', 2.5)).toEqual([
      { weight: 10, reps: 10 },
      { weight: 15, reps: 5 },
    ])
  })
  it('ダンベル2kg（刻み1）は逆転せず1つだけ', () => {
    expect(warmupSets(2, 'dumbbell', 1)).toEqual([{ weight: 1, reps: 10 }])
  })
  it('自重・その他・未設定・0kgは空', () => {
    expect(warmupSets(50, 'bodyweight', 2.5)).toEqual([])
    expect(warmupSets(50, 'other', 2.5)).toEqual([])
    expect(warmupSets(50, undefined, 2.5)).toEqual([])
    expect(warmupSets(0, 'barbell', 2.5)).toEqual([])
  })
})

describe('platesPerSide', () => {
  it('100kg は片側 40 = 25 + 15', () => {
    expect(platesPerSide(100)).toEqual({ plates: [25, 15], remainder: 0 })
  })
  it('62.5kg は片側 21.25 = 20 + 1.25', () => {
    expect(platesPerSide(62.5)).toEqual({ plates: [20, 1.25], remainder: 0 })
  })
  it('21kg は片側 0.5 が端数', () => {
    expect(platesPerSide(21)).toEqual({ plates: [], remainder: 0.5 })
  })
  it('20kg 以下はバーのみ', () => {
    expect(platesPerSide(20)).toEqual({ plates: [], remainder: 0 })
  })
})

describe('formatPlates', () => {
  it('組み合わせ・バーのみ・端数', () => {
    expect(formatPlates({ plates: [20, 5, 1.25], remainder: 0 })).toBe('20 + 5 + 1.25')
    expect(formatPlates({ plates: [], remainder: 0 })).toBe('バーのみ')
    expect(formatPlates({ plates: [20], remainder: 0.5 })).toBe('20（片側 0.5kg 足りません）')
  })
})
