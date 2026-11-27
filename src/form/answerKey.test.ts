import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANSWER_KEYS_STORAGE_KEY, MAX_ANSWER_KEYS, addAnswerKey, angleDiffs, angleFromPoints, angleJoints, angleStats,
  countScore, deriveAppReps, evaluate, loadAnswerKeys, matchReps, nearestFrame, normalizeAnswerKeys, summarizeKeys,
} from './answerKey'
import type { AnswerKeyRecord, AppRep, TraceFrame } from './answerKey'

const rec = (i: number, over: Partial<AnswerKeyRecord> = {}): AnswerKeyRecord => ({
  id: `r${i}`, date: '2026-11-27', exerciseKey: 'squat', view: 'side', appReps: 3, trueReps: 3,
  reps: [{ appBottomT: 1, trueBottomT: 1.1, appAngle: 90, trueAngle: 95, matched: true }], ...over,
})

describe('matchReps', () => {
  it('±0.5 秒以内は一致、外は誤検出と見逃し', () => {
    const m = matchReps([1, 3, 10], [1.4, 3.6, 5])
    expect(m.pairs).toEqual([[0, 0]])
    expect(m.unmatchedApp).toEqual([1, 2])
    expect(m.unmatchedTrue).toEqual([1, 2])
  })
  it('1 対 1：近い方を優先し、同じ正解を 2 回使わない', () => {
    const m = matchReps([1.0, 1.3], [1.2])
    expect(m.pairs).toEqual([[1, 0]])
    expect(m.unmatchedApp).toEqual([0])
  })
  it('空どうし', () => {
    expect(matchReps([], [])).toEqual({ pairs: [], unmatchedApp: [], unmatchedTrue: [] })
  })
})

describe('countScore', () => {
  it('適合率・再現率・F1', () => {
    const s = countScore(5, 4, 3)
    expect(s.diff).toBe(1)
    expect(s.falsePositives).toBe(2)
    expect(s.misses).toBe(1)
    expect(s.precision).toBeCloseTo(0.6)
    expect(s.recall).toBeCloseTo(0.75)
    expect(s.f1).toBeCloseTo((2 * 0.6 * 0.75) / 1.35)
  })
  it('0 件のときは割り算しない', () => {
    const z = countScore(0, 0, 0)
    expect(z.precision).toBeUndefined()
    expect(z.recall).toBeUndefined()
    expect(z.f1).toBeUndefined()
    const a = countScore(0, 3, 0)
    expect(a.precision).toBeUndefined()
    expect(a.recall).toBe(0)
    expect(a.f1).toBeUndefined()
    expect(countScore(2, 2, 0).f1).toBe(0)
  })
})

describe('angleStats', () => {
  it('件数 0', () => {
    expect(angleStats([])).toEqual({ n: 0 })
  })
  it('件数 1 は平均の差と MAE だけ（SD・範囲は出さない）', () => {
    expect(angleStats([-4])).toEqual({ n: 1, meanDiff: -4, mae: 4 })
  })
  it('平均・SD・MAE・一致の範囲', () => {
    const s = angleStats([2, -4, 6])
    expect(s.meanDiff).toBeCloseTo(4 / 3)
    expect(s.mae).toBeCloseTo(4)
    // 標本 SD：差の二乗和 = (2/3)^2 + (16/3)^2 + (14/3)^2 → /2
    expect(s.sd).toBeCloseTo(Math.sqrt(((2 / 3) ** 2 + (16 / 3) ** 2 + (14 / 3) ** 2) / 2))
    expect(s.loaHigh).toBeCloseTo((s.meanDiff as number) + 1.96 * (s.sd as number))
    expect(s.loaLow).toBeCloseTo((s.meanDiff as number) - 1.96 * (s.sd as number))
  })
  it('有限でない値は数えない', () => {
    expect(angleStats([NaN, 3]).n).toBe(1)
  })
})

describe('evaluate', () => {
  const app: AppRep[] = [
    { bottomT: 1, angle: 90 },
    { bottomT: 3, angle: 100 },
    { bottomT: 8, angle: 80 }, // 誤検出
  ]
  const truth = [
    { bottomT: 1.2, angle: 95 },
    { bottomT: 3.1 }, // 角度なし
    { bottomT: 5, angle: 70 }, // 見逃し
  ]
  it('一致・誤検出・見逃しと、角度の差（両方の角度がある一致だけ）', () => {
    const r = evaluate(app, truth)
    expect(r.count.matched).toBe(2)
    expect(r.count.falsePositives).toBe(1)
    expect(r.count.misses).toBe(1)
    expect(r.count.diff).toBe(0)
    expect(r.rows).toHaveLength(4)
    expect(angleDiffs(r.rows)).toEqual([-5])
    expect(r.angle).toEqual({ n: 1, meanDiff: -5, mae: 5 })
    // undefined の項目は行に残さない
    expect(Object.keys(r.rows[1])).not.toContain('trueAngle')
  })
  it('どちらも空', () => {
    const r = evaluate([], [])
    expect(r.rows).toEqual([])
    expect(r.count.diff).toBe(0)
    expect(r.angle.n).toBe(0)
  })
})

describe('deriveAppReps / nearestFrame / angleFromPoints', () => {
  // 0〜10 秒を 0.1 秒刻み。2 秒と 6 秒に谷
  const trace: TraceFrame[] = Array.from({ length: 101 }, (_, i) => {
    const t = i / 10
    const a = 170 - 80 * Math.max(0, 1 - Math.abs(t - 2) / 1) - 80 * Math.max(0, 1 - Math.abs(t - 6) / 1)
    return { t, angle: a }
  })
  it('完了の時刻の手前で角度が最小のコマを最下点にする', () => {
    const reps = deriveAppReps([90, 90], [3, 7], trace, 0)
    expect(reps.map(r => r.bottomT)).toEqual([2, 6])
    expect(reps[1].startT).toBe(3)
  })
  it('完了の時刻が足りない（flush）レップは記録の最後まで探す', () => {
    const reps = deriveAppReps([90, 90], [3], trace, 0)
    expect(reps.map(r => r.bottomT)).toEqual([2, 6])
  })
  it('記録が空ならレップを省く', () => {
    expect(deriveAppReps([90], [3], [], 0)).toEqual([])
  })
  it('近いコマ', () => {
    expect(nearestFrame(trace, 2.04)?.t).toBe(2)
    expect(nearestFrame(trace, 50)).toBeUndefined()
    expect(nearestFrame([], 1)).toBeUndefined()
  })
  it('3 点の角度（縦横比をそろえる）', () => {
    expect(angleFromPoints([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], 1)).toBeCloseTo(90)
    expect(angleFromPoints([{ x: 0, y: 0 }], 1)).toBeUndefined()
    // 幅÷高さ = 2：x が 2 倍になり、(1,0)-(0,0)-(1,1)→(2,0)-(0,0)-(2,1)
    expect(angleFromPoints([{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }], 2)).toBeCloseTo(Math.atan2(1, 2) * 180 / Math.PI)
  })
  it('角度を置ける種目：squat は股関節・膝・足首、lateral は置かない', () => {
    expect(angleJoints('squat')).toEqual(['hip', 'knee', 'ankle'])
    expect(angleJoints('curl')).toEqual(['shoulder', 'elbow', 'wrist'])
    expect(angleJoints('lateral')).toBeUndefined()
  })
})

describe('summarizeKeys', () => {
  it('種目ごとに累計。別の種目は混ぜない', () => {
    const t = summarizeKeys([
      rec(1),
      rec(2, { appReps: 4, trueReps: 3, reps: [{ appAngle: 100, trueAngle: 90, matched: true, appBottomT: 1, trueBottomT: 1 }] }),
      rec(3, { exerciseKey: 'curl' }),
    ], 'squat')
    expect(t.videos).toBe(2)
    expect(t.appReps).toBe(7)
    expect(t.trueReps).toBe(6)
    expect(t.exactVideos).toBe(1)
    expect(t.count.matched).toBe(2)
    expect(t.angle.n).toBe(2)
    expect(t.angle.meanDiff).toBeCloseTo(2.5)
  })
  it('0 件', () => {
    const t = summarizeKeys([], 'squat')
    expect(t.videos).toBe(0)
    expect(t.angle.n).toBe(0)
  })
})

describe('保存', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stubStore = (initial?: string, failSet = false) => {
    const m = new Map<string, string>()
    if (initial !== undefined) m.set(ANSWER_KEYS_STORAGE_KEY, initial)
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { if (failSet) throw new Error('quota'); m.set(k, v) },
    })
    return m
  }
  it('壊れた JSON・配列でない値は空', () => {
    stubStore('{not json')
    expect(loadAnswerKeys()).toEqual([])
    stubStore('{"a":1}')
    expect(loadAnswerKeys()).toEqual([])
  })
  it('壊れた要素だけ捨て、壊れた項目は落とす', () => {
    const out = normalizeAnswerKeys([
      rec(1),
      null,
      { id: 'x' },
      { ...rec(2), exerciseKey: 'unknown' },
      { ...rec(3), appReps: 'a' },
      { ...rec(4), view: 'weird', phiDeg: 'x', reps: [{ matched: true, appAngle: 'a', trueAngle: 80 }, { matched: 'yes' }, 5] },
    ])
    expect(out.map(r => r.id)).toEqual(['r1', 'r4'])
    expect(out[1].view).toBe('unknown')
    expect(out[1].phiDeg).toBeUndefined()
    expect(out[1].reps).toEqual([{ matched: true, trueAngle: 80 }])
  })
  it('新しいものを先頭に足し、200 件で打ち切る', () => {
    const m = stubStore(JSON.stringify(Array.from({ length: MAX_ANSWER_KEYS }, (_, i) => rec(i))))
    const next = addAnswerKey(rec(999))
    expect(next).toHaveLength(MAX_ANSWER_KEYS)
    expect(next?.[0].id).toBe('r999')
    expect(next?.[MAX_ANSWER_KEYS - 1].id).toBe(`r${MAX_ANSWER_KEYS - 2}`)
    expect(JSON.parse(m.get(ANSWER_KEYS_STORAGE_KEY) as string)).toHaveLength(MAX_ANSWER_KEYS)
  })
  it('保存できない環境では undefined（落ちない）', () => {
    stubStore(undefined, true)
    expect(addAnswerKey(rec(1))).toBeUndefined()
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    expect(loadAnswerKeys()).toEqual([])
    expect(addAnswerKey(rec(1))).toBeUndefined()
  })
})
