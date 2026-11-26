import { describe, expect, it } from 'vitest'
import type { FaultFinding, PersonalBaseline, RepResult } from '../form/types'
import {
  BASELINE_TOO_FEW_TEXT, badPlacementReps, barWidth, baselineButtonText, baselineConfirmText, conditionWord, confidenceDots, groupFaults, isReferenceRep,
  levelIndex, onlyLowConfidence, pctText, repsText, roundShare, shareText,
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
  it('負荷配分の段階の位置（膝優位 0 〜 股関節優位 3、段階でなければ -1）', () => {
    expect(['膝優位', 'やや膝寄り', 'やや股関節寄り', '股関節優位'].map(levelIndex)).toEqual([0, 1, 2, 3])
    expect(levelIndex(undefined)).toBe(-1)
    expect(levelIndex('中立')).toBe(-1)
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
  it('参考レップの判定', () => {
    expect(isReferenceRep(rep(1, 90, 0.5))).toBe(true)
    expect(isReferenceRep(rep(1, 90, 0.6))).toBe(false)
    expect(isReferenceRep(rep(1, 90))).toBe(false)
  })
  it('割合の表記', () => {
    expect(pctText(0.846)).toBe('85%')
    expect(barWidth(1.5)).toBe(100)
    expect(barWidth(0.333)).toBe(33)
  })
})

describe('撮影条件が悪かった回', () => {
  it('placementOk=false のレップ番号を返し、参考値として扱う', () => {
    const bad: RepResult = { ...rep(2, 90, 0.9), metrics: { confidence: 0.9, view: 'side', viewOk: 'ok', placementOk: false } }
    const reps = [rep(1, 80, 0.9), bad, rep(3, 70)]
    expect(badPlacementReps(reps)).toEqual([2])
    expect(isReferenceRep(bad)).toBe(true)
    expect(isReferenceRep(reps[0])).toBe(false)
    expect(badPlacementReps([rep(1, 80, 0.9)])).toEqual([])
  })
})

describe('自分の基準の文言', () => {
  const base = (belowGeneral: string[]): PersonalBaseline => ({
    version: 2, key: 'squat', savedAt: '2026-11-26', weight: 60, repCount: 4, stats: {}, conditions: { source: 'live', view: 'side' }, belowGeneral,
  })
  it('ボタンと、レップが足りないときの案内', () => {
    expect(baselineButtonText(4)).toBe('このセットを基準にする（条件の良い 4 レップの中央値）')
    expect(BASELINE_TOO_FEW_TEXT).toBe('条件の良いレップが3回以上必要です')
  })
  it('一般の目安でも崩れていた基準は、「浅い／前傾が大きい」と出ていると伝えて確かめる', () => {
    expect(baselineConfirmText(base([]))).toContain('上書き')
    expect(baselineConfirmText(base(['shallow']))).toBe('この基準は一般の目安では浅いと出ています。それでも基準にしますか？')
    expect(baselineConfirmText(base(['forward-lean', 'shallow']))).toBe('この基準は一般の目安では前傾が大きい／浅いと出ています。それでも基準にしますか？')
  })
})
