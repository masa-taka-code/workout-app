/**
 * 作った姿勢データの生成器の確認と、「今のコード」（RepTracker）の誤差の記録。
 * 誤差の測定は合否を決めるものではなく、現状の値を記録する（2回目の採用の基準 4.4 を確定するための材料）。
 * 数値は仕様の【計算】とは別物：ここでの値は synthetic.ts の体の寸法・ノイズ（どちらも【設計値・暫定】）に依存する。
 */
import { describe, expect, it } from 'vitest'
import { RepTracker } from './engine'
import { jointAngle, toAspectCorrected } from './geometry'
import { makeScene } from './synthetic'
import type { SceneSpec } from './synthetic'
import { LM } from './types'

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
const REPS = Array.from({ length: 5 }, () => ({ minAngle: 80, eccS: 1.0, conS: 0.7 }))
const CLEAN = { px: 0, worldXY: 0, worldZ: 0 }

/** 今のコードで1セット（5レップ）を計測し、レップごとの最小角度の誤差（計測 − 真値）を返す */
function trackerErrors(spec: SceneSpec): { count: number; errors: number[] } {
  const sc = makeScene(spec)
  const tr = new RepTracker(spec.exercise === 'curl' ? 'curl' : spec.exercise)
  for (const f of sc.frames) tr.push(f.pose ? toAspectCorrected(f.pose, sc.aspect) : undefined, f.t, f.world)
  const reps = tr.flush()
  return { count: reps.length, errors: reps.map((r, i) => r.minAngle - (sc.truth[i]?.minAngle ?? NaN)) }
}

/** 条件ごとに10セット（50レップ）を測る */
function condition(base: Omit<SceneSpec, 'seed'>, sets = 10) {
  const errs: number[] = []
  let countOk = 0
  for (let s = 0; s < sets; s++) {
    const r = trackerErrors({ ...base, seed: 100 + s })
    if (r.count === base.reps.length) countOk++
    errs.push(...r.errors)
  }
  return { mae: mean(errs.map(Math.abs)), bias: mean(errs), countOk, sets }
}

describe('makeScene（生成器）', () => {
  it('同じ seed なら同じ結果、seed が違えば別のノイズ', () => {
    const spec: SceneSpec = { exercise: 'squat', reps: REPS, camera: { yawDeg: 15 }, seed: 7 }
    const a = makeScene(spec)
    const b = makeScene(spec)
    const c = makeScene({ ...spec, seed: 8 })
    expect(a.frames[40].pose).toEqual(b.frames[40].pose)
    expect(a.frames[40].pose).not.toEqual(c.frames[40].pose)
  })

  it('真値（truth）：レップ数・最小角度・時刻の並び・コマ間隔', () => {
    const sc = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0, fps: 30 }, seed: 1 })
    expect(sc.truth).toHaveLength(5)
    for (const t of sc.truth) {
      expect(t.minAngle).toBe(80)
      expect(t.minT).toBeGreaterThan(t.startT)
      expect(t.endT).toBeGreaterThan(t.minT)
      expect((t.minT - t.startT) / 1000).toBeCloseTo(1.0, 5)
      expect((t.endT - t.minT) / 1000).toBeCloseTo(0.7, 5)
    }
    expect(sc.frames[1].t - sc.frames[0].t).toBeCloseTo(1000 / 30, 6)
    expect(sc.frames).toHaveLength(sc.trueAngles.length)
  })

  it('本当の最小の内角は minAngle、伸びた側は 175°（3D、ノイズなしでも誤差 0.01° 未満）', () => {
    const sc = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 30 }, toeOutDeg: 20, seed: 1, noise: CLEAN })
    expect(Math.min(...sc.trueAngles)).toBeCloseTo(80, 2)
    expect(Math.max(...sc.trueAngles)).toBeCloseTo(175, 2)
  })

  it('真横・つま先 0°・ノイズなし：画面上の膝の角度が真値と一致する（射影が正しい）', () => {
    const sc = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 1, noise: CLEAN })
    for (const i of [0, 50, 100, 150]) {
      const p = toAspectCorrected(sc.frames[i].pose ?? [], sc.aspect)
      expect(jointAngle(p[LM.leftHip], p[LM.leftKnee], p[LM.leftAnkle])).toBeCloseTo(sc.trueAngles[i], 1)
    }
  })

  it('斜めから撮ると、画面上の膝の角度は真値より大きく（伸びて）見える', () => {
    const sc = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 45 }, seed: 1, noise: CLEAN })
    const i = Math.round((sc.truth[0].minT / 1000) * sc.fps)
    const p = toAspectCorrected(sc.frames[i].pose ?? [], sc.aspect)
    expect(jointAngle(p[LM.leftHip], p[LM.leftKnee], p[LM.leftAnkle])).toBeGreaterThan(sc.trueAngles[i] + 5)
  })

  it('手前（左）は visibility 0.95、奥（右）は 0.7。world は股関節の中点が原点', () => {
    const sc = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 1, noise: CLEAN })
    const f = sc.frames[10]
    expect(f.pose?.[LM.leftKnee].visibility).toBe(0.95)
    expect(f.pose?.[LM.rightKnee].visibility).toBe(0.7)
    const w = f.world ?? []
    expect((w[LM.leftHip].x + w[LM.rightHip].x) / 2).toBeCloseTo(0, 6)
    expect((w[LM.leftHip].z + w[LM.rightHip].z) / 2).toBeCloseTo(0, 6)
    // 手前（左）は奥（右）より z が小さい
    expect(w[LM.leftHip].z).toBeLessThan(w[LM.rightHip].z)
  })

  it('隠れ：lowVis は visibility 0.2、missing は pose なし、drift は反対側へ寄る', () => {
    const sc = makeScene({
      exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 1, noise: CLEAN,
      occlusions: [
        { joint: 'knee', side: 'near', startS: 2.0, durS: 0.2, mode: 'lowVis' },
        { joint: 'wrist', side: 'near', startS: 3.0, durS: 0.1, mode: 'missing' },
        { joint: 'ankle', side: 'near', startS: 4.0, durS: 1.0, mode: 'drift' },
      ],
    })
    const at = (s: number) => sc.frames[Math.round(s * sc.fps)]
    expect(at(2.05).pose?.[LM.leftKnee].visibility).toBe(0.2)
    expect(at(2.5).pose?.[LM.leftKnee].visibility).toBe(0.95)
    expect(at(3.0).pose).toBeUndefined()
    expect(at(3.0).world).toBeUndefined()
    // drift：途中（50%）で、手前の足首が奥の足首の位置と一致する（寄りきる）
    const d = at(4.5).pose ?? []
    expect(d[LM.leftAnkle].x).toBeCloseTo(d[LM.rightAnkle].x, 6)
    expect(d[LM.leftAnkle].visibility).toBe(0.6)
  })

  it('隠れの長さ：lowVis で 6 コマ分（0.2 秒）', () => {
    const sc = makeScene({
      exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 1, noise: CLEAN,
      occlusions: [{ joint: 'knee', side: 'near', startS: 2.0 - 1e-6, durS: 0.2 - 1e-6, mode: 'lowVis' }],
    })
    expect(sc.frames.filter(f => (f.pose?.[LM.leftKnee].visibility ?? 1) < 0.5)).toHaveLength(6)
  })

  it('外れ値：spikeRate に応じて、1コマだけ手前の関節が大きく飛ぶ', () => {
    const sc = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 3, spikeRate: 0.05 })
    expect(sc.spikes.length).toBeGreaterThan(0)
    expect(sc.spikes.length).toBeLessThan(sc.frames.length * 0.15)
    const none = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 3 })
    expect(none.spikes).toHaveLength(0)
  })

  it('world の崩れ：flat は z が全部 0、noisy は z のばらつきが大きい', () => {
    const flat = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 30 }, seed: 1, worldCollapse: 'flat' })
    expect(flat.frames[20].world?.every(p => p.z === 0)).toBe(true)
    const noisy = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 1, worldCollapse: 'noisy' })
    const normal = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 1 })
    const spread = (sc: typeof noisy) => {
      const d = sc.frames.map(f => (f.world?.[LM.leftKnee].z ?? 0) - (f.world?.[LM.leftHip].z ?? 0))
      const m = mean(d)
      return Math.sqrt(mean(d.map(x => (x - m) ** 2)))
    }
    expect(spread(noisy)).toBeGreaterThan(spread(normal) * 3)
  })

  it('curl・bench：肘の内角の最小が minAngle（手前側）。RepTracker が5回数える', () => {
    for (const ex of ['curl', 'bench'] as const) {
      const reps = Array.from({ length: 5 }, () => ({ minAngle: ex === 'curl' ? 50 : 70, eccS: 1.0, conS: 0.8 }))
      const sc = makeScene({ exercise: ex, reps, camera: { yawDeg: 0 }, seed: 1, noise: CLEAN })
      expect(Math.min(...sc.trueAngles)).toBeCloseTo(reps[0].minAngle, 2)
      const r = trackerErrors({ exercise: ex, reps, camera: { yawDeg: 0 }, seed: 1 })
      expect(r.count).toBe(5)
    }
  })
})

describe('今のコード（RepTracker）の誤差の記録：スクワット、膝の最小角度、真値 80°、10セット×5レップ', () => {
  it('撮影の向き φ 0/15/30/45° × つま先 0/20°：回数は全セットで一致し、φ が大きいほど誤差が増える', () => {
    const table: Record<string, ReturnType<typeof condition>> = {}
    for (const phi of [0, 15, 30, 45]) {
      for (const toe of [0, 20]) {
        const r = condition({ exercise: 'squat', reps: REPS, camera: { yawDeg: phi }, toeOutDeg: toe })
        table[`${phi}/${toe}`] = r
        expect(r.countOk).toBe(r.sets)
        expect(Number.isFinite(r.mae)).toBe(true)
      }
    }
    // 撮影の向きがずれるほど、膝は伸びて（大きく）見える（偏りが正）。真横の誤差は小さい
    expect(table['45/0'].mae).toBeGreaterThan(table['0/0'].mae)
    expect(table['45/0'].bias).toBeGreaterThan(0)
    expect(table['0/0'].mae).toBeLessThan(3)
    expect(table['45/20'].mae).toBeGreaterThan(table['15/0'].mae)
  })

  it('隠れ（手前の膝 lowVis、最下点を含む）3・6・10 コマ：回数を保つ。2回目の補正（補間・奥側での代用）で、誤差は 5° 未満', () => {
    for (const n of [3, 6, 10]) {
      let countOk = 0
      const errs: number[] = []
      for (let s = 0; s < 6; s++) {
        const base = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 200 + s })
        const occ = base.truth.map(tr => {
          const k0 = Math.round((tr.minT * 30) / 1000) - Math.floor(n / 2)
          return { joint: 'knee' as const, side: 'near' as const, startS: k0 / 30 - 1e-6, durS: n / 30 - 1e-6, mode: 'lowVis' as const }
        })
        const r = trackerErrors({ exercise: 'squat', reps: REPS, camera: { yawDeg: 0 }, seed: 200 + s, occlusions: occ })
        if (r.count === 5) countOk++
        errs.push(...r.errors.map(Math.abs))
      }
      expect(countOk).toBe(6)
      // 1回目の記録（欠けたコマを捨てていた頃）：最下点を捨てるので、欠けが長いほど「浅く」見えて、10 コマで 5° を超えていた（約 11°）。
      // 2回目で短い欠けは補間し、0.2 秒を超える欠けは奥側の膝で代用するようにしたので、5° 未満になる（refine.test.ts に詳しい試験）
      expect(Number.isFinite(mean(errs))).toBe(true)
      expect(mean(errs)).toBeLessThan(5)
    }
  })
})
