import { describe, expect, it } from 'vitest'
import type { FaultFinding, RepResult } from '../form/types'
import {
  barWidth, bestRep, conditionWord, confidenceDots, groupFaults, isReferenceRep,
  onlyLowConfidence, pctText, repsText, roundShare, shareText,
} from './reportFormat'

const fault = (code: string, reps: number[], conf: 'high' | 'mid' | 'low' = 'mid'): FaultFinding => ({
  code, label: code, reps, cue: 'c', drills: [],
  causes: [{ cause: 'technique', confidence: conf, reason: 'r' }],
})
const rep = (index: number, score: number, confidence?: number): RepResult => ({
  index, score, romDeg: 90, eccentricSec: 2, concentricSec: 1, minAngle: 80, maxAngle: 170, issues: [],
  metrics: confidence === undefined ? undefined : { confidence, view: 'side', viewOk: 'ok' },
})

describe('reportFormat', () => {
  it('確信度の点と言葉', () => {
    expect(confidenceDots('high')).toEqual({ dots: '●●●', word: '高' })
    expect(confidenceDots('mid')).toEqual({ dots: '●●○', word: '中' })
    expect(confidenceDots('low')).toEqual({ dots: '●○○', word: '低' })
  })
  it('撮影条件の境目', () => {
    expect(conditionWord(0.8)).toBe('良い')
    expect(conditionWord(0.79)).toBe('ふつう')
    expect(conditionWord(0.6)).toBe('ふつう')
    expect(conditionWord(0.59)).toBe('よくない（参考値）')
  })
  it('配分は5%刻みに丸める', () => {
    expect(roundShare(0.58)).toBe(60)
    expect(roundShare(0.62)).toBe(60)
    expect(roundShare(0.43)).toBe(45)
    expect(roundShare(1.2)).toBe(100)
    expect(roundShare(-1)).toBe(0)
    expect(shareText(0.58)).toBe('約60%')
  })
  it('レップ番号の表記', () => {
    expect(repsText([5, 3, 4])).toBe('3・4・5回目')
    expect(repsText([2])).toBe('2回目')
  })
  it('崩れを改善・主・1レップだけに分け、主は多い順', () => {
    const g = groupFaults([fault('a', [1]), fault('b', [1, 2]), fault('c', []), fault('d', [1, 2, 3]), fault('e', [4, 5])])
    expect(g.improved.map(f => f.code)).toEqual(['c'])
    expect(g.main.map(f => f.code)).toEqual(['d', 'b', 'e'])
    expect(g.others.map(f => f.code)).toEqual(['a'])
  })
  it('確信度 low しかない崩れの判定', () => {
    expect(onlyLowConfidence(fault('a', [1, 2], 'low'))).toBe(true)
    expect(onlyLowConfidence(fault('a', [1, 2], 'mid'))).toBe(false)
  })
  it('参考レップと基準にするレップ', () => {
    expect(isReferenceRep(rep(1, 90, 0.5))).toBe(true)
    expect(isReferenceRep(rep(1, 90, 0.6))).toBe(false)
    expect(isReferenceRep(rep(1, 90))).toBe(false)
    expect(bestRep([rep(1, 95, 0.4), rep(2, 80, 0.9), rep(3, 85, 0.9)])?.index).toBe(3)
    expect(bestRep([rep(1, 70, 0.4), rep(2, 80, 0.3)])?.index).toBe(2)
    expect(bestRep([])).toBeUndefined()
  })
  it('割合の表記', () => {
    expect(pctText(0.846)).toBe('85%')
    expect(barWidth(1.5)).toBe(100)
    expect(barWidth(0.333)).toBe(33)
  })
})
