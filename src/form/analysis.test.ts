import { describe, expect, it } from 'vitest'
import { analyzeSet, emphasisTargets, hipKneeLevel, shouldCueLive, toSessionSummary } from './analysis'
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
  it('squat：hipMomentShare の平均から段階（level）と、段階の代表値の share を作る', () => {
    // 平均 0.7 → HKR 2.33 → 股関節優位（代表 HKR 2.2 → h = 2.2 / 3.2）
    const reps = [rep(1, {}, { hipMomentShare: 0.6 }), rep(2, {}, { hipMomentShare: 0.8 })]
    const e = analyzeSet(reps, ctx('squat')).emphasis
    const [hip, quad] = e.distribution
    expect(e.level).toBe('股関節優位')
    expect(hip.muscles).toEqual(['臀筋'])
    expect(hip.share).toBeCloseTo(2.2 / 3.2)
    expect(quad.muscles).toEqual(['大腿四頭筋'])
    expect(quad.share).toBeCloseTo(1 - 2.2 / 3.2)
  })

  it('squat：HKR の4段階の境界（0.6 / 1.2 / 1.85）と代表値', () => {
    const lv = (hkr: number) => hipKneeLevel(hkr / (1 + hkr)).level
    expect(lv(0.59)).toBe('膝優位')
    expect(lv(0.6)).toBe('やや膝寄り')
    expect(lv(1.19)).toBe('やや膝寄り')
    expect(lv(1.2)).toBe('やや股関節寄り')
    expect(lv(1.84)).toBe('やや股関節寄り')
    expect(lv(1.85)).toBe('股関節優位')
    expect(lv(5)).toBe('股関節優位')
    expect(hipKneeLevel(1).level).toBe('股関節優位') // h = 1（HKR 無限大）でも落ちない
    // 代表値 HKR 0.3 / 0.9 / 1.5 / 2.2 → h = HKR / (1 + HKR)
    expect(hipKneeLevel(0.2).share).toBeCloseTo(0.3 / 1.3)
    expect(hipKneeLevel(0.4).share).toBeCloseTo(0.9 / 1.9)
    expect(hipKneeLevel(0.55).share).toBeCloseTo(1.5 / 2.5)
    expect(hipKneeLevel(0.7).share).toBeCloseTo(2.2 / 3.2)
  })

  it('squat：hipMomentShare から4段階の level が出る（膝優位〜股関節優位）', () => {
    const level = (h: number) => analyzeSet(squatReps([120], { hipMomentShare: h }), ctx('squat')).emphasis.level
    expect(level(0.3)).toBe('膝優位')
    expect(level(0.5)).toBe('やや膝寄り')
    expect(level(0.55)).toBe('やや股関節寄り')
    expect(level(0.7)).toBe('股関節優位')
    expect(analyzeSet([rep(1, {}, {})], ctx('bench')).emphasis.level).toBeUndefined()
    expect(analyzeSet([rep(1, {}, {})], ctx('curl')).emphasis.level).toBeUndefined()
  })

  it('squat：最下点で 体幹の前傾 − すねの前傾 ≥ 2.2° なら「股関節寄りの姿勢」、未満なら「膝寄りの姿勢」', () => {
    const note = (trunk: number) =>
      analyzeSet(squatReps([120], { shinLeanBottom: 30, trunkLeanBottom: trunk, hipMomentShare: 0.5 }), ctx('squat')).emphasis.note
    expect(note(32.2)).toContain('股関節寄りの姿勢です（Straub, Barrack ら 2025）')
    expect(note(32.2)).not.toContain('膝寄りの姿勢')
    expect(note(32.1)).toContain('膝寄りの姿勢')
    expect(note(32.1)).not.toContain('股関節寄りの姿勢')
    expect(note(32.2)).not.toContain('Barrack 2021')
    expect(note(32.2)).toContain('論文は3D・しゃがむ局面全体の平均、アプリは2D・最下点の近似です。')
    // 最下点の体幹前傾（trunkLeanBottom）が無ければ、姿勢の注記は出さない（レップ中の最大 trunkLeanMax は使わない）
    const none = analyzeSet(squatReps([120], { shinLeanBottom: 30, trunkLeanMax: 50 }), ctx('squat')).emphasis.note
    expect(none).not.toContain('寄りの姿勢')
  })

  it('squat：hipMomentShare が無ければ share は undefined', () => {
    const r = analyzeSet(squatReps([120]), ctx('squat'))
    expect(r.emphasis.distribution.every(d => d.share === undefined)).toBe(true)
  })

  it('狙い未選択なら target は undefined', () => {
    expect(analyzeSet(squatReps([120]), ctx('squat')).emphasis.target).toBeUndefined()
  })

  describe('狙いの部位の score = 100 × S × (0.6P + 0.4L)', () => {
    // flex 140 → L = 1。hipMomentShare 0.7 → 股関節優位（share 2.2/3.2 = 0.6875）、速度低下 12.5% → P = 0.5
    const reps = (loss?: number) => squatReps([140], { hipMomentShare: 0.7, velocityLossPct: loss })
    it('P と L の両方あり', () => {
      const hips = analyzeSet(reps(12.5), ctx('squat', { targetId: 'hips' })).emphasis.target!
      expect(hips.share).toBeCloseTo(0.6875)
      expect(hips.score).toBe(48) // 100 × 0.6875 × (0.3 + 0.4) = 48.1
      expect(hips.tips.length).toBeGreaterThan(0)
      const quads = analyzeSet(reps(12.5), ctx('squat', { targetId: 'quads' })).emphasis.target!
      expect(quads.share).toBeCloseTo(0.3125)
      expect(quads.score).toBe(22) // 100 × 0.3125 × 0.7 = 21.9
    })
    it('P が無ければ L だけ', () => {
      expect(analyzeSet(reps(undefined), ctx('squat', { targetId: 'hips' })).emphasis.target?.score).toBe(69) // 100 × 0.6875
    })
    it('L が無ければ P だけ（bench は S = 1）', () => {
      const r = analyzeSet([rep(1, {}, { velocityLossPct: 12.5 })], ctx('bench', { targetId: 'chest' }))
      expect(r.emphasis.target?.share).toBeUndefined()
      expect(r.emphasis.target?.score).toBe(50)
    })
    it('P も L も無ければ score は undefined', () => {
      const r = analyzeSet([rep(1, {}, {})], ctx('bench', { targetId: 'triceps' }))
      expect(r.emphasis.target?.score).toBeUndefined()
      expect(r.emphasis.target?.tips.length).toBeGreaterThan(0)
    })
  })

  it('effort：速度低下の最大から proximity を出す（筋肥大向けの目安 25% で 1、Hickmott 2022）', () => {
    const reps = [0, 10, 60].map((l, i) => rep(i + 1, {}, { velocityLossPct: l }))
    const r = analyzeSet(reps, ctx('squat'))
    expect(r.effort.velocityLossPct).toBe(60)
    expect(r.effort.proximity).toBe(1)
    expect(r.effort.source).toBe('velocity')
    const one = (loss: number, key: 'squat' | 'bench') => analyzeSet([rep(1, {}, { velocityLossPct: loss })], ctx(key)).effort
    expect(one(12.5, 'squat').proximity).toBeCloseTo(0.5)
    expect(one(25, 'squat').proximity).toBe(1)
    expect(one(24, 'squat').proximity).toBeCloseTo(0.96)
    expect(one(40, 'bench').proximity).toBe(1) // 40% で打ち止めにしない：25% 以上は 1
    expect(one(10, 'bench').proximity).toBeCloseTo(0.4)
    expect(analyzeSet(squatReps([120]), ctx('squat')).effort.source).toBe('none')
  })

  it('effort：curl は proximity を出さない（source は none）', () => {
    const r = analyzeSet([rep(1, {}, { velocityLossPct: 30 })], ctx('curl'))
    expect(r.effort).toEqual({ source: 'none' })
    expect(r.effort.proximity).toBeUndefined()
    // curl の狙いスコアは、proximity が無いのでストレッチだけから出る
    const t = analyzeSet([rep(1, { maxAngle: 170 }, { velocityLossPct: 30 })], ctx('curl', { targetId: 'long' })).emphasis.target!
    expect(t.score).toBe(Math.round(100 * 1))
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

  it('curl：注記は Kassiano ら 2025 の筋厚の結果と Attarieh 2025 で、Nunes や仕組みの断定は書かない', () => {
    const n = analyzeSet([rep(1, {}, { shoulderAngleAtBottom: -15 })], ctx('curl')).emphasis.note
    expect(n).toContain('Kassiano ら 2025')
    expect(n).toContain('Attarieh 2025')
    expect(n).not.toContain('Nunes')
    expect(n).not.toContain('伸びやすい')
  })

  it('bench：コツに Mendonça を引用しない。squat の hips のコツに Paoli 2009 は「筋電」「未検証」を添える', () => {
    const chest = analyzeSet([rep(1, {}, {})], ctx('bench', { targetId: 'chest' })).emphasis.target!.tips.join('')
    expect(chest).not.toContain('Mendon')
    expect(chest).toContain('毎回同じ深さ')
    const hips = analyzeSet(squatReps([120]), ctx('squat', { targetId: 'hips' })).emphasis.target!.tips.join('')
    expect(hips).toContain('筋電')
    expect(hips).toContain('筋肥大は未検証')
    const distal = analyzeSet([rep(1, {}, {})], ctx('curl', { targetId: 'distal' })).emphasis.target!.tips.join('')
    expect(distal).toContain('Kassiano ら 2025')
    expect(distal).not.toContain('Nunes')
  })
})

describe('崩れの検出としきい値', () => {
  const codes = (key: FormExerciseKey, reps: RepResult[], c: Partial<FormContext> = {}) =>
    analyzeSet(reps, ctx(key, c)).faults.map(f => f.code).sort()
  const one = (m: Partial<RepMetrics>, o: Partial<RepResult> = {}) => [rep(1, o, m)]

  it('squat：forward-lean は 72° 超（基準動画なし。60° + 誤差の余裕 12°）', () => {
    expect(codes('squat', one({ trunkLeanMax: 73, kneeFlexionBottom: 120 }))).toEqual(['forward-lean'])
    expect(codes('squat', one({ trunkLeanMax: 72, kneeFlexionBottom: 120 }))).toEqual([])
    expect(codes('squat', one({ trunkLeanMax: 61, kneeFlexionBottom: 120 }))).toEqual([])
  })
  it('squat：基準動画があれば forward-lean は「基準の前傾 +15°」超で判定', () => {
    const baseline = { romDeg: 100, minAngle: 70, maxAngle: 170, trunkLeanMax: 40 }
    expect(codes('squat', one({ trunkLeanMax: 56, kneeFlexionBottom: 120 }), { baseline })).toEqual(['forward-lean'])
    expect(codes('squat', one({ trunkLeanMax: 55, kneeFlexionBottom: 120 }), { baseline })).toEqual([])
    // 基準に前傾の値が無ければ従来どおり 60° 超
    expect(codes('squat', one({ trunkLeanMax: 56, kneeFlexionBottom: 120 }), { baseline: { romDeg: 100, minAngle: 70, maxAngle: 170 } })).toEqual([])
  })
  it('squat：heel-lift は 0.03 超', () => {
    expect(codes('squat', one({ heelLift: 0.031, kneeFlexionBottom: 120 }))).toEqual(['heel-lift'])
    expect(codes('squat', one({ heelLift: 0.03, kneeFlexionBottom: 120 }))).toEqual([])
  })
  it('squat：shallow は膝屈曲 78° 未満（基準なし。90° − 誤差の余裕 12°）', () => {
    expect(codes('squat', one({ kneeFlexionBottom: 77 }))).toEqual(['shallow'])
    expect(codes('squat', one({ kneeFlexionBottom: 78 }))).toEqual([])
    expect(codes('squat', one({ kneeFlexionBottom: 89 }))).toEqual([])
  })
  it('squat：基準ありなら shallow は D < 0.9（膝屈曲より基準を優先）', () => {
    const baseline = { romDeg: 100, minAngle: 70, maxAngle: 170 }
    expect(codes('squat', one({ kneeFlexionBottom: 85 }, { romDeg: 80 }), { baseline })).toEqual(['shallow'])
    expect(codes('squat', one({ kneeFlexionBottom: 85 }, { romDeg: 90 }), { baseline })).toEqual([])
    expect(codes('squat', one({ kneeFlexionBottom: 85 }, { romDeg: 100 }), { baseline })).toEqual([])
  })
  it('squat：knee-valgus は front で viewOk が ok のとき 10° 超だけ', () => {
    const front = { view: 'front' as const, kneeFlexionBottom: 120 }
    expect(codes('squat', one({ ...front, kneeValgusDeg: 11 }))).toEqual(['knee-valgus'])
    expect(codes('squat', one({ ...front, kneeValgusDeg: 10 }))).toEqual([])
    expect(codes('squat', one({ kneeFlexionBottom: 120, kneeValgusDeg: 20 }))).toEqual([]) // side では出さない
    // 向きが ok でない（caution・ng）正面では出さない
    expect(codes('squat', one({ ...front, viewOk: 'caution', kneeValgusDeg: 20 }))).toEqual([])
    expect(codes('squat', one({ ...front, viewOk: 'ng', kneeValgusDeg: 20 }))).toEqual([])
    // 表示名は「見える」（2D の見かけの値）
    const f = analyzeSet(one({ ...front, kneeValgusDeg: 20 }), ctx('squat')).faults[0]
    expect(f.label).toBe('膝が内側に入って見える')
    expect(f.evidence).toContain('R² 0〜64%')
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
    const reps = [rep(1, {}, { kneeFlexionBottom: 120, trunkLeanMax: 75 })]
    const r = analyzeSet(reps, ctx('squat', { history: [summary({ faultCounts: { 'forward-lean': 3 } })] }))
    expect(r.trend).toContain('上体の前傾が大きい：3回→1回')
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
    const reps = [1, 2, 3].map(i => rep(i, {}, { kneeFlexionBottom: 120, heelLift: i < 3 ? 0.05 : 0, trunkLeanMax: 75 }))
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

// ---------------------------------------------------------------------------
// 追加6種目（rdl・ohp・lateral・pulldown・ohext・bss）
// ---------------------------------------------------------------------------

const BASE = { romDeg: 60, minAngle: 100, maxAngle: 160 }
const codesOf = (r: ReturnType<typeof analyzeSet>) => r.faults.map(f => f.code)
const reps5 = (m: Partial<RepMetrics>, o: Partial<RepResult> = {}) => Array.from({ length: 5 }, (_, i) => rep(i + 1, o, m))

describe('追加6種目：狙いの選択肢', () => {
  it('種目ごとの狙い（ohp・lateral・pulldown は狙いなし）', () => {
    expect(emphasisTargets('rdl').map(t => t.id)).toEqual(['hams', 'glutes'])
    expect(emphasisTargets('ohp')).toEqual([])
    expect(emphasisTargets('lateral')).toEqual([])
    expect(emphasisTargets('pulldown')).toEqual([])
    expect(emphasisTargets('ohext').map(t => t.id)).toEqual(['long'])
    expect(emphasisTargets('bss').map(t => t.id)).toEqual(['quads', 'glutes'])
  })
})

describe('追加6種目：ストレッチ', () => {
  it('ohext：基準なしは肘屈曲 90° で 100 点、45° は D=0.5 で 31 点。研究の可動域を reference にする', () => {
    const full = analyzeSet(reps5({ elbowFlexionBottom: 90 }), ctx('ohext')).stretch!
    expect(full.score).toBe(100)
    expect(full.reference).toBe('研究の可動域（肘を 90° まで曲げる：Maeo 2023）')
    const half = analyzeSet(reps5({ elbowFlexionBottom: 45 }), ctx('ohext')).stretch!
    expect(half.reach).toBeCloseTo(0.5)
    expect(half.score).toBe(31)
  })

  it('ohext：基準動画があれば基準を優先する', () => {
    const s = analyzeSet(reps5({ elbowFlexionBottom: 90 }, { romDeg: 30 }), ctx('ohext', { baseline: BASE })).stretch!
    expect(s.reach).toBeCloseTo(0.5)
    expect(s.reference).toBe('あなたの基準動画')
  })

  it.each(['rdl', 'ohp', 'lateral', 'pulldown', 'bss'] as const)('%s：基準なしは stretch が undefined', key => {
    const m = { elbowFlexionBottom: 90, kneeFlexionBottom: 100, hipFlexionBottom: 80 }
    expect(analyzeSet(reps5(m), ctx(key)).stretch).toBeUndefined()
  })

  it.each(['rdl', 'ohp', 'lateral', 'pulldown', 'bss'] as const)('%s：基準ありは romDeg / 基準で判定する', key => {
    expect(analyzeSet(reps5({}, { romDeg: 60 }), ctx(key, { baseline: BASE })).stretch?.score).toBe(100)
    const half = analyzeSet(reps5({}, { romDeg: 30 }), ctx(key, { baseline: BASE })).stretch!
    expect(half.reach).toBeCloseTo(0.5)
    expect(half.score).toBe(31)
    expect(half.reference.startsWith('あなたの基準動画')).toBe(true)
  })

  it('rdl：基準ありの reference に Maeo 2021 の類推の補足が付く', () => {
    const s = analyzeSet(reps5({}, { romDeg: 60 }), ctx('rdl', { baseline: BASE })).stretch!
    expect(s.reference).toContain('Maeo 2021')
    expect(s.reference).toContain('類推')
  })
})

describe('追加6種目：効いている部位・狙い・コツ', () => {
  it('rdl：主働筋の向きだけ（割合なし）、背中の丸まりは測れない旨を note に書く', () => {
    const r = analyzeSet(reps5({}), ctx('rdl'))
    expect(r.emphasis.distribution.length).toBeGreaterThan(0)
    expect(r.emphasis.distribution.every(d => d.share === undefined)).toBe(true)
    expect(r.emphasis.note).toContain('背中の丸まりはこのアプリでは測れません')
  })

  it('rdl：もも裏とお尻で別のコツ（筋電の研究・筋肥大は未検証）', () => {
    const hams = analyzeSet(reps5({}), ctx('rdl', { targetId: 'hams' })).emphasis.target!
    expect(hams.tips[0]).toContain('膝を軽く曲げたまま')
    expect(hams.tips[0]).toContain('Coratella 2022')
    expect(hams.tips[0]).toContain('筋肥大は未検証')
    const glutes = analyzeSet(reps5({}), ctx('rdl', { targetId: 'glutes' })).emphasis.target!
    expect(glutes.tips[0]).toContain('膝を伸ばし気味')
  })

  it('ohp：狙いなし。首の後ろへ下ろす方法はおすすめしない旨を note に', () => {
    const r = analyzeSet(reps5({}), ctx('ohp'))
    expect(r.emphasis.target).toBeUndefined()
    expect(r.emphasis.note).toContain('おすすめしません')
  })

  it('lateral：note にダンベルとケーブルの差なし（Larsen 2025）。左右差が 15° 以下なら参考表示は出ない', () => {
    const r = analyzeSet(reps5({ abductionAsymmetry: 10 }), ctx('lateral'))
    expect(r.emphasis.note).toContain('Larsen 2025')
    expect(r.emphasis.note).not.toContain('左右で上がる高さが違って見えます')
  })

  it('lateral：左右差が 15° を超えると note に参考表示。崩れには入れない', () => {
    const r = analyzeSet(reps5({ abductionAsymmetry: 20 }), ctx('lateral'))
    expect(r.emphasis.note).toContain('左右で上がる高さが違って見えます（参考）')
    expect(codesOf(r)).not.toContain('asymmetry')
    expect(r.faults).toEqual([])
  })

  it('pulldown：note に順手・後傾の研究（Buonsenso 2025）、狙いなし', () => {
    const r = analyzeSet(reps5({}), ctx('pulldown'))
    expect(r.emphasis.note).toContain('Buonsenso 2025')
    expect(r.emphasis.target).toBeUndefined()
  })

  it('ohext：狙いは長頭。コツに +28.5% 対 +19.6%（Maeo 2023）と軽くなってよい旨', () => {
    const t = analyzeSet(reps5({}), ctx('ohext', { targetId: 'long' })).emphasis.target!
    expect(t.label).toBe('腕の裏の長頭')
    expect(t.tips.join('')).toContain('+28.5% 対 +19.6%')
    expect(t.tips.join('')).toContain('軽くなる')
  })

  it('bss：太もも前とお尻で別のコツ。curl の long・squat の quads のコツは混ざらない', () => {
    const q = analyzeSet(reps5({}), ctx('bss', { targetId: 'quads' })).emphasis.target!
    expect(q.tips[0]).toContain('上体を立て')
    expect(q.tips.join('')).not.toContain('Straub')
    const g = analyzeSet(reps5({}), ctx('bss', { targetId: 'glutes' })).emphasis.target!
    expect(g.tips[0]).toContain('Aygun-Polat 2025')
    const curlLong = analyzeSet(reps5({}), ctx('curl', { targetId: 'long' })).emphasis.target!
    expect(curlLong.tips[0]).toContain('インクライン')
  })

  it('効き具合スコア：share が無い種目は S=1、速度の目安は出さないので L（ストレッチ）だけ', () => {
    const r = analyzeSet(
      reps5({ elbowFlexionBottom: 90, velocityLossPct: 40 }), ctx('ohext', { targetId: 'long' }),
    )
    expect(r.effort.source).toBe('none')
    expect(r.effort.proximity).toBeUndefined()
    expect(r.emphasis.target?.score).toBe(100)
  })

  it('効き具合スコア：L が無ければ undefined（rdl の基準なし）', () => {
    const r = analyzeSet(reps5({}), ctx('rdl', { targetId: 'hams' }))
    expect(r.emphasis.target?.score).toBeUndefined()
  })
})

describe('追加6種目：崩れの検出', () => {
  it('rdl knee-bend：膝の内角 130° 未満（130° ちょうどは出ない）。背中の丸まりは検出しない', () => {
    expect(codesOf(analyzeSet(reps5({ kneeAngleBottom: 125 }), ctx('rdl')))).toEqual(['knee-bend'])
    expect(analyzeSet(reps5({ kneeAngleBottom: 130 }), ctx('rdl')).faults).toEqual([])
  })

  it('rdl shallow-hinge：基準ありの D < 0.9 だけ。基準なしでは出さない', () => {
    expect(codesOf(analyzeSet(reps5({}, { romDeg: 50 }), ctx('rdl', { baseline: BASE })))).toEqual(['shallow-hinge'])
    expect(analyzeSet(reps5({}, { romDeg: 55 }), ctx('rdl', { baseline: BASE })).faults).toEqual([]) // D=0.917
    expect(analyzeSet(reps5({}, { romDeg: 10 }), ctx('rdl')).faults).toEqual([])
  })

  it('ohp lean-back：開始時より 15° 超の増加で出る（ちょうど 15° は出ない）。安全に関わる崩れ', () => {
    expect(codesOf(analyzeSet(reps5({ trunkLeanBack: 20, trunkLeanBackBaseline: 4 }), ctx('ohp')))).toEqual(['lean-back'])
    expect(analyzeSet(reps5({ trunkLeanBack: 20, trunkLeanBackBaseline: 5 }), ctx('ohp')).faults).toEqual([])
    // 開始時が分からなければ判定しない
    expect(analyzeSet(reps5({ trunkLeanBack: 40 }), ctx('ohp')).faults).toEqual([])
  })

  it('ohp lean-back：primaryCue で他の崩れより優先する', () => {
    const m = { trunkLeanBack: 17, trunkLeanBackBaseline: 0, elbowFlexionBottom: 20 }
    const r = analyzeSet(reps5(m), ctx('ohp'))
    expect(codesOf(r).sort()).toEqual(['lean-back', 'shallow'])
    expect(r.primaryCue).toBe('お腹に力を入れ、肋骨を下げる')
  })

  it('ohp shallow：基準なしは肘の屈曲 70° 未満、基準ありは D < 0.9', () => {
    expect(codesOf(analyzeSet(reps5({ elbowFlexionBottom: 65 }), ctx('ohp')))).toEqual(['shallow'])
    expect(analyzeSet(reps5({ elbowFlexionBottom: 70 }), ctx('ohp')).faults).toEqual([])
    expect(codesOf(analyzeSet(reps5({ elbowFlexionBottom: 90 }, { romDeg: 50 }), ctx('ohp', { baseline: BASE })))).toEqual(['shallow'])
    // 基準があるときは肘の屈曲では判定しない
    expect(analyzeSet(reps5({ elbowFlexionBottom: 30 }, { romDeg: 60 }), ctx('ohp', { baseline: BASE })).faults).toEqual([])
  })

  it('lateral swing：体幹の振れ 15° 超。左右差は faults に入れない', () => {
    expect(codesOf(analyzeSet(reps5({ torsoRange: 18 }), ctx('lateral')))).toEqual(['swing'])
    expect(analyzeSet(reps5({ torsoRange: 15, abductionAsymmetry: 30 }), ctx('lateral')).faults).toEqual([])
  })

  it('pulldown swing：体幹の振れ 20° 超。後傾は崩れにしない', () => {
    expect(codesOf(analyzeSet(reps5({ torsoRange: 22 }), ctx('pulldown')))).toEqual(['swing'])
    expect(analyzeSet(reps5({ torsoRange: 20, trunkLeanBack: 35 }), ctx('pulldown')).faults).toEqual([])
  })

  it('pulldown partial-top：基準なしは肘の内角 150° 未満、基準ありは 基準の最大角 − 15° 未満', () => {
    expect(codesOf(analyzeSet(reps5({ elbowExtensionTop: 140 }), ctx('pulldown')))).toEqual(['partial-top'])
    expect(analyzeSet(reps5({ elbowExtensionTop: 150 }), ctx('pulldown')).faults).toEqual([])
    const b = { romDeg: 100, minAngle: 60, maxAngle: 170 }
    // 基準 170 − 15 = 155：152 は出る、156 は出ない（romDeg を基準に合わせて shallow 系を避ける）
    expect(codesOf(analyzeSet(reps5({ elbowExtensionTop: 152 }, { romDeg: 100 }), ctx('pulldown', { baseline: b })))).toEqual(['partial-top'])
    expect(analyzeSet(reps5({ elbowExtensionTop: 156 }, { romDeg: 100 }), ctx('pulldown', { baseline: b })).faults).toEqual([])
  })

  it('ohext shallow：基準なしは肘の屈曲 90° 未満、基準ありは D < 0.9', () => {
    expect(codesOf(analyzeSet(reps5({ elbowFlexionBottom: 80 }), ctx('ohext')))).toEqual(['shallow'])
    expect(analyzeSet(reps5({ elbowFlexionBottom: 90 }), ctx('ohext')).faults).toEqual([])
    expect(codesOf(analyzeSet(reps5({ elbowFlexionBottom: 120 }, { romDeg: 50 }), ctx('ohext', { baseline: BASE })))).toEqual(['shallow'])
    expect(analyzeSet(reps5({ elbowFlexionBottom: 20 }, { romDeg: 60 }), ctx('ohext', { baseline: BASE })).faults).toEqual([])
  })

  it('ohext elbow-drift：上腕の振れ 25° 超', () => {
    expect(codesOf(analyzeSet(reps5({ elbowFlexionBottom: 95, upperArmRange: 30 }), ctx('ohext')))).toEqual(['elbow-drift'])
    expect(analyzeSet(reps5({ elbowFlexionBottom: 95, upperArmRange: 25 }), ctx('ohext')).faults).toEqual([])
  })

  it('bss shallow：基準なしは前脚の膝屈曲 78° 未満、基準ありは D < 0.9。前傾は崩れにしない', () => {
    expect(codesOf(analyzeSet(reps5({ kneeFlexionBottom: 70 }), ctx('bss')))).toEqual(['shallow'])
    expect(analyzeSet(reps5({ kneeFlexionBottom: 78, trunkLeanMax: 80 }), ctx('bss')).faults).toEqual([])
    expect(codesOf(analyzeSet(reps5({ kneeFlexionBottom: 120 }, { romDeg: 50 }), ctx('bss', { baseline: BASE })))).toEqual(['shallow'])
    expect(analyzeSet(reps5({ kneeFlexionBottom: 40 }, { romDeg: 60 }), ctx('bss', { baseline: BASE })).faults).toEqual([])
  })

  it('bss：note に前傾は臀筋寄りのやり方である旨', () => {
    expect(analyzeSet(reps5({ kneeFlexionBottom: 100 }), ctx('bss')).emphasis.note).toContain('上体の前傾は臀筋寄りのやり方です')
  })

  it('共通：fast-down・rom-drop は新種目でも出る', () => {
    const issues = [issue('fast-down'), issue('rom-drop')]
    const r = analyzeSet(reps5({ kneeAngleBottom: 160 }, { issues }), ctx('rdl'))
    expect(codesOf(r).sort()).toEqual(['fast-down', 'rom-drop'])
  })

  it('信頼度 0.6 未満のレップは検出に使わない', () => {
    const reps = [rep(1, {}, { kneeAngleBottom: 100, confidence: 0.5 }), rep(2, {}, { kneeAngleBottom: 160 })]
    expect(analyzeSet(reps, ctx('rdl')).faults).toEqual([])
  })

  it('各崩れに label・cue・drills・evidence が付く', () => {
    const r = analyzeSet(reps5({ kneeAngleBottom: 120 }), ctx('rdl'))
    const f = r.faults[0]
    expect(f.cue).toBe('すねを床と垂直に保つ')
    expect(f.label).toContain('膝が曲がりすぎ')
    expect(f.drills.length).toBeGreaterThan(0)
    expect(f.evidence).toContain('暫定')
  })

  it('各崩れのキュー文言', () => {
    const cue = (key: FormExerciseKey, m: Partial<RepMetrics>, o: Partial<FormContext> = {}) =>
      analyzeSet(reps5(m), ctx(key, o)).faults[0].cue
    expect(cue('ohp', { elbowFlexionBottom: 50 })).toBe('バーを顎の高さまで下ろす')
    expect(cue('lateral', { torsoRange: 30 })).toBe('上体を止めたまま腕だけ')
    expect(cue('pulldown', { torsoRange: 30 })).toBe('胸を張ったまま、肘を下へ')
    expect(cue('pulldown', { elbowExtensionTop: 100 })).toBe('バーに引き上げられるまで腕を伸ばす')
    expect(cue('ohext', { elbowFlexionBottom: 50 })).toBe('手を首の後ろまで下ろす')
    expect(cue('ohext', { elbowFlexionBottom: 95, upperArmRange: 40 })).toBe('肘を天井に向けたまま')
    expect(cue('bss', { kneeFlexionBottom: 50 })).toBe('後ろ膝を床に近づける')
    expect(analyzeSet(reps5({}, { romDeg: 30 }), ctx('rdl', { baseline: BASE })).faults[0].cue).toBe('お尻を後ろの壁へ')
  })
})

describe('追加6種目：原因の候補', () => {
  it('bss shallow：基準なしの確信度は最大 low、基準ありなら上がりうる', () => {
    const noBase = analyzeSet(reps5({ kneeFlexionBottom: 70 }), ctx('bss')).faults[0]
    expect(noBase.causes.every(c => c.confidence === 'low')).toBe(true)
    const h = (n: number) => summary({ key: 'bss', faultCounts: { shallow: 5 }, weight: n })
    const withBase = analyzeSet(
      reps5({ kneeFlexionBottom: 100 }, { romDeg: 40 }),
      ctx('bss', { baseline: BASE, history: [h(30), h(30), h(30)], weight: 40 }),
    ).faults[0]
    expect(withBase.causes.some(c => c.confidence !== 'low')).toBe(true)
  })

  it('ohp lean-back の原因は 重量・疲労・技術 に限られる', () => {
    const reps = [1, 2, 3, 4, 5, 6].map(i =>
      rep(i, {}, { trunkLeanBack: i >= 5 ? 30 : 5, trunkLeanBackBaseline: 0, velocityLossPct: i >= 5 ? 30 : 0 }))
    const f = analyzeSet(reps, ctx('ohp')).faults.find(x => x.code === 'lean-back')!
    expect(f.causes.length).toBeGreaterThan(0)
    expect(f.causes.every(c => ['load', 'fatigue', 'technique'].includes(c.cause))).toBe(true)
    expect(f.causes[0].cause).toBe('fatigue')
  })

  it('rdl knee-bend の原因は技術だけ（確信度は最大 mid）', () => {
    const f = analyzeSet(reps5({ kneeAngleBottom: 110 }), ctx('rdl')).faults[0]
    expect(f.causes.every(c => c.cause === 'technique')).toBe(true)
    expect(f.causes.every(c => c.confidence !== 'high')).toBe(true)
  })
})

describe('追加6種目：履歴の要約と前回比較', () => {
  it('toSessionSummary に種目キーと崩れ回数が入る', () => {
    const c = ctx('ohp')
    const reps = reps5({ trunkLeanBack: 30, trunkLeanBackBaseline: 0 })
    const s = toSessionSummary(analyzeSet(reps, c), reps, c, '2026-11-25')
    expect(s.key).toBe('ohp')
    expect(s.faultCounts).toEqual({ 'lean-back': 5 })
  })
})
