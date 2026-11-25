import { describe, expect, it } from 'vitest'
import { inferCauses } from './causes'
import type { CauseUsableRep } from './causes'
import type { FormContext, FormSessionSummary } from './types'

const usable = (n: number, loss: Array<number | undefined> = []): CauseUsableRep[] =>
  Array.from({ length: n }, (_, i) => ({ index: i + 1, velocityLossPct: loss[i] }))

function ctx(o: Partial<FormContext> = {}): FormContext {
  return { key: 'squat', exerciseId: 'ex1', weight: 100, history: [], ...o }
}

function hist(weight: number, count: number, reps = 5, code = 'forward-lean', confidence = 0.9): FormSessionSummary {
  return {
    date: '2026-11-01', exerciseId: 'ex1', key: 'squat', weight, reps, avgScore: 80,
    faultCounts: count ? { [code]: count } : {}, confidence,
  }
}

const find = (cs: ReturnType<typeof inferCauses>, kind: string) => cs.find(c => c.cause === kind)

describe('inferCauses：セット内のタイミング', () => {
  it('1〜2レップ目から出る：mobility・technique・structure が候補（手がかり1つなので確信度は低）', () => {
    const cs = inferCauses('forward-lean', [1, 2], usable(6), ctx(), [])
    expect(cs.map(c => c.cause)).toEqual(['mobility', 'technique', 'structure'])
    expect(cs.every(c => c.confidence === 'low')).toBe(true)
    expect(cs[0].reason).toContain('1〜2レップ目から出ている')
  })

  it('後半（最後の3分の1）だけ＋速度低下 20% 超：fatigue は最大でも mid（姿勢推定の速度は未検証）、strength は low', () => {
    const cs = inferCauses('shallow', [5, 6], usable(6, [0, 0, 0, 0, 25, 30]), ctx(), [])
    expect(cs[0]).toMatchObject({ cause: 'fatigue', confidence: 'mid' })
    expect(cs.every(c => c.confidence !== 'high')).toBe(true)
    expect(find(cs, 'strength')?.confidence).toBe('low')
    expect(find(cs, 'mobility')).toBeUndefined()
  })

  it('後半だけで速度低下 10〜20% なら fatigue は mid、速度の情報が無ければ low', () => {
    expect(inferCauses('shallow', [6], usable(6, [0, 0, 0, 0, 0, 15]), ctx(), [])[0]).toMatchObject({ cause: 'fatigue', confidence: 'mid' })
    const noVel = inferCauses('shallow', [6], usable(6), ctx(), [])
    expect(noVel).toHaveLength(1)
    expect(noVel[0]).toMatchObject({ cause: 'fatigue', confidence: 'low' })
  })

  it('bar-drift が後半だけのときは、疲労による自然な変化の注記が入る', () => {
    const cs = inferCauses('bar-drift', [6], usable(6, [0, 0, 0, 0, 0, 30]), ctx({ key: 'bench' }), [])
    expect(cs[0].reason).toContain('Duffey 2007')
  })

  it('3レップ未満ではタイミングを手がかりにしない', () => {
    expect(inferCauses('forward-lean', [1], usable(2), ctx(), [])).toEqual([])
  })

  it('途中のレップだけに出る崩れは、タイミングからは何も言わない', () => {
    expect(inferCauses('forward-lean', [3, 4], usable(6), ctx(), [])).toEqual([])
  })
})

describe('inferCauses：重量', () => {
  it('重い日だけ（軽い重量の履歴では出ていない）：load は mid、strength は low', () => {
    const c = ctx({ weight: 100, recentBestWeight: 100, history: [hist(60, 0)] })
    const cs = inferCauses('forward-lean', [3, 4, 5], usable(6), c, [])
    expect(cs[0]).toMatchObject({ cause: 'load', confidence: 'mid' })
    expect(cs[0].reason).toContain('重い日だけ')
    expect(find(cs, 'strength')?.confidence).toBe('low')
  })

  it('軽い重量のセットでも出ていれば load にしない', () => {
    const c = ctx({ weight: 100, recentBestWeight: 100, history: [hist(60, 3)] })
    expect(find(inferCauses('forward-lean', [3, 4, 5], usable(6), c, []), 'load')).toBeUndefined()
  })

  it('重量が直近最大の 95% 未満なら重い日とみなさない', () => {
    const c = ctx({ weight: 90, recentBestWeight: 100, history: [hist(50, 0)] })
    expect(inferCauses('forward-lean', [3, 4, 5], usable(6), c, [])).toEqual([])
  })

  it('履歴に軽い重量（0.9 倍未満）が無ければ判定しない', () => {
    const c = ctx({ weight: 100, recentBestWeight: 100, history: [hist(95, 0)] })
    expect(inferCauses('forward-lean', [3, 4, 5], usable(6), c, [])).toEqual([])
  })

  it('信頼度の低い履歴は使わない', () => {
    const c = ctx({ weight: 100, recentBestWeight: 100, history: [hist(60, 0, 5, 'forward-lean', 0.4)] })
    expect(inferCauses('forward-lean', [3, 4, 5], usable(6), c, [])).toEqual([])
  })
})

describe('inferCauses：推移', () => {
  it('発生率が下がってきている：technique は mid', () => {
    // 新しい順：1/5, 2/5, 4/5 → 古い順 0.8, 0.4, 0.2、今回 1/5 = 0.2
    const c = ctx({ history: [hist(100, 1), hist(100, 2), hist(100, 4)] })
    const cs = inferCauses('forward-lean', [3], usable(5), c, [])
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatchObject({ cause: 'technique', confidence: 'mid' })
    expect(cs[0].reason).toContain('下がってきている')
  })

  it('軽い重量の日も毎回出ている：mobility と structure が mid', () => {
    const c = ctx({ weight: 100, history: [hist(60, 3), hist(60, 3), hist(100, 3)] })
    const cs = inferCauses('forward-lean', [3, 4, 5], usable(5), c, [])
    expect(cs.map(x => [x.cause, x.confidence])).toEqual([['mobility', 'mid'], ['structure', 'mid']])
    expect(cs[0].reason).toContain('軽い重量の日にも毎回')
  })

  it('同じ重量で毎回出ているだけなら low', () => {
    const c = ctx({ weight: 100, history: [hist(100, 3), hist(100, 3)] })
    const cs = inferCauses('forward-lean', [3, 4, 5], usable(5), c, [])
    expect(cs.every(x => x.confidence === 'low')).toBe(true)
    expect(cs.map(x => x.cause)).toEqual(['mobility', 'structure'])
  })

  it('履歴が1回だけでは推移を言わない', () => {
    expect(inferCauses('forward-lean', [3], usable(5), ctx({ history: [hist(100, 3)] }), [])).toEqual([])
  })
})

describe('inferCauses：手がかりの重なりと組み合わせ', () => {
  it('1〜2レップ目から ＋ かかとの浮きと同時：mobility が high になり先頭に来る', () => {
    const cs = inferCauses('forward-lean', [1, 2, 3], usable(6), ctx(), ['heel-lift'])
    expect(cs[0]).toMatchObject({ cause: 'mobility', confidence: 'high' })
    expect(cs[0].reason).toContain('足首')
    expect(find(cs, 'technique')?.confidence).toBe('low')
  })

  it('1〜2レップ目から ＋ 練習で改善中：technique が high', () => {
    const c = ctx({ history: [hist(100, 1), hist(100, 2), hist(100, 4)] })
    const cs = inferCauses('forward-lean', [1], usable(5), c, [])
    expect(cs[0]).toMatchObject({ cause: 'technique', confidence: 'high' })
  })

  it('その崩れに関係しない原因は出さない（hip-rise に mobility は出ない）', () => {
    const cs = inferCauses('hip-rise', [1, 2], usable(6), ctx({ key: 'bench' }), [])
    expect(cs.map(c => c.cause)).toEqual(['technique'])
  })

  it('手がかりが何も無ければ空配列', () => {
    expect(inferCauses('forward-lean', [3], usable(6), ctx(), [])).toEqual([])
  })

  it('候補は最大3件', () => {
    const cs = inferCauses('shallow', [1, 2], usable(6), ctx({ weight: 100, history: [hist(100, 3, 5, 'shallow'), hist(100, 3, 5, 'shallow')] }), [])
    expect(cs.length).toBeLessThanOrEqual(3)
  })
})

describe('inferCauses：確信度の上限', () => {
  it('疲労は、手がかりが重なっても high にならない（後半だけ ＋ 速度低下 ＋ 改善中の推移でも mid まで）', () => {
    const c = ctx({ history: [hist(100, 1), hist(100, 2), hist(100, 4)] })
    const cs = inferCauses('forward-lean', [5, 6], usable(6, [0, 0, 0, 0, 25, 30]), c, [])
    expect(find(cs, 'fatigue')?.confidence).toBe('mid')
  })

  it('knee-valgus の原因は、手がかりが重なっても最大 mid', () => {
    // 1〜2レップ目から ＋ 練習で改善中：forward-lean なら technique が high になる組み合わせ
    const c = ctx({ history: [hist(100, 1, 5, 'knee-valgus'), hist(100, 2, 5, 'knee-valgus'), hist(100, 4, 5, 'knee-valgus')] })
    const cs = inferCauses('knee-valgus', [1], usable(5), c, [])
    expect(cs[0]).toMatchObject({ cause: 'technique', confidence: 'mid' })
    expect(cs.every(x => x.confidence !== 'high')).toBe(true)
  })

  it('基準動画が無いときの squat の shallow は最大 low、基準動画があれば従来どおり', () => {
    const c = ctx({ history: [hist(100, 1, 5, 'shallow'), hist(100, 2, 5, 'shallow'), hist(100, 4, 5, 'shallow')] })
    const noBase = inferCauses('shallow', [1], usable(5), c, [])
    expect(noBase.length).toBeGreaterThan(0)
    expect(noBase.every(x => x.confidence === 'low')).toBe(true)
    const withBase = inferCauses('shallow', [1], usable(5), { ...c, baseline: { romDeg: 100, minAngle: 70, maxAngle: 170 } }, [])
    expect(withBase[0]).toMatchObject({ cause: 'technique', confidence: 'high' })
    // bench の shallow は対象外
    const bench = inferCauses('shallow', [1], usable(5), { ...c, key: 'bench' }, [])
    expect(bench[0].confidence).toBe('high')
  })
})

describe('inferCauses：追加6種目', () => {
  it('knee-bend：技術だけが候補、確信度は最大 mid', () => {
    const cs = inferCauses('knee-bend', [1, 2], usable(6), ctx({ key: 'rdl' }), [])
    expect(cs.map(c => c.cause)).toEqual(['technique'])
    expect(cs[0].confidence).not.toBe('high')
  })

  it('lean-back：後半だけなら fatigue、mobility・structure は出さない', () => {
    const cs = inferCauses('lean-back', [5, 6], usable(6, [0, 0, 0, 0, 25, 30]), ctx({ key: 'ohp' }), [])
    expect(cs[0]).toMatchObject({ cause: 'fatigue', confidence: 'mid' })
    expect(cs.every(c => ['load', 'fatigue', 'technique'].includes(c.cause))).toBe(true)
  })

  it('lean-back：1〜2レップ目から出るなら technique だけ', () => {
    const cs = inferCauses('lean-back', [1, 2], usable(6), ctx({ key: 'ohp' }), [])
    expect(cs.map(c => c.cause)).toEqual(['technique'])
  })

  it('shallow-hinge：mobility・technique などが候補（strength・structure は出さない）', () => {
    const cs = inferCauses('shallow-hinge', [1, 2], usable(6), ctx({ key: 'rdl' }), [])
    expect(cs.map(c => c.cause)).toEqual(['mobility', 'technique'])
  })

  it('elbow-drift：重い日だけなら load', () => {
    const c = ctx({ key: 'ohext', weight: 20, recentBestWeight: 20, history: [hist(10, 0, 5, 'elbow-drift'), hist(10, 0, 5, 'elbow-drift')] })
    const cs = inferCauses('elbow-drift', [1, 2, 3], usable(6), c, [])
    expect(find(cs, 'load')).toBeDefined()
    expect(find(cs, 'strength')).toBeUndefined()
  })

  it('bss の shallow：基準なしは確信度 low まで。基準ありは high になりうる', () => {
    const base = { key: 'bss' as const }
    const noBase = inferCauses('shallow', [1, 2], usable(6), ctx(base), [])
    expect(noBase.every(c => c.confidence === 'low')).toBe(true)
    const h = [hist(100, 4, 5, 'shallow'), hist(100, 4, 5, 'shallow')]
    const withBase = inferCauses('shallow', [1, 2], usable(6), ctx({ ...base, history: h, baseline: { romDeg: 50, minAngle: 90, maxAngle: 140 } }), [])
    expect(withBase.some(c => c.confidence !== 'low')).toBe(true)
  })
})
