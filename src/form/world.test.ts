import { describe, expect, it } from 'vitest'
import { WORLD_MIN_FRAMES, isWorldDepthFlat, judgeWorldTrust } from './world'
import type { WorldFrame } from './world'
import { makeScene } from './synthetic'
import type { SceneSpec } from './synthetic'
import { LM } from './types'

const REPS = Array.from({ length: 5 }, () => ({ minAngle: 80, eccS: 1.0, conS: 0.7 }))
const SETS = 20

function frames(spec: Omit<SceneSpec, 'seed' | 'reps' | 'exercise'>, seed: number): WorldFrame[] {
  return makeScene({ exercise: 'squat', reps: REPS, ...spec, seed }).frames.map(f => ({ world: f.world }))
}
/** 20セットのうち、信用できる（true）と判定された数 */
function trusted(spec: Omit<SceneSpec, 'seed' | 'reps' | 'exercise'>): number {
  let n = 0
  for (let s = 0; s < SETS; s++) if (judgeWorldTrust('squat', frames(spec, 400 + s)).trust) n++
  return n
}

describe('judgeWorldTrust（world 座標を信用できるか）', () => {
  it('正常な world：φ 0・15・30° で、誤って false にする割合は 5% 以下（20 セット）', () => {
    for (const phi of [0, 15, 30]) {
      expect(trusted({ camera: { yawDeg: phi } })).toBeGreaterThanOrEqual(SETS * 0.95)
    }
  })

  it('正常な world：理由は空、統計値が入る。左右の太ももの比はほぼ 1', () => {
    const r = judgeWorldTrust('squat', frames({ camera: { yawDeg: 15 } }, 1))
    expect(r.trust).toBe(true)
    expect(r.reasons).toEqual([])
    expect(r.stats.frames).toBeGreaterThan(100)
    expect(r.stats.lrRatio).toBeGreaterThan(0.95)
    expect(r.stats.lrRatio).toBeLessThan(1.05)
    expect(r.stats.lenBadRatio).toBeLessThan(0.2)
  })

  it('z のノイズが 0.3 m（noisy）：全部の向き（0・15・30・45°）で、95% 以上のセットを false にする', () => {
    for (const phi of [0, 15, 30, 45]) {
      const t = trusted({ camera: { yawDeg: phi }, worldCollapse: 'noisy' })
      expect(SETS - t).toBeGreaterThanOrEqual(SETS * 0.95)
    }
  })

  it('z が 0 に潰れた（flat）：全部の向き（0・15・30・45°）で、95% 以上のセットを false にする（判定 5 を組み込んだ）', () => {
    for (const phi of [0, 15, 30, 45]) {
      const t = trusted({ camera: { yawDeg: phi }, worldCollapse: 'flat' })
      expect(SETS - t).toBeGreaterThanOrEqual(SETS * 0.95)
    }
    const r = judgeWorldTrust('squat', frames({ camera: { yawDeg: 0 }, worldCollapse: 'flat' }, 1))
    expect(r.reasons).toContain('world 座標の奥行きが潰れています')
  })

  it('isWorldDepthFlat は flat をすべての向きで見つけ、正常・noisy を誤検出しない', () => {
    for (const phi of [0, 15, 30, 45]) {
      for (let s = 0; s < 5; s++) {
        expect(isWorldDepthFlat(frames({ camera: { yawDeg: phi }, worldCollapse: 'flat' }, 500 + s))).toBe(true)
        expect(isWorldDepthFlat(frames({ camera: { yawDeg: phi } }, 500 + s))).toBe(false)
        expect(isWorldDepthFlat(frames({ camera: { yawDeg: phi }, worldCollapse: 'noisy' }, 500 + s))).toBe(false)
      }
    }
    expect(isWorldDepthFlat([])).toBe(false)
  })

  it('左右の太ももの長さの比が範囲外（右の太ももが 1.5 倍）なら false（判定 3）。計測側（左）だけを見る判定 1 は通る', () => {
    const fr = frames({ camera: { yawDeg: 0 } }, 2).map(f => {
      const w = (f.world ?? []).map(p => ({ ...p }))
      const h = w[LM.rightHip]
      const k = w[LM.rightKnee]
      w[LM.rightKnee] = { ...k, x: h.x + 1.5 * (k.x - h.x), y: h.y + 1.5 * (k.y - h.y), z: h.z + 1.5 * (k.z - h.z) }
      return { world: w }
    })
    const r = judgeWorldTrust('squat', fr, { side: 'left' })
    expect(r.trust).toBe(false)
    expect(r.reasons.join()).toContain('左右')
    expect(r.stats.lrRatio).toBeLessThan(0.8)
  })

  it('骨の長さがコマごとに ±15% を超えて変わる（判定 1）：false', () => {
    const fr = frames({ camera: { yawDeg: 0 } }, 3).map((f, i) => {
      const w = (f.world ?? []).map(p => ({ ...p }))
      const s = i % 2 === 0 ? 1.4 : 0.7
      for (const side of [LM.leftKnee, LM.rightKnee]) {
        const hip = side === LM.leftKnee ? w[LM.leftHip] : w[LM.rightHip]
        w[side] = { ...w[side], x: hip.x + s * (w[side].x - hip.x), y: hip.y + s * (w[side].y - hip.y) }
      }
      return { world: w }
    })
    const r = judgeWorldTrust('squat', fr)
    expect(r.trust).toBe(false)
    expect(r.reasons.join()).toContain('骨の長さ')
  })

  it('φ が暴れる（判定 2）：肩の z を交互に入れ替えると false', () => {
    const fr = frames({ camera: { yawDeg: 0 } }, 4).map((f, i) => {
      const w = (f.world ?? []).map(p => ({ ...p }))
      if (i % 2 === 0) { w[LM.leftShoulder] = { ...w[LM.leftShoulder], x: -0.3 }; w[LM.rightShoulder] = { ...w[LM.rightShoulder], x: 0.3 } }
      return { world: w }
    })
    const r = judgeWorldTrust('squat', fr)
    expect(r.trust).toBe(false)
    expect(r.reasons.join()).toContain('撮影の向き')
  })

  it('使えるコマが少ない・world が無いときは、判断できないので false', () => {
    expect(judgeWorldTrust('squat', []).trust).toBe(false)
    const few = frames({ camera: { yawDeg: 0 } }, 5).slice(0, WORLD_MIN_FRAMES - 1)
    expect(judgeWorldTrust('squat', few).trust).toBe(false)
    const none = frames({ camera: { yawDeg: 0 } }, 5).map(() => ({}))
    expect(judgeWorldTrust('squat', none).trust).toBe(false)
  })

  it('一部のコマ（pose なし）が欠けていても判定できる', () => {
    const sc = makeScene({
      exercise: 'squat', reps: REPS, camera: { yawDeg: 15 }, seed: 6,
      occlusions: [{ joint: 'knee', side: 'near', startS: 2.0, durS: 0.3, mode: 'missing' }],
    })
    const r = judgeWorldTrust('squat', sc.frames.map(f => ({ world: f.world })))
    expect(r.trust).toBe(true)
    expect(r.stats.frames).toBeLessThan(sc.frames.length)
  })

  it('腕の種目（curl）は上腕・前腕の長さで判定する。正常な curl は true', () => {
    const reps = Array.from({ length: 5 }, () => ({ minAngle: 50, eccS: 1.0, conS: 0.8 }))
    const sc = makeScene({ exercise: 'curl', reps, camera: { yawDeg: 10 }, seed: 7 })
    expect(judgeWorldTrust('curl', sc.frames.map(f => ({ world: f.world }))).trust).toBe(true)
  })
})
