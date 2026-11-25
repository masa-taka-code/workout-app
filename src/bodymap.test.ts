import { describe, expect, it } from 'vitest'
import { MUSCLE_TO_REGIONS, exerciseHighlights, regionIntensities, volumeHighlights } from './bodymap'
import { MUSCLES } from './types'
import type { Exercise } from './types'

describe('MUSCLE_TO_REGIONS', () => {
  it('全ての筋肉が1つ以上の部位に対応する', () => {
    for (const m of MUSCLES) expect(MUSCLE_TO_REGIONS[m].length).toBeGreaterThan(0)
  })
  it('背中は上背部のみ（腰は含めない）', () => {
    expect(MUSCLE_TO_REGIONS['背中'].map(r => r.region)).toEqual(['upper-back'])
  })
})

describe('regionIntensities', () => {
  it('肩側部は前後の三角筋に弱めに、肩前部とは強いほうをとる', () => {
    expect(regionIntensities({ 肩側部: 1 })).toEqual({ 'front-deltoids': 0.5, 'back-deltoids': 0.5 })
    expect(regionIntensities({ 肩側部: 1, 肩前部: 0.5 })['front-deltoids']).toBe(0.5)
  })
  it('0・未指定は塗らない。範囲外は丸める', () => {
    expect(regionIntensities({ 胸: 0 })).toEqual({})
    expect(regionIntensities({ 胸: 3 })).toEqual({ chest: 1 })
  })
  it('腹筋は腹直筋と腹斜筋に対応する', () => {
    expect(regionIntensities({ 腹筋: 1 })).toEqual({ abs: 1, obliques: 1 })
  })
})

describe('exerciseHighlights', () => {
  it('主働筋 1、補助筋 0.5', () => {
    const ex = { primary: ['胸'], secondary: ['上腕三頭筋'] } as Exercise
    expect(exerciseHighlights(ex)).toEqual({ 胸: 1, 上腕三頭筋: 0.5 })
  })
})

describe('volumeHighlights', () => {
  it('volume / target を 0〜1 に丸め、target 0 は 0', () => {
    const out = volumeHighlights([
      { muscle: '胸', volume: 5, target: 10 },
      { muscle: '背中', volume: 30, target: 10 },
      { muscle: '腹筋', volume: 4, target: 0 },
    ])
    expect(out).toEqual({ 胸: 0.5, 背中: 1, 腹筋: 0 })
  })
})
