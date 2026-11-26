/**
 * 見えない部分の補正（2回目）の確認：RepTracker に組み込んだ補間・外れ値の除去・奥側での代用・world の確認・推定の扱い。
 * 作った姿勢データ（synthetic.ts）で、真値と比べる。数値は synthetic.ts の体の寸法・ノイズ（どちらも設計値・暫定）に依存する。
 * 「補正前」の値は、1回目（synthetic.test.ts）で今のコード（補正なし）を測った記録：真横 φ0 で平均絶対誤差 1.20°、欠け 6 コマで 4.99°。
 */
import { describe, expect, it } from 'vitest'
import { analyzeSet } from './analysis'
import { isBaselineRep } from './baseline'
import { RepTracker } from './engine'
import { refineRep } from './fill'
import { toAspectCorrected } from './geometry'
import { computeMainAngle, SIDE_INDEX } from './rules'
import type { Joint } from './rules'
import { makeScene } from './synthetic'
import type { Scene, SceneSpec } from './synthetic'
import type { MeasureFrame } from './measure'
import { LM } from './types'
import type { FormContext, JointSource, Landmark, RepMetrics, RepResult } from './types'

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
const REPS = Array.from({ length: 5 }, () => ({ minAngle: 80, eccS: 1.0, conS: 0.7 }))
const SETS = 10
/** 補正前（1回目の記録）：真横 φ0 の平均絶対誤差と、最下点にかかる 6 コマの欠けの平均絶対誤差 */
const BEFORE_PHI0 = 1.2
const BEFORE_GAP6 = 4.99

function track(spec: SceneSpec, key: 'squat' | 'bench' | 'curl' = spec.exercise) {
  const sc = makeScene(spec)
  const tr = new RepTracker(key)
  for (const f of sc.frames) tr.push(f.pose ? toAspectCorrected(f.pose, sc.aspect) : undefined, f.t, f.world)
  const reps = tr.flush()
  return { sc, reps, errors: reps.map((r, i) => r.minAngle - (sc.truth[i]?.minAngle ?? NaN)) }
}

/** 条件ごとに 10 セット（50 レップ）を測る */
function condition(base: Omit<SceneSpec, 'seed'>, occ?: (sc: Scene) => SceneSpec['occlusions'], seed0 = 100) {
  const errs: number[] = []
  let countOk = 0
  const all: RepResult[] = []
  for (let s = 0; s < SETS; s++) {
    const plain = makeScene({ ...base, seed: seed0 + s })
    const spec: SceneSpec = { ...base, seed: seed0 + s, ...(occ ? { occlusions: occ(plain) } : {}) }
    const r = track(spec)
    if (r.reps.length === base.reps.length) countOk++
    errs.push(...r.errors)
    all.push(...r.reps)
  }
  return { mae: mean(errs.map(Math.abs)), bias: mean(errs), countOk, reps: all }
}

/** 最下点を中心に n コマの、手前の膝の lowVis（レップごと） */
const kneeGap = (n: number, joint: Joint = 'knee', mode: 'lowVis' | 'missing' = 'lowVis') => (sc: Scene): SceneSpec['occlusions'] =>
  sc.truth.map(tr => {
    const k0 = Math.round((tr.minT * 30) / 1000) - Math.floor(n / 2)
    return { joint, side: 'near' as const, startS: k0 / 30 - 1e-6, durS: n / 30 - 1e-6, mode }
  })

describe('補正の効果（スクワット、膝の最小角度、真値 80°、10 セット×5 レップ）', () => {
  const clean = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 } })

  it('採用の基準 1：真横 φ0・隠れなしで、補正前（1.20°）より 0.3° 以上悪化しない。回数は全セットで一致', () => {
    expect(clean.countOk).toBe(SETS)
    expect(clean.mae).toBeLessThanOrEqual(BEFORE_PHI0 + 0.3)
    // 欠けが無ければ補正は何もしない（補正前と同じ値）
    expect(clean.mae).toBeCloseTo(BEFORE_PHI0, 1)
  })

  it('採用の基準 1：φ 15・30・45° も補正前と同じ（欠けが無ければ変わらない）', () => {
    const before: Record<number, number> = { 15: 1.26, 30: 4.51, 45: 11.84 }
    for (const phi of [15, 30, 45]) {
      const r = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: phi } })
      expect(r.countOk).toBe(SETS)
      expect(r.mae).toBeCloseTo(before[phi], 1)
    }
  })

  it('採用の基準 2：欠け 3・6 コマ（最下点を含む）は「欠けなし＋1.0°」以内、回数は全セット一致、補正前より小さい', () => {
    for (const n of [3, 6]) {
      const r = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 } }, kneeGap(n))
      expect(r.countOk).toBe(SETS)
      expect(r.mae).toBeLessThanOrEqual(clean.mae + 1.0)
    }
    const six = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 } }, kneeGap(6))
    expect(six.mae).toBeLessThan(BEFORE_GAP6)
  })

  it('採用の基準 2：欠けが最下点を外れていても、「欠けなし＋1.0°」以内', () => {
    const shifted = (n: number) => (sc: Scene): SceneSpec['occlusions'] =>
      sc.truth.map(tr => {
        const k0 = Math.round((tr.minT * 30) / 1000) - Math.floor(n / 2) - 12
        return { joint: 'knee' as const, side: 'near' as const, startS: k0 / 30 - 1e-6, durS: n / 30 - 1e-6, mode: 'lowVis' as const }
      })
    for (const n of [3, 6]) {
      const r = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 } }, shifted(n))
      expect(r.countOk).toBe(SETS)
      expect(r.mae).toBeLessThanOrEqual(clean.mae + 1.0)
    }
  })

  it('補った欠けには推定の印（estimatedRatio、最下点にかかれば bottomEstimated）が付く。欠けが無いレップには付かない', () => {
    const r = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 } }, kneeGap(6))
    expect(r.reps.every(x => x.metrics?.bottomEstimated === true)).toBe(true)
    expect(r.reps.every(x => (x.metrics?.estimatedRatio ?? 0) > 0.05)).toBe(true)
    expect(clean.reps.every(x => x.metrics?.estimatedRatio === undefined && x.metrics?.bottomEstimated === undefined)).toBe(true)
  })

  it('採用の基準 3：欠け 10 コマ（pose ごと欠ける）は埋めない。bottomEstimated が全レップに付き、最下点は浅く出る', () => {
    const r = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 } }, kneeGap(10, 'knee', 'missing'))
    expect(r.countOk).toBe(SETS)
    expect(r.reps.every(x => x.metrics?.bottomEstimated === true)).toBe(true)
    // 埋めていないので、欠けた分の最下点は取れず、補間した場合（6 コマで 1.8°）より大きく外れる
    expect(r.mae).toBeGreaterThan(clean.mae + 1.5)
    expect(r.reps.every(x => x.metrics?.mirrored === undefined)).toBe(true)
  })

  it('採用の基準 4：外れ値 5% でも、レップ数は全セットで一致し、誤差の増加は 0.5° 以内', () => {
    const r = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, spikeRate: 0.05 })
    expect(r.countOk).toBe(SETS)
    expect(r.mae).toBeLessThanOrEqual(clean.mae + 0.5)
  })

  it('外れ値 5%：別の seed の 10 セットでも、レップ数がすべて一致する', () => {
    const r = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, spikeRate: 0.05 }, undefined, 700)
    expect(r.countOk).toBe(SETS)
  })

  it('先頭のコマが飛んでいても、全部のコマを捨て続けず、5 レップ数える（基準を取り直す）', () => {
    // seed 1134・1176・1192：最初のコマが飛ぶ（立位の長さが無い動画ファイルの流れ。最初の 5 コマは外れ値を判定しない）
    for (const seed of [1134, 1176, 1192]) {
      const r = track({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, spikeRate: 0.05, seed })
      expect(r.reps).toHaveLength(5)
      expect(mean(r.errors.map(Math.abs))).toBeLessThan(3)
    }
  })

  it('ライブ撮影（立位の骨の長さを setRefLengths で渡す）：最初のコマから外れ値を判定する。seed 205 は 2 コマ目の足首が飛ぶ', () => {
    const spec: SceneSpec = { exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, spikeRate: 0.05, seed: 205 }
    const clean = makeScene({ ...spec, spikeRate: 0, noise: { px: 0, worldXY: 0, worldZ: 0 } })
    const p = toAspectCorrected(clean.frames[0].pose ?? [], clean.aspect)
    const len = (i: number, j: number) => Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y)
    const sc = makeScene(spec)
    const run = (standing: boolean) => {
      const tr = new RepTracker('squat')
      if (standing) tr.setRefLengths(len(LM.leftHip, LM.leftKnee), len(LM.leftKnee, LM.leftAnkle))
      for (const f of sc.frames) tr.push(f.pose ? toAspectCorrected(f.pose, sc.aspect) : undefined, f.t, f.world)
      return tr.flush()
    }
    expect(run(true)).toHaveLength(5)
    // 立位の長さが無い流れでは、最初の 5 コマの飛びは防げない（記録：偽のレップが 1 つ増える）
    expect(run(false)).toHaveLength(6)
  })

  it('1点（肩）だけが 0.3 秒見えなくても、そのレップを捨てない（回数・最小角度とも保つ）。肩は主関節ではない', () => {
    const r = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 } }, kneeGap(9, 'shoulder'))
    expect(r.countOk).toBe(SETS)
    expect(r.mae).toBeLessThanOrEqual(clean.mae + 0.3)
    expect(r.reps.every(x => (x.metrics?.estimatedRatio ?? 0) > 0)).toBe(true)
  })
})

describe('奥側での代用（手前の関節が 0.2 秒を超えて見えないとき）', () => {
  it('手前の膝が 10 コマ（最下点を含む）見えない：奥側の膝で代用し、mirrored の印が付く。確信度は下がる', () => {
    const base = { exercise: 'squat' as const, reps: REPS, camera: { yawDeg: 0 } }
    const clean = condition(base)
    const r = condition(base, kneeGap(10))
    expect(r.countOk).toBe(SETS)
    expect(r.reps.every(x => x.metrics?.mirrored === true)).toBe(true)
    expect(r.reps.every(x => x.metrics?.bottomEstimated === true)).toBe(true)
    // 奥側の誤差は手前の約 2 倍（synthetic の farSideMult）。補正前（10 コマを捨てる）の 11.4° より小さい
    expect(r.mae).toBeLessThan(6)
    expect(mean(r.reps.map(x => x.metrics?.confidence ?? 0))).toBeLessThan(mean(clean.reps.map(x => x.metrics?.confidence ?? 0)))
  })

  it('両側が見えない（pose ごと欠ける）ときは代用できない（mirrored は付かない）', () => {
    const r = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 } }, kneeGap(10, 'knee', 'missing'))
    expect(r.reps.every(x => x.metrics?.mirrored === undefined)).toBe(true)
  })
})

describe('world の確認（judgeWorldTrust を RepTracker が使う）', () => {
  const lastTrust = (spec: Omit<SceneSpec, 'seed'>, seed: number) => {
    const r = track({ ...spec, seed })
    return r.reps[r.reps.length - 1]?.metrics
  }

  it('z が 0 に潰れた（flat）・z のノイズが 0.3 m（noisy）：全部の向き（0・15・30・45°）で、全セット worldTrust=false', () => {
    for (const phi of [0, 15, 30, 45]) {
      for (const collapse of ['flat', 'noisy'] as const) {
        let falseCount = 0
        for (let s = 0; s < 20; s++) {
          const m = lastTrust({ exercise: 'squat', reps: REPS, camera: { yawDeg: phi }, worldCollapse: collapse }, 400 + s)
          if (m?.worldTrust === false) falseCount++
        }
        expect(falseCount).toBeGreaterThanOrEqual(19)
      }
    }
  })

  it('正常な world は φ≤30° で信用する（95% 以上のセット）', () => {
    for (const phi of [0, 15, 30]) {
      let trusted = 0
      for (let s = 0; s < 20; s++) {
        const m = lastTrust({ exercise: 'squat', reps: REPS, camera: { yawDeg: phi } }, 400 + s)
        if (m?.worldTrust === true) trusted++
      }
      expect(trusted).toBeGreaterThanOrEqual(19)
    }
  })

  it('信用できない world は使わない：速度をメートルに換算せず、φ は付けない（2D の比で向きを判定）', () => {
    const bad = lastTrust({ exercise: 'squat', reps: REPS, camera: { yawDeg: 15 }, worldCollapse: 'noisy' }, 1)
    expect(bad?.worldTrust).toBe(false)
    expect(bad?.concentricVelocity).toBeUndefined()
    expect(bad?.phiDeg).toBeUndefined()
    expect(bad?.velocityLossPct).toBeDefined() // 体節長あたりの比と速度低下は出す
    const good = lastTrust({ exercise: 'squat', reps: REPS, camera: { yawDeg: 15 } }, 1)
    expect(good?.worldTrust).toBe(true)
    expect(good?.concentricVelocity).toBeGreaterThan(0)
    expect(good?.phiDeg).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// refineRep の単体
// ---------------------------------------------------------------------------

/** 作った姿勢データから、RepTracker と同じ形の MeasureFrame（手前の左側、squat/bss の関節）を作る */
function frames(sc: Scene): MeasureFrame[] {
  const joints: Joint[] = ['shoulder', 'hip', 'knee', 'ankle']
  return sc.frames.map(f => {
    const pose = f.pose ? toAspectCorrected(f.pose, sc.aspect) : undefined
    const pts: Partial<Record<Joint, Landmark>> = {}
    const src: Partial<Record<Joint, JointSource>> = {}
    for (const j of joints) {
      const lm = pose?.[SIDE_INDEX.left[j]]
      if (lm && (lm.visibility ?? 0) >= 0.5) { pts[j] = lm; src[j] = 'measured' } else src[j] = 'missing'
    }
    const angle = computeMainAngle('squat', pts)
    return { t: f.t, visible: angle !== undefined, side: 'left', pose, pts, src, angle, angles: angle !== undefined ? { knee: angle } : undefined }
  })
}

describe('refineRep（補正の中身）', () => {
  const gapScene = (n: number, mode: 'lowVis' | 'missing' = 'lowVis') => {
    const base = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 5 })
    return makeScene({
      exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 5,
      occlusions: kneeGap(n, 'knee', mode)(base)?.slice(0, 1),
    })
  }
  const kneeSources = (fr: MeasureFrame[]) => fr.map(f => f.src?.knee)

  it('欠けが無ければ、渡した配列をそのまま返す（何も変えない）', () => {
    const fr = frames(makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 5 }))
    expect(refineRep('squat', fr)).toBe(fr)
  })

  it('膝が 3・6 コマ見えない：interpolated の印を付けて埋める。埋めたコマだけ（前後は measured のまま）', () => {
    for (const n of [3, 6]) {
      const out = refineRep('squat', frames(gapScene(n)))
      const src = kneeSources(out)
      expect(src.filter(s => s === 'interpolated')).toHaveLength(n)
      expect(src.filter(s => s === 'missing')).toHaveLength(0)
      for (const f of out) if (f.src?.knee === 'interpolated') { expect(f.visible).toBe(true); expect(f.angle).toBeGreaterThan(0) }
    }
  })

  it('膝が 10 コマ見えない：bss（奥側で代用しない種目）では埋めず、missing のまま。そのコマは visible=false', () => {
    const out = refineRep('bss', frames(gapScene(10)))
    const src = kneeSources(out)
    expect(src.filter(s => s === 'interpolated')).toHaveLength(0)
    expect(src.filter(s => s === 'missing')).toHaveLength(10)
    expect(out.filter(f => f.src?.knee === 'missing').every(f => !f.visible)).toBe(true)
  })

  it('膝が 10 コマ見えない：squat は奥側で代用し、mirrored の印（補間はしない）', () => {
    const out = refineRep('squat', frames(gapScene(10)))
    const src = kneeSources(out)
    expect(src.filter(s => s === 'interpolated')).toHaveLength(0)
    expect(src.filter(s => s === 'mirrored')).toHaveLength(10)
  })

  it('pose ごと 3 コマ欠ける：補間して visible に戻る。lateral は補正しない', () => {
    const sc = gapScene(3, 'missing')
    const out = refineRep('squat', frames(sc))
    const holes = sc.frames.map((f, i) => (f.pose ? -1 : i)).filter(i => i >= 0)
    expect(holes.length).toBeGreaterThan(0)
    for (const i of holes) expect(out[i].src?.knee).toBe('interpolated')
    const fr = frames(sc)
    expect(refineRep('lateral', fr)).toBe(fr)
  })

  it('外れ値（1 コマの飛び）を欠けにして補間する：飛んだコマの座標が前後の間に戻る', () => {
    const sc = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 5, noise: { px: 0, worldXY: 0, worldZ: 0 } })
    const fr = frames(sc)
    const k = 60
    const orig = fr[k].pts?.knee as Landmark
    fr[k] = { ...fr[k], pts: { ...fr[k].pts, knee: { ...orig, x: orig.x + 0.3 } } }
    const thigh = Math.hypot((fr[0].pts?.hip?.x ?? 0) - (fr[0].pts?.knee?.x ?? 0), (fr[0].pts?.hip?.y ?? 0) - (fr[0].pts?.knee?.y ?? 0))
    const out = refineRep('squat', fr, { lens: { a: thigh, b: thigh } })
    expect(out[k].src?.knee).toBe('interpolated')
    expect(Math.abs((out[k].pts?.knee?.x ?? 0) - orig.x)).toBeLessThan(0.01)
  })
})

// ---------------------------------------------------------------------------
// 推定の扱い（確信度・安全に関わる崩れ・浅さ・基準づくり・注記）
// ---------------------------------------------------------------------------

function rep(index: number, m: Partial<RepMetrics>, o: Partial<RepResult> = {}): RepResult {
  return {
    index, score: 80, romDeg: 100, eccentricSec: 2, concentricSec: 1, minAngle: 80, maxAngle: 170, issues: [], ...o,
    metrics: { confidence: 0.9, view: 'side', viewOk: 'ok', ...m },
  }
}
const ctx = (key: FormContext['key']): FormContext => ({ key, exerciseId: 'ex1', weight: 60, history: [] })
const codesOf = (r: ReturnType<typeof analyzeSet>) => r.faults.map(f => f.code)

describe('推定の扱い（analysis.ts・baseline.ts）', () => {
  it('安全に関わる崩れ（bench の hip-rise）：推定の割合が 0.2 未満なら出し、0.2 以上なら出さない。出さない理由は注記に書く', () => {
    const ok = analyzeSet([1, 2, 3].map(i => rep(i, { hipRise: 0.5, estimatedRatio: 0.1 })), ctx('bench'))
    expect(codesOf(ok)).toContain('hip-rise')
    const heavy = analyzeSet([1, 2, 3].map(i => rep(i, { hipRise: 0.5, estimatedRatio: 0.3 })), ctx('bench'))
    expect(codesOf(heavy)).not.toContain('hip-rise')
    expect(heavy.notes?.some(n => n.includes('見えない時間があったため') && n.includes('判定しませんでした'))).toBe(true)
    // 補っていない（estimatedRatio なし）レップは今までどおり出す
    expect(codesOf(analyzeSet([1, 2, 3].map(i => rep(i, { hipRise: 0.5 })), ctx('bench')))).toContain('hip-rise')
  })

  it('一部のレップだけ推定が多いとき：そのレップだけ安全に関わる崩れから外れる', () => {
    const reps = [rep(1, { hipRise: 0.5 }), rep(2, { hipRise: 0.5, estimatedRatio: 0.4 }), rep(3, { hipRise: 0.5 })]
    expect(analyzeSet(reps, ctx('bench')).faults.find(f => f.code === 'hip-rise')?.reps).toEqual([1, 3])
  })

  it('最下点が推定のレップ：浅さの崩れの原因の確信度は low まで（high・mid にならない）', () => {
    // 直近 2 セットの軽い重量でも毎回出ている履歴つき（原因の確信度が high になる条件）
    const history = [1, 2].map(() => ({
      date: '2026-11-01', exerciseId: 'ex1', key: 'ohp' as const, weight: 20, reps: 5, avgScore: 80, faultCounts: { shallow: 5 }, confidence: 0.9,
    }))
    const shallow = (m: Partial<RepMetrics>) => analyzeSet(
      [1, 2, 3, 4, 5].map(i => rep(i, { elbowFlexionBottom: 20, ...m })), { ...ctx('ohp'), history },
    )
    const plain = shallow({}).faults.find(f => f.code === 'shallow')
    const est = shallow({ bottomEstimated: true }).faults.find(f => f.code === 'shallow')
    expect(plain).toBeDefined()
    expect(est).toBeDefined()
    expect(est?.causes.every(c => c.confidence === 'low')).toBe(true)
    expect(plain?.causes.some(c => c.confidence !== 'low')).toBe(true)
  })

  it('補った回・奥側で代用した回・最下点が見えなかった回が注記に出る。何も補っていなければ notes は付かない', () => {
    const r = analyzeSet([
      rep(1, {}), rep(2, { estimatedRatio: 0.1 }), rep(3, { estimatedRatio: 0.3, mirrored: true }), rep(4, { estimatedRatio: 0.1, bottomEstimated: true }),
    ], ctx('squat'))
    expect(r.notes).toContain('関節が一時的に見えなかった回：2回目、4回目（前後から補いました）')
    expect(r.notes?.some(n => n.startsWith('手前の関節が長く見えず、奥側で代用した回：3回目'))).toBe(true)
    expect(r.notes?.some(n => n.startsWith('最下点が見えなかった回：4回目'))).toBe(true)
    expect(analyzeSet([rep(1, {}), rep(2, {})], ctx('squat')).notes).toBeUndefined()
    expect(analyzeSet([rep(1, { worldTrust: false })], ctx('squat')).notes?.some(n => n.includes('速度'))).toBe(true)
  })

  it('基準づくり（isBaselineRep）：推定の割合 0.2 以上・奥側で代用・最下点が推定のレップは使わない', () => {
    const good = { confidence: 0.9 }
    expect(isBaselineRep(rep(1, good))).toBe(true)
    expect(isBaselineRep(rep(1, { ...good, estimatedRatio: 0.1 }))).toBe(true)
    expect(isBaselineRep(rep(1, { ...good, estimatedRatio: 0.2 }))).toBe(false)
    expect(isBaselineRep(rep(1, { ...good, mirrored: true }))).toBe(false)
    expect(isBaselineRep(rep(1, { ...good, bottomEstimated: true }))).toBe(false)
  })
})

describe('最下点が推定のレップは、浅さを減点しない（RepTracker）', () => {
  // 浅いスクワット（膝 110°）。欠けなしでは shallow が出る
  const shallowReps = Array.from({ length: 4 }, () => ({ minAngle: 110, eccS: 1.0, conS: 0.7 }))

  it('欠けなし：shallow が出る／最下点を含む 10 コマが見えない：bottomEstimated で shallow は出ない（減点なし）', () => {
    const plain = track({ exercise: 'squat', reps: shallowReps, camera: { yawDeg: 0 }, seed: 9 })
    expect(plain.reps.some(r => r.issues.some(i => i.code === 'shallow'))).toBe(true)
    const base = makeScene({ exercise: 'squat', reps: shallowReps, camera: { yawDeg: 0 }, seed: 9 })
    const hidden = track({
      exercise: 'squat', reps: shallowReps, camera: { yawDeg: 0 }, seed: 9, occlusions: kneeGap(10, 'knee', 'missing')(base),
    })
    expect(hidden.reps).toHaveLength(4)
    expect(hidden.reps.every(r => r.metrics?.bottomEstimated === true)).toBe(true)
    expect(hidden.reps.some(r => r.issues.some(i => i.code === 'shallow'))).toBe(false)
    const plainPenalty = mean(plain.reps.map(r => 100 - r.score))
    const hiddenPenalty = mean(hidden.reps.map(r => 100 - r.score))
    expect(hiddenPenalty).toBeLessThan(plainPenalty)
  })
})
