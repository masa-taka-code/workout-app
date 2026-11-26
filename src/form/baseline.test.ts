import { describe, expect, it } from 'vitest'
import { analyzeSet, generalFaultCodes } from './analysis'
import {
  BASELINE_INCOMPAT_NOTE, baselineAdvice, baselineCompat, buildBaseline, conditionsOf, marginOf, statOf, toEngineBaseline,
} from './baseline'
import type {
  BaselineStat, FormContext, FormExerciseKey, PersonalBaseline, RepMetrics, RepResult, StandingSnapshot,
} from './types'

function rep(index: number, o: Partial<RepResult> = {}, m: Partial<RepMetrics> = {}): RepResult {
  return {
    index, score: 90, romDeg: 100, eccentricSec: 2, concentricSec: 1, minAngle: 70, maxAngle: 170, issues: [],
    metrics: { confidence: 0.9, view: 'side', viewOk: 'ok', kneeFlexionBottom: 110, trunkLeanMax: 40, ...m }, ...o,
  }
}

const stat = (med: number, mad = 0): BaselineStat => ({ med, mad })

function baseline(key: FormExerciseKey, stats: PersonalBaseline['stats'], o: Partial<PersonalBaseline> = {}): PersonalBaseline {
  return {
    version: 2, key, savedAt: '2026-11-01', weight: 60, repCount: 4, stats,
    conditions: { source: 'live', view: 'side', phiDeg: 5, side: 'left', segLen: 0.4 }, belowGeneral: [], ...o,
  }
}

const ctxOf = (key: FormExerciseKey, personal?: PersonalBaseline, o: Partial<FormContext> = {}): FormContext =>
  ({ key, exerciseId: 'e', weight: 60, history: [], personal, ...o })

/** 3 レップ（同じ値）を分析して、崩れの code を返す */
const faultsOf = (key: FormExerciseKey, reps: RepResult[], personal?: PersonalBaseline, o: Partial<FormContext> = {}) =>
  analyzeSet(reps, ctxOf(key, personal, o)).faults.map(f => f.code)

describe('statOf：中央値と 1.4826×MAD', () => {
  it('値が 3 つ以上なら中央値と MAD、3 つ未満は mad=0', () => {
    expect(statOf([100, 110, 120, 110, 130])).toEqual({ med: 110, mad: 10 * 1.4826 })
    expect(statOf([100, 110])).toEqual({ med: 105, mad: 0 })
    expect(statOf([])).toBeUndefined()
  })
})

describe('buildBaseline：使うレップと中央値', () => {
  const opts = { weight: 60, date: '2026-11-26' }

  it('条件の良いレップが 3 つ未満なら too-few', () => {
    expect(buildBaseline('squat', [rep(1), rep(2)], opts)).toEqual({ error: 'too-few' })
    expect(buildBaseline('squat', [], opts)).toEqual({ error: 'too-few' })
    expect('baseline' in buildBaseline('squat', [rep(1), rep(2), rep(3)], opts)).toBe(true)
  })

  it('信頼度 0.8 未満・向きが ok でない・placementOk=false・metrics なしのレップは使わない', () => {
    const reps = [
      rep(1), rep(2), // 条件の良いレップは 2 つだけ
      rep(3, {}, { confidence: 0.79 }),
      rep(4, {}, { viewOk: 'caution' }),
      rep(5, {}, { placementOk: false }), // 採点から外したレップ
      { ...rep(6), metrics: undefined },
    ]
    expect(buildBaseline('squat', reps, opts)).toEqual({ error: 'too-few' })
    // 0.8 ちょうど・placementOk=true・未判定（undefined）は使える
    const ok = [rep(1, {}, { confidence: 0.8 }), rep(2, {}, { placementOk: true }), rep(3)]
    const r = buildBaseline('squat', ok, opts)
    expect('baseline' in r && r.baseline.repCount).toBe(3)
    expect(buildBaseline('squat', [...reps.slice(2), ok[0], ok[1]], opts)).toEqual({ error: 'too-few' })
  })

  it('placementOk=false のレップは、値が極端でも基準に入らない', () => {
    const reps = [rep(1), rep(2), rep(3), rep(4, {}, { placementOk: false, kneeFlexionBottom: 30 })]
    const r = buildBaseline('squat', reps, opts)
    if (!('baseline' in r)) throw new Error('too-few')
    expect(r.baseline.repCount).toBe(3)
    expect(r.baseline.stats.kneeFlexionBottom).toEqual({ med: 110, mad: 0 })
  })

  it('先頭から最大 5 レップ。指標ごとに値が 3 つ以上あるものだけ中央値と MAD を持つ', () => {
    const knees = [100, 110, 120, 110, 130, 10, 10]
    const reps = knees.map((k, i) => rep(i + 1, { romDeg: 90 + i }, { kneeFlexionBottom: k }))
    const r = buildBaseline('squat', reps, opts)
    if (!('baseline' in r)) throw new Error('too-few')
    const b = r.baseline
    expect(b.version).toBe(2)
    expect(b.repCount).toBe(5)
    expect(b.savedAt).toBe('2026-11-26')
    expect(b.weight).toBe(60)
    expect(b.stats.kneeFlexionBottom).toEqual({ med: 110, mad: 10 * 1.4826 })
    expect(b.stats.romDeg).toEqual({ med: 92, mad: 1.4826 })
    expect(b.stats.minAngle).toEqual({ med: 70, mad: 0 })
    // 値のある指標だけ（hipFlexionBottom などは無い）
    expect(b.stats.hipFlexionBottom).toBeUndefined()
    expect(b.stats.heelLift).toBeUndefined()
    // 3 つに満たない指標は入れない
    const some = [rep(1, {}, { heelLift: 0.02 }), rep(2, {}, { heelLift: 0.04 }), rep(3)]
    const s = buildBaseline('squat', some, opts)
    expect('baseline' in s && s.baseline.stats.heelLift).toBeUndefined()
  })

  it('belowGeneral：基準に使ったレップの半数以上で、一般のしきい値の崩れが出た code', () => {
    const shallow = (i: number) => rep(i, {}, { kneeFlexionBottom: 70 }) // 一般の 78° を下回る
    const good = (i: number) => rep(i, {}, { kneeFlexionBottom: 110 })
    const half = buildBaseline('squat', [shallow(1), shallow(2), good(3), good(4)], opts)
    expect('baseline' in half && half.baseline.belowGeneral).toEqual(['shallow'])
    const less = buildBaseline('squat', [shallow(1), good(2), good(3), good(4)], opts)
    expect('baseline' in less && less.baseline.belowGeneral).toEqual([])
    const lean = buildBaseline('squat', [1, 2, 3].map(i => rep(i, {}, { trunkLeanMax: 80 })), opts)
    expect('baseline' in lean && lean.baseline.belowGeneral).toEqual(['forward-lean'])
  })

  it('撮影条件：立位（standing）があればそこから、無ければレップの向きの最頻値と φ の中央値', () => {
    const standing: StandingSnapshot = { segA: 0.2, segB: 0.21, phiDeg: 7, tiltDeg: 2, side: 'right' }
    const live = buildBaseline('squat', [rep(1), rep(2), rep(3)], { ...opts, standing })
    expect('baseline' in live && live.baseline.conditions).toEqual({
      source: 'live', view: 'side', phiDeg: 7, tiltDeg: 2, side: 'right', segLen: 0.2 + 0.21,
    })
    const reps = [rep(1, {}, { phiDeg: 5 }), rep(2, {}, { phiDeg: 9 }), rep(3, {}, { phiDeg: 7 }), rep(4, {}, { phiDeg: 40, view: 'oblique', viewOk: 'caution' })]
    const file = buildBaseline('squat', reps, opts)
    // oblique のレップは向きが ok でないので使わない（view の ok は side/front）
    expect('baseline' in file && file.baseline.conditions).toEqual({ source: 'file', view: 'side', phiDeg: 7 })
    expect(conditionsOf([rep(1, {}, { view: 'front' }), rep(2, {}, { view: 'front' }), rep(3)]).view).toBe('front')
  })
})

describe('baselineCompat：撮影条件が合うか', () => {
  const b = baseline('squat', { kneeFlexionBottom: stat(110) })
  const now = { source: 'live' as const, view: 'side' as const, phiDeg: 5, side: 'left' as const, segLen: 0.4 }

  it('同じ条件なら ok。傾きの差は見ない', () => {
    expect(baselineCompat(b, now)).toEqual({ ok: true })
    expect(baselineCompat(b, { ...now, tiltDeg: 9 })).toEqual({ ok: true })
  })
  it('向き・φ の差が 15° 超・側・体節長の比が 0.7〜1.3 の外なら ok:false（理由つき）', () => {
    expect(baselineCompat(b, { ...now, view: 'front' }).ok).toBe(false)
    expect(baselineCompat(b, { ...now, phiDeg: 20 })).toEqual({ ok: true }) // 差 15° ちょうどは ok
    const phi = baselineCompat(b, { ...now, phiDeg: 25 }) // 差 20°
    expect(phi.ok).toBe(false)
    expect(phi.reason).toBeTruthy()
    expect(baselineCompat(b, { ...now, phiDeg: -12 }).ok).toBe(false)
    expect(baselineCompat(b, { ...now, side: 'right' }).ok).toBe(false)
    expect(baselineCompat(b, { ...now, segLen: 0.4 * 0.71 }).ok).toBe(true)
    expect(baselineCompat(b, { ...now, segLen: 0.4 * 0.69 }).ok).toBe(false)
    expect(baselineCompat(b, { ...now, segLen: 0.4 * 1.29 }).ok).toBe(true)
    expect(baselineCompat(b, { ...now, segLen: 0.4 * 1.31 }).ok).toBe(false)
  })
  it('どちらかの値が不明な項目は判定に使わない', () => {
    expect(baselineCompat(b, { source: 'file', view: 'unknown' })).toEqual({ ok: true })
    expect(baselineCompat({ ...b, conditions: { source: 'live', view: 'unknown' } }, { ...now, phiDeg: 80, side: 'right' })).toEqual({ ok: true })
    expect(baselineCompat(b, { source: 'file', view: 'side' })).toEqual({ ok: true })
  })
  it('旧形式（legacy）は撮影条件が分からないので ok', () => {
    const legacy = baseline('squat', { kneeFlexionBottom: stat(110) }, { legacy: true, conditions: { source: 'live', view: 'side', phiDeg: 0 } })
    expect(baselineCompat(legacy, { ...now, view: 'front', phiDeg: 80 })).toEqual({ ok: true })
  })
})

describe('余白・更新のすすめ・RepTracker への基準', () => {
  it('余白 = max(最低の余裕, 2×MAD)。最低は角度 8°、かかとの浮き 0.02', () => {
    expect(marginOf('kneeFlexionBottom', stat(110, 2))).toBe(8)
    expect(marginOf('kneeFlexionBottom', stat(110, 5))).toBe(10)
    expect(marginOf('heelLift', stat(0.03, 0.005))).toBe(0.02)
    expect(marginOf('heelLift', stat(0.03, 0.02))).toBeCloseTo(0.04, 10)
  })

  it('更新のすすめ：保存から 56 日以上／重量が 2 割以上違う／旧形式', () => {
    const b = baseline('squat', {}, { savedAt: '2026-10-01', weight: 60 })
    expect(baselineAdvice(b, '2026-11-25', 60)).toBeUndefined() // 55 日
    expect(baselineAdvice(b, '2026-11-26', 60)).toContain('56 日')
    const fresh = baseline('squat', {}, { savedAt: '2026-11-20', weight: 60 })
    expect(baselineAdvice(fresh, '2026-11-26', 60)).toBeUndefined()
    expect(baselineAdvice(fresh, '2026-11-26', 70)).toBeUndefined() // +16.7%
    expect(baselineAdvice(fresh, '2026-11-26', 72)).toContain('重量') // +20% ちょうど
    expect(baselineAdvice(fresh, '2026-11-26', 48)).toContain('重量') // −20%
    // どちらかの重量が 0（不明）なら重量では判定しない
    expect(baselineAdvice(fresh, '2026-11-26', 0)).toBeUndefined()
    expect(baselineAdvice({ ...fresh, weight: 0 }, '2026-11-26', 100)).toBeUndefined()
    expect(baselineAdvice({ ...fresh, legacy: true }, '2026-11-26', 60)).toContain('古い形式')
  })

  it('toEngineBaseline：可動域・最小・最大・体幹の前傾の中央値。足りなければ undefined', () => {
    const b = baseline('squat', { romDeg: stat(100), minAngle: stat(70), maxAngle: stat(170), trunkLeanMax: stat(40, 3) })
    expect(toEngineBaseline(b)).toEqual({ romDeg: 100, minAngle: 70, maxAngle: 170, trunkLeanMax: 40 })
    expect(toEngineBaseline(baseline('squat', { romDeg: stat(100), minAngle: stat(70) }))).toBeUndefined()
    expect(toEngineBaseline(undefined)).toBeUndefined()
  })
})

describe('自分の基準を使った崩れの判定', () => {
  const three = (m: Partial<RepMetrics>, o: Partial<RepResult> = {}) => [1, 2, 3].map(i => rep(i, o, m))
  const stats = (extra: PersonalBaseline['stats']) => ({ romDeg: stat(100), minAngle: stat(70), maxAngle: stat(170), ...extra })

  it('squat の浅さ：基準の中央値 − 余裕（8°）を下回ったとき。余裕以内なら出ない', () => {
    const b = baseline('squat', stats({ kneeFlexionBottom: stat(120) }))
    expect(faultsOf('squat', three({ kneeFlexionBottom: 113 }), b)).not.toContain('shallow') // 112 以上
    expect(faultsOf('squat', three({ kneeFlexionBottom: 111 }), b)).toContain('shallow')
    // ばらつきが大きい基準は余裕が広がる（2×MAD = 20°）
    const wide = baseline('squat', stats({ kneeFlexionBottom: stat(120, 10) }))
    expect(faultsOf('squat', three({ kneeFlexionBottom: 105 }), wide)).not.toContain('shallow')
    expect(faultsOf('squat', three({ kneeFlexionBottom: 99 }), wide)).toContain('shallow')
  })

  it('belowGeneral に shallow がある基準でも、浅さのしきい値は一般の 78° を下回らない（確信度は low まで）', () => {
    const lowBase = baseline('squat', stats({ kneeFlexionBottom: stat(70) }), { belowGeneral: ['shallow'] })
    // 70 − 8 = 62 だが、78° を下回らない：75° は浅い、80° は浅くない
    expect(faultsOf('squat', three({ kneeFlexionBottom: 75 }), lowBase)).toContain('shallow')
    expect(faultsOf('squat', three({ kneeFlexionBottom: 80 }), lowBase)).not.toContain('shallow')
    // belowGeneral が無ければ、基準どおり（62°）まで許す
    const free = baseline('squat', stats({ kneeFlexionBottom: stat(70) }))
    expect(faultsOf('squat', three({ kneeFlexionBottom: 75 }), free)).not.toContain('shallow')
    const faults = analyzeSet(three({ kneeFlexionBottom: 75 }), ctxOf('squat', lowBase)).faults
    const shallow = faults.find(f => f.code === 'shallow')!
    expect(shallow.causes.every(c => c.confidence === 'low')).toBe(true)
  })

  it('基準を使った浅さの確信度は mid まで（旧形式の基準なら high になる手がかりでも high にならない）', () => {
    const b = baseline('squat', stats({ kneeFlexionBottom: stat(120) }))
    // 軽い重量の日にも毎回出ていて、1〜2レップ目から出ている（通常は mobility・structure が high になる手がかり）
    const history = [1, 2, 3].map(i => ({
      date: `2026-11-0${i}`, exerciseId: 'e', key: 'squat' as const, weight: 30, reps: 5, avgScore: 80,
      faultCounts: { shallow: 3 }, confidence: 0.9,
    }))
    const reps = Array.from({ length: 6 }, (_, i) => rep(i + 1, {}, { kneeFlexionBottom: 90 }))
    const withBase = analyzeSet(reps, ctxOf('squat', b, { history })).faults.find(f => f.code === 'shallow')!
    expect(withBase.causes.length).toBeGreaterThan(0)
    expect(withBase.causes.some(c => c.confidence === 'high')).toBe(false)
    expect(withBase.causes.some(c => c.confidence === 'mid')).toBe(true)
    // 比較：旧形式の基準（ctx.baseline）では同じ手がかりで high になる
    const old = analyzeSet(reps.map(r => ({ ...r, romDeg: 60 })), {
      ...ctxOf('squat', undefined, { history }), baseline: { romDeg: 100, minAngle: 70, maxAngle: 170 },
    }).faults.find(f => f.code === 'shallow')!
    expect(old.causes.some(c => c.confidence === 'high')).toBe(true)
  })

  it('bench の浅さ：最下点の肘の角度が基準の中央値 + 余裕を超えたとき', () => {
    const b = baseline('bench', stats({}))
    expect(faultsOf('bench', three({}, { minAngle: 77 }), b)).not.toContain('shallow') // 70 + 8 = 78 以内
    expect(faultsOf('bench', three({}, { minAngle: 79 }), b)).toContain('shallow')
  })

  it('rdl の shallow-hinge：股関節屈曲が基準 − 余裕を下回ったとき。基準が無ければ出さない', () => {
    const b = baseline('rdl', stats({ hipFlexionBottom: stat(80) }))
    expect(faultsOf('rdl', three({ hipFlexionBottom: 73 }), b)).not.toContain('shallow-hinge')
    expect(faultsOf('rdl', three({ hipFlexionBottom: 71 }), b)).toContain('shallow-hinge')
    expect(faultsOf('rdl', three({ hipFlexionBottom: 20 }))).not.toContain('shallow-hinge')
  })

  it('ohp / ohext：肘の屈曲が基準 − 余裕を下回ったとき。belowGeneral なら一般の 70° / 90° を下回らない', () => {
    const ohp = baseline('ohp', stats({ elbowFlexionBottom: stat(100) }))
    expect(faultsOf('ohp', three({ elbowFlexionBottom: 93 }), ohp)).not.toContain('shallow')
    expect(faultsOf('ohp', three({ elbowFlexionBottom: 91 }), ohp)).toContain('shallow')
    const ohpLow = baseline('ohp', stats({ elbowFlexionBottom: stat(60) }), { belowGeneral: ['shallow'] })
    expect(faultsOf('ohp', three({ elbowFlexionBottom: 65 }), ohpLow)).toContain('shallow') // 52 でなく 70 が下限
    expect(faultsOf('ohp', three({ elbowFlexionBottom: 72 }), ohpLow)).not.toContain('shallow')
    const ext = baseline('ohext', stats({ elbowFlexionBottom: stat(80) }), { belowGeneral: ['shallow'] })
    expect(faultsOf('ohext', three({ elbowFlexionBottom: 85 }), ext)).toContain('shallow') // 下限は 90°
    expect(faultsOf('ohext', three({ elbowFlexionBottom: 92 }), ext)).not.toContain('shallow')
  })

  it('curl の partial-bottom：最大角度が基準 − 余裕を下回ったとき', () => {
    const b = baseline('curl', stats({}))
    expect(faultsOf('curl', three({}, { maxAngle: 163 }), b)).not.toContain('partial-bottom') // 170 − 8 = 162
    expect(faultsOf('curl', three({}, { maxAngle: 161 }), b)).toContain('partial-bottom')
  })

  it('pulldown の partial-top：上で伸ばした肘が基準 − max(15°, 2×MAD) を下回ったとき', () => {
    const b = baseline('pulldown', stats({ elbowExtensionTop: stat(165) }))
    expect(faultsOf('pulldown', three({ elbowExtensionTop: 151 }), b)).not.toContain('partial-top')
    expect(faultsOf('pulldown', three({ elbowExtensionTop: 149 }), b)).toContain('partial-top')
    const wide = baseline('pulldown', stats({ elbowExtensionTop: stat(165, 10) }))
    expect(faultsOf('pulldown', three({ elbowExtensionTop: 146 }), wide)).not.toContain('partial-top') // 165 − 20 = 145
    expect(faultsOf('pulldown', three({ elbowExtensionTop: 144 }), wide)).toContain('partial-top')
  })

  it('belowGeneral の基準でも、bench・curl・pulldown の浅さは一般のしきい値（100° / 150° / 150°）より甘くならない', () => {
    // bench：基準 120° なら 128° まで許すが、一般の 100° が上限（大きいほど浅い）
    const bench = baseline('bench', stats({ minAngle: stat(120) }), { belowGeneral: ['shallow'] })
    expect(faultsOf('bench', three({}, { minAngle: 105 }), bench)).toContain('shallow')
    expect(faultsOf('bench', three({}, { minAngle: 98 }), bench)).not.toContain('shallow')
    expect(faultsOf('bench', three({}, { minAngle: 105 }), baseline('bench', stats({ minAngle: stat(120) })))).not.toContain('shallow')
    // curl：基準 130° なら 122° まで許すが、一般の 150° を下回れば不足（小さいほど不足）
    const curl = baseline('curl', stats({ maxAngle: stat(130) }), { belowGeneral: ['partial-bottom'] })
    expect(faultsOf('curl', three({}, { maxAngle: 145 }), curl)).toContain('partial-bottom')
    expect(faultsOf('curl', three({}, { maxAngle: 152 }), curl)).not.toContain('partial-bottom')
    expect(faultsOf('curl', three({}, { maxAngle: 145 }), baseline('curl', stats({ maxAngle: stat(130) })))).not.toContain('partial-bottom')
    // pulldown：基準 140° なら 125° まで許すが、一般の 150° 未満は不足
    const pd = baseline('pulldown', stats({ elbowExtensionTop: stat(140) }), { belowGeneral: ['partial-top'] })
    expect(faultsOf('pulldown', three({ elbowExtensionTop: 145 }), pd)).toContain('partial-top')
    expect(faultsOf('pulldown', three({ elbowExtensionTop: 152 }), pd)).not.toContain('partial-top')
    expect(faultsOf('pulldown', three({ elbowExtensionTop: 145 }), baseline('pulldown', stats({ elbowExtensionTop: stat(140) })))).not.toContain('partial-top')
  })

  it('rdl の shallow-hinge には一般のしきい値が無く（一般の判定では出ない）、belowGeneral にも入らないので、基準どおりに判定する', () => {
    expect(generalFaultCodes(rep(1, {}, { hipFlexionBottom: 5 }), 'rdl')).not.toContain('shallow-hinge')
    const b = baseline('rdl', stats({ hipFlexionBottom: stat(80) }), { belowGeneral: ['shallow-hinge'] })
    expect(faultsOf('rdl', three({ hipFlexionBottom: 71 }), b)).toContain('shallow-hinge')
    expect(faultsOf('rdl', three({ hipFlexionBottom: 73 }), b)).not.toContain('shallow-hinge')
  })

  it('forward-lean の上限：基準があれば min(基準 + 15°, 80°)、無ければ 72°', () => {
    const lean = (deg: number, b?: PersonalBaseline) => faultsOf('squat', three({ trunkLeanMax: deg }), b).includes('forward-lean')
    // 基準なし
    expect(lean(72)).toBe(false)
    expect(lean(73)).toBe(true)
    // 基準 40° → 55°
    const low = baseline('squat', stats({ trunkLeanMax: stat(40) }))
    expect(lean(55, low)).toBe(false)
    expect(lean(56, low)).toBe(true)
    // 基準が大きくても 80° を超えて許さない（75 + 15 = 90 でなく 80）
    const high = baseline('squat', stats({ trunkLeanMax: stat(75) }))
    expect(lean(80, high)).toBe(false)
    expect(lean(81, high)).toBe(true)
  })

  it('安全に関わる崩れ（hip-rise・knee-valgus・lean-back）とかかとの浮きは、基準に関係なく一般のしきい値で出る', () => {
    // 基準にそれらの指標が入っていても、緩めない
    const sq = baseline('squat', stats({ heelLift: stat(0.2, 0.1), kneeFlexionBottom: stat(110) }))
    const front = { view: 'front' as const, kneeValgusDeg: 15, heelLift: 0.05 }
    const sqFaults = faultsOf('squat', three(front), sq)
    expect(sqFaults).toContain('knee-valgus')
    expect(sqFaults).toContain('heel-lift')
    expect(faultsOf('squat', three(front))).toEqual(expect.arrayContaining(['knee-valgus', 'heel-lift']))
    // 基準がなくても、ある（一般の 0.03 以下）ときは出ない
    expect(faultsOf('squat', three({ heelLift: 0.03 }), sq)).not.toContain('heel-lift')
    expect(faultsOf('bench', three({ hipRise: 0.08 }), baseline('bench', stats({})))).toContain('hip-rise')
    expect(faultsOf('ohp', three({ trunkLeanBack: 30, trunkLeanBackBaseline: 5 }), baseline('ohp', stats({})))).toContain('lean-back')
  })

  it('撮影条件が違う（φ の差 20°）と、基準を使わず一般の判定に戻り、注記が付く', () => {
    const b = baseline('squat', stats({ kneeFlexionBottom: stat(120) })) // φ 5°
    const reps = (phi: number) => three({ kneeFlexionBottom: 100, phiDeg: phi })
    // 基準どおりなら 100 < 112 で浅い。φ の差が 5° なら基準を使う
    const same = analyzeSet(reps(10), ctxOf('squat', b))
    expect(same.faults.map(f => f.code)).toContain('shallow')
    expect(same.baselineNote).toBeUndefined()
    // φ の差が 20°：一般のしきい値（78°）では浅くない
    const diff = analyzeSet(reps(25), ctxOf('squat', b))
    expect(diff.faults.map(f => f.code)).not.toContain('shallow')
    expect(diff.baselineNote).toBe(BASELINE_INCOMPAT_NOTE)
    expect(BASELINE_INCOMPAT_NOTE).toBe('基準と撮影条件が違うため一般の目安で判定しました')
  })

  it('旧形式（legacy）の基準は撮影条件にかかわらず使う。基準が無いときは注記も出ない', () => {
    const legacy = baseline('squat', stats({ kneeFlexionBottom: stat(120) }), { legacy: true, conditions: { source: 'live', view: 'unknown' } })
    const r = analyzeSet(three({ kneeFlexionBottom: 100, phiDeg: 60 }), ctxOf('squat', legacy))
    expect(r.faults.map(f => f.code)).toContain('shallow')
    expect(r.baselineNote).toBeUndefined()
    expect(analyzeSet(three({ kneeFlexionBottom: 100 }), ctxOf('squat')).baselineNote).toBeUndefined()
  })

  it('立位（standing）の体節長が基準と 0.7〜1.3 倍の外なら、基準を使わない', () => {
    const b = baseline('squat', stats({ kneeFlexionBottom: stat(120) }))
    const standing = (len: number): StandingSnapshot => ({ segA: len / 2, segB: len / 2, side: 'left', phiDeg: 5 })
    const reps = three({ kneeFlexionBottom: 100 })
    expect(analyzeSet(reps, ctxOf('squat', b, { standing: standing(0.4) })).faults.map(f => f.code)).toContain('shallow')
    const far = analyzeSet(reps, ctxOf('squat', b, { standing: standing(0.25) }))
    expect(far.faults.map(f => f.code)).not.toContain('shallow')
    expect(far.baselineNote).toBe(BASELINE_INCOMPAT_NOTE)
  })

  it('generalFaultCodes は、基準を使わず一般のしきい値だけで見る（テンポの崩れは含めない）', () => {
    expect(generalFaultCodes(rep(1, {}, { kneeFlexionBottom: 70 }), 'squat')).toContain('shallow')
    expect(generalFaultCodes(rep(1, { issues: [{ code: 'fast-down', message: '', fix: '', penalty: 10 }] }), 'squat')).toEqual([])
    expect(generalFaultCodes(rep(1, {}, { kneeFlexionBottom: 110, trunkLeanMax: 75 }), 'squat')).toEqual(['forward-lean'])
  })

  it('personal があるとき、ストレッチの到達度は基準の可動域の中央値で出す（互換が ok でなければ一般の基準）', () => {
    const b = baseline('squat', stats({ kneeFlexionBottom: stat(120) }))
    const ok = analyzeSet(three({ kneeFlexionBottom: 120 }, { romDeg: 100 }), ctxOf('squat', b))
    expect(ok.stretch?.reference).toBe('あなたの基準動画')
    const ng = analyzeSet(three({ kneeFlexionBottom: 120, phiDeg: 40 }, { romDeg: 100 }), ctxOf('squat', b))
    expect(ng.stretch?.reference).toBe('論文の基準（膝屈曲 90〜140°）')
  })
})
