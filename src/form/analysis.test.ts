import { describe, expect, it } from 'vitest'
import { analyzeSet, emphasisTargets, shouldCueLive, toSessionSummary } from './analysis'
import type { FormContext, FormExerciseKey, FormSessionSummary, Issue, RepMetrics, RepResult } from './types'

/** テスト用：RepResult を直接組み立てる（metrics は渡したときだけ付く） */
function rep(index: number, o: Partial<RepResult> = {}, m?: Partial<RepMetrics>): RepResult {
  const r: RepResult = {
    index, score: 80, romDeg: 100, eccentricSec: 2, concentricSec: 1, minAngle: 80, maxAngle: 170, issues: [], ...o,
  }
  if (m) r.metrics = { confidence: 0.9, view: 'side', viewOk: 'ok', ...m }
  return r
}

function issue(code: string): Issue {
  return { code, message: code, fix: '', penalty: 10 }
}

function ctx(key: FormExerciseKey, o: Partial<FormContext> = {}): FormContext {
  return { key, exerciseId: 'ex1', weight: 60, history: [], ...o }
}

function summary(o: Partial<FormSessionSummary> = {}): FormSessionSummary {
  return {
    date: '2026-11-01', exerciseId: 'ex1', key: 'squat', weight: 60, reps: 5, avgScore: 80, faultCounts: {}, confidence: 0.9, ...o,
  }
}

const squatReps = (flex: number[], m: Partial<RepMetrics> = {}) =>
  flex.map((f, i) => rep(i + 1, {}, { kneeFlexionBottom: f, ...m }))

describe('emphasisTargets', () => {
  it('種目ごとに2つの狙いを返す', () => {
    expect(emphasisTargets('squat').map(t => t.id)).toEqual(['quads', 'hips'])
    expect(emphasisTargets('bench').map(t => t.id)).toEqual(['chest', 'triceps'])
    expect(emphasisTargets('curl').map(t => t.id)).toEqual(['long', 'distal'])
  })
})

describe('ストレッチ：squat（膝屈曲 90〜140°）', () => {
  // 滞在率が無いので、D と C だけで (0.5D + 0.3C) / 0.8 に再配分される
  it('膝屈曲 90° は 0 点、115° は D=0.5 で 31 点、140° は 100 点', () => {
    expect(analyzeSet(squatReps([90]), ctx('squat')).stretch?.score).toBe(0)
    const mid = analyzeSet(squatReps([115]), ctx('squat')).stretch!
    expect(mid.reach).toBeCloseTo(0.5)
    expect(mid.consistency).toBe(0)
    expect(mid.score).toBe(31) // 100 × 0.25 / 0.8 = 31.25
    expect(analyzeSet(squatReps([140]), ctx('squat')).stretch?.score).toBe(100)
  })

  it('滞在率があれば 0.5D + 0.3C + 0.2T', () => {
    const s = analyzeSet(squatReps([115], { timeInStretch: 0.5 }), ctx('squat')).stretch!
    expect(s.timeInStretch).toBeCloseTo(0.5)
    expect(s.score).toBe(35) // 0.25 + 0 + 0.1
  })

  it('滞在率が一部のレップにしか無いときは、あるものだけで平均する', () => {
    const reps = [rep(1, {}, { kneeFlexionBottom: 140, timeInStretch: 0.4 }), rep(2, {}, { kneeFlexionBottom: 90 })]
    const s = analyzeSet(reps, ctx('squat')).stretch!
    expect(s.timeInStretch).toBeCloseTo(0.4)
    expect(s.score).toBe(48) // D 平均 0.5、C 0.5、T 0.4 → 0.25 + 0.15 + 0.08
  })

  it('一貫性は D ≥ 0.9 のレップの割合', () => {
    const s = analyzeSet(squatReps([140, 90]), ctx('squat')).stretch!
    expect(s.consistency).toBeCloseTo(0.5)
    expect(s.reach).toBeCloseTo(0.5)
    expect(s.score).toBe(50) // (0.25 + 0.15) / 0.8
    expect(s.reference).toBe('論文の基準（膝屈曲 90〜140°）')
  })

  it('信頼度 0.6 未満のレップは含めない', () => {
    const reps = [rep(1, {}, { kneeFlexionBottom: 140 }), rep(2, {}, { kneeFlexionBottom: 90, confidence: 0.5 })]
    const s = analyzeSet(reps, ctx('squat')).stretch!
    expect(s.reach).toBeCloseTo(1)
    expect(s.score).toBe(100)
  })

  it('膝屈曲が無いレップだけなら stretch は undefined', () => {
    expect(analyzeSet([rep(1, {}, {})], ctx('squat')).stretch).toBeUndefined()
  })

  it('基準動画があれば romDeg / baseline.romDeg を優先する', () => {
    const baseline = { romDeg: 100, minAngle: 70, maxAngle: 170 }
    const r = analyzeSet([rep(1, { romDeg: 100 }, { kneeFlexionBottom: 90 })], ctx('squat', { baseline }))
    expect(r.stretch?.reach).toBeCloseTo(1) // 論文の基準なら 0 になるが、基準動画を優先
    expect(r.stretch?.reference).toBe('あなたの基準動画')
    const half = analyzeSet([rep(1, { romDeg: 50 }, { kneeFlexionBottom: 140 })], ctx('squat', { baseline }))
    expect(half.stretch?.reach).toBeCloseTo(0.5)
  })
})

describe('ストレッチ：curl（肘の内角 112〜170°）', () => {
  const curl = (max: number) => [rep(1, { maxAngle: max }, {})]
  it('112° は 0、141° は D=0.5、170° は 100 点', () => {
    expect(analyzeSet(curl(112), ctx('curl')).stretch?.score).toBe(0)
    const mid = analyzeSet(curl(141), ctx('curl')).stretch!
    expect(mid.reach).toBeCloseTo(0.5)
    expect(mid.score).toBe(31)
    expect(analyzeSet(curl(170), ctx('curl')).stretch?.score).toBe(100)
    expect(mid.reference).toBe('論文の基準（肘の伸張域 112〜170°）')
  })
  it('範囲の外は 0〜1 に収める', () => {
    expect(analyzeSet(curl(100), ctx('curl')).stretch?.reach).toBe(0)
    expect(analyzeSet(curl(179), ctx('curl')).stretch?.reach).toBe(1)
  })
})

describe('ストレッチ：bench', () => {
  const baseline = { romDeg: 80, minAngle: 90, maxAngle: 170 }
  it('基準が無ければ undefined', () => {
    expect(analyzeSet([rep(1, {}, {})], ctx('bench')).stretch).toBeUndefined()
  })
  it('基準があれば (maxAngle − minAngle) / baseline.romDeg', () => {
    const full = analyzeSet([rep(1, { minAngle: 90, maxAngle: 170 }, {})], ctx('bench', { baseline })).stretch!
    expect(full.reach).toBeCloseTo(1)
    expect(full.score).toBe(100)
    const half = analyzeSet([rep(1, { minAngle: 130, maxAngle: 170 }, {})], ctx('bench', { baseline })).stretch!
    expect(half.reach).toBeCloseTo(0.5)
  })
})

describe('効いている部位', () => {
  it('squat：hipMomentShare の平均から distribution を作る', () => {
    const reps = [rep(1, {}, { hipMomentShare: 0.6 }), rep(2, {}, { hipMomentShare: 0.8 })]
    const [hip, quad] = analyzeSet(reps, ctx('squat')).emphasis.distribution
    expect(hip.muscles).toEqual(['臀筋'])
    expect(hip.share).toBeCloseTo(0.7)
    expect(quad.muscles).toEqual(['大腿四頭筋'])
    expect(quad.share).toBeCloseTo(0.3)
  })

  it('squat：すね前傾 − 体幹前傾 ≥ 8° で「膝寄りの負荷」の注記', () => {
    const on = analyzeSet(squatReps([120], { shinLeanBottom: 40, trunkLeanMax: 32, hipMomentShare: 0.5 }), ctx('squat'))
    expect(on.emphasis.note).toContain('膝寄りの負荷')
    const off = analyzeSet(squatReps([120], { shinLeanBottom: 40, trunkLeanMax: 33, hipMomentShare: 0.5 }), ctx('squat'))
    expect(off.emphasis.note).not.toContain('膝寄りの負荷')
  })

  it('squat：hipMomentShare が無ければ share は undefined', () => {
    const r = analyzeSet(squatReps([120]), ctx('squat'))
    expect(r.emphasis.distribution.every(d => d.share === undefined)).toBe(true)
  })

  it('狙い未選択なら target は undefined', () => {
    expect(analyzeSet(squatReps([120]), ctx('squat')).emphasis.target).toBeUndefined()
  })

  describe('狙いの部位の score = 100 × S × (0.6P + 0.4L)', () => {
    // flex 140 → L = 1。hipMomentShare 0.7、速度低下 20% → P = 0.5
    const reps = (loss?: number) => squatReps([140], { hipMomentShare: 0.7, velocityLossPct: loss })
    it('P と L の両方あり', () => {
      const hips = analyzeSet(reps(20), ctx('squat', { targetId: 'hips' })).emphasis.target!
      expect(hips.share).toBeCloseTo(0.7)
      expect(hips.score).toBe(49) // 100 × 0.7 × (0.3 + 0.4)
      expect(hips.tips.length).toBeGreaterThan(0)
      const quads = analyzeSet(reps(20), ctx('squat', { targetId: 'quads' })).emphasis.target!
      expect(quads.share).toBeCloseTo(0.3)
      expect(quads.score).toBe(21) // 100 × 0.3 × 0.7
    })
    it('P が無ければ L だけ', () => {
      expect(analyzeSet(reps(undefined), ctx('squat', { targetId: 'hips' })).emphasis.target?.score).toBe(70)
    })
    it('L が無ければ P だけ（bench は S = 1）', () => {
      const r = analyzeSet([rep(1, {}, { velocityLossPct: 20 })], ctx('bench', { targetId: 'chest' }))
      expect(r.emphasis.target?.share).toBeUndefined()
      expect(r.emphasis.target?.score).toBe(50)
    })
    it('P も L も無ければ score は undefined', () => {
      const r = analyzeSet([rep(1, {}, {})], ctx('bench', { targetId: 'triceps' }))
      expect(r.emphasis.target?.score).toBeUndefined()
      expect(r.emphasis.target?.tips.length).toBeGreaterThan(0)
    })
  })

  it('effort：速度低下の最大から proximity を出す（40% で 1）', () => {
    const reps = [0, 10, 60].map((l, i) => rep(i + 1, {}, { velocityLossPct: l }))
    const r = analyzeSet(reps, ctx('squat'))
    expect(r.effort.velocityLossPct).toBe(60)
    expect(r.effort.proximity).toBe(1)
    expect(r.effort.source).toBe('velocity')
    const half = analyzeSet([rep(1, {}, { velocityLossPct: 20 })], ctx('squat'))
    expect(half.effort.proximity).toBeCloseTo(0.5)
    expect(analyzeSet(squatReps([120]), ctx('squat')).effort.source).toBe('none')
  })

  it('bench：比率は出さず、主働筋・補助筋の向きだけ', () => {
    const r = analyzeSet([rep(1, {}, {})], ctx('bench'))
    expect(r.emphasis.distribution.length).toBe(2)
    expect(r.emphasis.distribution.every(d => d.share === undefined)).toBe(true)
  })

  it('curl：肩の角度の注記', () => {
    const note = (a: number) => analyzeSet([rep(1, {}, { shoulderAngleAtBottom: a })], ctx('curl')).emphasis.note
    expect(note(-15)).toContain('インクライン')
    expect(note(15)).toContain('プリーチャー')
    expect(note(-10)).not.toContain('インクライン')
    expect(note(0)).not.toContain('プリーチャー')
  })
})

describe('崩れの検出としきい値', () => {
  const codes = (key: FormExerciseKey, reps: RepResult[], c: Partial<FormContext> = {}) =>
    analyzeSet(reps, ctx(key, c)).faults.map(f => f.code).sort()
  const one = (m: Partial<RepMetrics>, o: Partial<RepResult> = {}) => [rep(1, o, m)]

  it('squat：forward-lean は 60° 超', () => {
    expect(codes('squat', one({ trunkLeanMax: 61, kneeFlexionBottom: 120 }))).toEqual(['forward-lean'])
    expect(codes('squat', one({ trunkLeanMax: 60, kneeFlexionBottom: 120 }))).toEqual([])
  })
  it('squat：heel-lift は 0.03 超', () => {
    expect(codes('squat', one({ heelLift: 0.031, kneeFlexionBottom: 120 }))).toEqual(['heel-lift'])
    expect(codes('squat', one({ heelLift: 0.03, kneeFlexionBottom: 120 }))).toEqual([])
  })
  it('squat：shallow は膝屈曲 90° 未満（基準なし）', () => {
    expect(codes('squat', one({ kneeFlexionBottom: 89 }))).toEqual(['shallow'])
    expect(codes('squat', one({ kneeFlexionBottom: 90 }))).toEqual([])
  })
  it('squat：基準ありなら shallow は D < 0.9（膝屈曲より基準を優先）', () => {
    const baseline = { romDeg: 100, minAngle: 70, maxAngle: 170 }
    expect(codes('squat', one({ kneeFlexionBottom: 85 }, { romDeg: 80 }), { baseline })).toEqual(['shallow'])
    expect(codes('squat', one({ kneeFlexionBottom: 85 }, { romDeg: 90 }), { baseline })).toEqual([])
    expect(codes('squat', one({ kneeFlexionBottom: 85 }, { romDeg: 100 }), { baseline })).toEqual([])
  })
  it('squat：knee-valgus は front のとき 10° 超だけ', () => {
    const front = { view: 'front' as const, kneeFlexionBottom: 120 }
    expect(codes('squat', one({ ...front, kneeValgusDeg: 11 }))).toEqual(['knee-valgus'])
    expect(codes('squat', one({ ...front, kneeValgusDeg: 10 }))).toEqual([])
    expect(codes('squat', one({ kneeFlexionBottom: 120, kneeValgusDeg: 20 }))).toEqual([]) // side では出さない
  })
  it('squat：計測値が無ければ v1 の shallow / lean を使う', () => {
    expect(codes('squat', one({}, { issues: [issue('shallow'), issue('lean')] }))).toEqual(['forward-lean', 'shallow'])
  })

  it('bench：hip-rise は 0.05 超、bar-drift は 0.25 超', () => {
    expect(codes('bench', one({ hipRise: 0.051 }))).toEqual(['hip-rise'])
    expect(codes('bench', one({ hipRise: 0.05 }))).toEqual([])
    expect(codes('bench', one({ barPathDrift: 0.26 }))).toEqual(['bar-drift'])
    expect(codes('bench', one({ barPathDrift: 0.25 }))).toEqual([])
  })
  it('bench：shallow は v1 の issue、基準ありなら D < 0.9', () => {
    expect(codes('bench', one({}, { issues: [issue('shallow')] }))).toEqual(['shallow'])
    const baseline = { romDeg: 100, minAngle: 70, maxAngle: 170 }
    expect(codes('bench', one({}, { minAngle: 85, maxAngle: 170 }), { baseline })).toEqual(['shallow']) // D = 0.85
    expect(codes('bench', one({}, { minAngle: 80, maxAngle: 170 }), { baseline })).toEqual([]) // D = 0.9
  })

  it('curl：partial-bottom / partial-top は v1 の issue', () => {
    expect(codes('curl', one({}, { issues: [issue('partial-bottom'), issue('partial-top')] }))).toEqual(['partial-bottom', 'partial-top'])
  })
  it('curl：swing は torsoRange 15° 超、elbow-forward は upperArmRange 25° 超', () => {
    expect(codes('curl', one({ torsoRange: 16 }))).toEqual(['swing'])
    expect(codes('curl', one({ torsoRange: 15 }))).toEqual([])
    expect(codes('curl', one({ upperArmRange: 26 }))).toEqual(['elbow-forward'])
    expect(codes('curl', one({ upperArmRange: 25 }))).toEqual([])
  })
  it('curl：計測値が無ければ v1 の body-english → swing、swing → elbow-forward', () => {
    expect(codes('curl', one({}, { issues: [issue('body-english'), issue('swing')] }))).toEqual(['elbow-forward', 'swing'])
  })

  it('共通：fast-down と rom-drop は v1 の issue から', () => {
    expect(codes('squat', one({ kneeFlexionBottom: 120 }, { issues: [issue('fast-down'), issue('rom-drop')] }))).toEqual(['fast-down', 'rom-drop'])
  })

  it('崩れには番号・キュー・練習・セルフチェックが付く', () => {
    const f = analyzeSet(one({ heelLift: 0.05, kneeFlexionBottom: 120 }), ctx('squat')).faults[0]
    expect(f.reps).toEqual([1])
    expect(f.label).toBe('かかとが浮く')
    expect(f.cue).toBe('足裏全体で床を押す')
    expect(f.drills.length).toBeGreaterThan(0)
    expect(f.selfCheck).toContain('膝-壁テスト')
    expect(f.muscleHint).toBeTruthy()
  })

  it('信頼度 0.6 未満のレップでは判定しない', () => {
    const reps = [rep(1, {}, { kneeFlexionBottom: 120 }), rep(2, {}, { heelLift: 0.1, kneeFlexionBottom: 120, confidence: 0.59 })]
    expect(codes('squat', reps)).toEqual([])
  })
})

describe('primaryCue', () => {
  it('安全に関わる崩れ（hip-rise）が、より多い崩れより優先される', () => {
    const reps = [1, 2, 3, 4].map(i => rep(i, { issues: [issue('shallow')] }, i === 1 ? { hipRise: 0.06 } : {}))
    expect(analyzeSet(reps, ctx('bench')).primaryCue).toBe('お尻をベンチに貼りつける')
  })
  it('安全な崩れが無ければ、重大さ（割合 × 超過）が最大のもの', () => {
    // heel-lift：4/4 レップ、forward-lean：1/4 レップ
    const reps = [1, 2, 3, 4].map(i => rep(i, {}, { kneeFlexionBottom: 120, heelLift: 0.04, trunkLeanMax: i === 1 ? 90 : 40 }))
    const r = analyzeSet(reps, ctx('squat'))
    expect(r.faults[0].code).toBe('heel-lift')
    expect(r.primaryCue).toBe('足裏全体で床を押す')
  })
  it('崩れが無ければ undefined', () => {
    expect(analyzeSet(squatReps([120]), ctx('squat')).primaryCue).toBeUndefined()
  })
})

describe('shouldCueLive', () => {
  const h = (n: number) => summary({ faultCounts: n ? { 'forward-lean': n } : {} })
  it('直近3回で0回なら false', () => {
    expect(shouldCueLive('forward-lean', [h(0), h(0), h(0)])).toBe(false)
  })
  it('直近3回のどこかで出ていれば true', () => {
    expect(shouldCueLive('forward-lean', [h(0), h(1), h(0)])).toBe(true)
  })
  it('3回に満たなければ true', () => {
    expect(shouldCueLive('forward-lean', [h(0), h(0)])).toBe(true)
    expect(shouldCueLive('forward-lean', [])).toBe(true)
  })
  it('4回前より古い記録は見ない', () => {
    expect(shouldCueLive('forward-lean', [h(0), h(0), h(0), h(5)])).toBe(false)
  })
})

describe('trend（前回との比較）', () => {
  const full = squatReps([140])
  it('ストレッチの差を「+8 点」の形で出す', () => {
    const r = analyzeSet(full, ctx('squat', { history: [summary({ stretchScore: 92 })] }))
    expect(r.trend).toBe('前回との比較：ストレッチ +8 点。')
  })
  it('下がったときは −', () => {
    const r = analyzeSet(squatReps([115]), ctx('squat', { history: [summary({ stretchScore: 50 })] }))
    expect(r.trend).toBe('前回との比較：ストレッチ −19 点。') // 31 − 50
  })
  it('崩れの回数の変化「3→1」', () => {
    const reps = [rep(1, {}, { kneeFlexionBottom: 120, trunkLeanMax: 70 })]
    const r = analyzeSet(reps, ctx('squat', { history: [summary({ faultCounts: { 'forward-lean': 3 } })] }))
    expect(r.trend).toContain('上体の前傾が大きいの回数 3→1')
  })
  it('差が小さければ「ほぼ同じ」、履歴が無ければ undefined', () => {
    expect(analyzeSet(full, ctx('squat', { history: [summary({ stretchScore: 99 })] })).trend).toBe('前回とほぼ同じです。')
    expect(analyzeSet(full, ctx('squat')).trend).toBeUndefined()
  })
  it('別の種目の履歴とは比べない', () => {
    expect(analyzeSet(full, ctx('squat', { history: [summary({ exerciseId: 'other', stretchScore: 10 })] })).trend).toBeUndefined()
  })
})

describe('レポート全体', () => {
  it('信頼度は計測のあるレップの平均、撮影の向きは多数派', () => {
    const reps = [rep(1, {}, { confidence: 0.9 }), rep(2, {}, { confidence: 0.7 }), rep(3, {}, { confidence: 0.5, view: 'oblique', viewOk: 'caution' })]
    const r = analyzeSet(reps, ctx('squat'))
    expect(r.confidence).toBe(0.7)
    expect(r.view).toBe('side')
    expect(r.viewOk).toBe('ok')
    expect(r.disclaimer).toContain('推定値')
    expect(r.disclaimer).toContain('医師・理学療法士')
  })

  it('全レップが低信頼度：撮り直しの理由だけ出し、ストレッチ・効き具合・原因は出さない', () => {
    const reps = [1, 2].map(i => rep(i, { score: 70, issues: [issue('lean')] }, { confidence: 0.4, viewOk: 'ng', kneeFlexionBottom: 140, trunkLeanMax: 80 }))
    const r = analyzeSet(reps, ctx('squat', { targetId: 'hips' }))
    expect(r.retakeReason).toContain('撮り直')
    expect(r.stretch).toBeUndefined()
    expect(r.emphasis.target).toBeUndefined()
    expect(r.emphasis.distribution).toEqual([])
    expect(r.faults).toEqual([])
    expect(r.primaryCue).toBeUndefined()
    expect(r.overallScore).toBe(70)
    expect(r.confidence).toBe(0.4)
  })

  it('一部だけ低信頼度なら撮り直しは出さず、点数は信頼できるレップで平均', () => {
    const reps = [rep(1, { score: 90 }, {}), rep(2, { score: 50 }, { confidence: 0.3 })]
    const r = analyzeSet(reps, ctx('squat'))
    expect(r.retakeReason).toBeUndefined()
    expect(r.overallScore).toBe(90)
  })

  it('レップが0でも落ちない', () => {
    const r = analyzeSet([], ctx('squat'))
    expect(r.overallScore).toBe(0)
    expect(r.faults).toEqual([])
    expect(r.retakeReason).toBeUndefined()
  })

  it('metrics の無い古い形式のレップが混ざっても落ちず、v1 の issues から崩れを作る', () => {
    const reps = [
      rep(1, { issues: [issue('lean')] }),
      rep(2, {}, { kneeFlexionBottom: 140, trunkLeanMax: 40 }),
    ]
    const r = analyzeSet(reps, ctx('squat'))
    expect(r.faults.map(f => f.code)).toEqual(['forward-lean'])
    expect(r.faults[0].reps).toEqual([1])
    expect(r.confidence).toBe(0.9)
    expect(r.stretch?.reach).toBeCloseTo(1) // 膝屈曲のあるレップだけで算出
  })

  it('すべて古い形式でも落ちない（信頼度 0、撮り直しは出さない）', () => {
    const r = analyzeSet([rep(1, { issues: [issue('shallow')] }), rep(2)], ctx('squat'))
    expect(r.confidence).toBe(0)
    expect(r.view).toBe('unknown')
    expect(r.retakeReason).toBeUndefined()
    expect(r.faults.map(f => f.code)).toEqual(['shallow'])
  })

  it('原因の推定がレポートに入る（1〜2レップ目から出る崩れ）', () => {
    const reps = [1, 2, 3, 4].map(i => rep(i, {}, { kneeFlexionBottom: 120, heelLift: 0.05 }))
    const f = analyzeSet(reps, ctx('squat')).faults[0]
    expect(f.causes.length).toBeGreaterThan(0)
    expect(f.causes.every(c => c.confidence === 'low')).toBe(true)
  })
})

describe('toSessionSummary', () => {
  it('faultCounts に崩れごとのレップ数を入れる', () => {
    const reps = [1, 2, 3].map(i => rep(i, {}, { kneeFlexionBottom: 120, heelLift: i < 3 ? 0.05 : 0, trunkLeanMax: 70 }))
    const c = ctx('squat', { weight: 80 })
    const report = analyzeSet(reps, c)
    const s = toSessionSummary(report, reps, c, '2026-11-25')
    expect(s.faultCounts).toEqual({ 'heel-lift': 2, 'forward-lean': 3 })
    expect(s).toMatchObject({ date: '2026-11-25', exerciseId: 'ex1', key: 'squat', weight: 80, reps: 3 })
    expect(s.avgScore).toBe(report.overallScore)
    expect(s.stretchScore).toBe(report.stretch?.score)
    expect(s.confidence).toBe(report.confidence)
  })
})
