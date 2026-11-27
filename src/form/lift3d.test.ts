/**
 * 試験的な 3D 角度（lift3d.ts）の確認と、採用の基準（仕様 4.4 の「3回目」）の試験。
 * 作った姿勢データ（synthetic.ts。体の寸法・ノイズは【設計値・暫定】）、squat、seed 固定、10セット×5レップ。
 * 3D の角度は RepMetrics.angle3dBottom（最下点）、2D は今のコードの minAngle。どちらも真値（本当の最小の内角）との差を見る。
 * 基準を満たさない条件は、無理に合わせず表（コンソール）に出して、テストでは「現状の値」を記録する。
 */
import { describe, expect, it } from 'vitest'
import { RepTracker } from './engine'
import { toAspectCorrected } from './geometry'
import { depthFromLength, lift3dAngle, lift3dSupported } from './lift3d'
import { makeScene } from './synthetic'
import type { SceneSpec } from './synthetic'
import { LM } from './types'

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}
const REPS = Array.from({ length: 5 }, () => ({ minAngle: 80, eccS: 1.0, conS: 0.7 }))

describe('lift3dAngle（純粋関数）', () => {
  it('depthFromLength：投影が骨の長さ以上なら 0', () => {
    expect(depthFromLength(0.3, 0.3)).toBe(0)
    expect(depthFromLength(0.4, 0.3)).toBe(0)
    expect(depthFromLength(0, 0.3)).toBeCloseTo(0.3, 9)
    expect(depthFromLength(0.18, 0.3)).toBeCloseTo(0.24, 9)
  })

  it('奥行きが無い（投影＝骨の長さ）なら 2D の角度と同じ', () => {
    // 頂点 (0,0)、近位 (0,-0.3)（真上）、遠位 (0.3,0)（真横）→ 90°
    const a = lift3dAngle({ x: 0, y: -0.3 }, { x: 0, y: 0 }, { x: 0.3, y: 0 }, { a: 0.3, b: 0.3 }, 1, 1)
    expect(a).toBeCloseTo(90, 6)
  })

  it('奥行きの符号：同じ向きに奥行きがあれば角度は小さく、逆向きなら大きくなる', () => {
    const p = { x: 0, y: -0.3 * Math.cos(0.5) }
    const v = { x: 0, y: 0 }
    const c = { x: 0.3 * Math.cos(0.5), y: 0 }
    const lens = { a: 0.3, b: 0.3 }
    const same = lift3dAngle(p, v, c, lens, 1, 1) as number
    const opp = lift3dAngle(p, v, c, lens, 1, -1) as number
    expect(same).toBeLessThan(90)
    expect(opp).toBeGreaterThan(90)
    // 符号が両方反転しても同じ（z の向きの決まりは結果に影響しない）
    expect(lift3dAngle(p, v, c, lens, -1, -1)).toBeCloseTo(same, 9)
  })

  it('長さが不正・z が NaN なら undefined', () => {
    const o = { x: 0, y: 0 }
    expect(lift3dAngle(o, { x: 0, y: 1 }, o, { a: 0, b: 0.3 }, 1, 1)).toBeUndefined()
    expect(lift3dAngle({ x: 1, y: 1 }, o, { x: 1, y: 0 }, { a: 1, b: 1 }, NaN, 1)).toBeUndefined()
  })

  it('対象の種目：脚・腕の主関節の種目だけ（rdl・lateral は対象外）', () => {
    expect(lift3dSupported('squat')).toBe(true)
    expect(lift3dSupported('bench')).toBe(true)
    expect(lift3dSupported('rdl')).toBe(false)
    expect(lift3dSupported('lateral')).toBe(false)
  })
})

interface Cond {
  yaw: number
  toeOut?: number
  /** 立位の骨の長さに掛ける倍率（骨の長さのずれ） */
  lenScale?: number
  worldCollapse?: 'flat' | 'noisy'
  lift3d?: boolean
}

/** 1条件を 10 セット（50 レップ）測る。2D（今の minAngle）と 3D（angle3dBottom）の誤差（計測 − 真値） */
function run(c: Cond, sets = 10) {
  const e2: number[] = []
  const e3: number[] = []
  let undef3 = 0
  let reps = 0
  for (let s = 0; s < sets; s++) {
    const spec: SceneSpec = {
      exercise: 'squat', reps: REPS, camera: { yawDeg: c.yaw }, toeOutDeg: c.toeOut ?? 0,
      worldCollapse: c.worldCollapse, seed: 100 + s,
    }
    const sc = makeScene(spec)
    // 立位（最初の 0.9 秒。膝 175°・すね鉛直）の手前（左）の太もも・すねの画面上の長さの中央値＝立位の骨の長さ
    const a: number[] = []
    const b: number[] = []
    for (const f of sc.frames) {
      if (f.t > 900 || !f.pose) continue
      const p = toAspectCorrected(f.pose, sc.aspect)
      a.push(Math.hypot(p[LM.leftHip].x - p[LM.leftKnee].x, p[LM.leftHip].y - p[LM.leftKnee].y))
      b.push(Math.hypot(p[LM.leftKnee].x - p[LM.leftAnkle].x, p[LM.leftKnee].y - p[LM.leftAnkle].y))
    }
    const k = c.lenScale ?? 1
    const tr = new RepTracker('squat')
    tr.setRefLengths(median(a) * k, median(b) * k)
    tr.setLift3d(c.lift3d ?? true)
    for (const f of sc.frames) tr.push(f.pose ? toAspectCorrected(f.pose, sc.aspect) : undefined, f.t, f.world)
    const out = tr.flush()
    out.forEach((r, i) => {
      const truth = sc.truth[i]?.minAngle
      if (truth === undefined) return
      reps++
      e2.push(r.minAngle - truth)
      const a3 = r.metrics?.angle3dBottom
      if (a3 === undefined) undef3++
      else e3.push(a3 - truth)
    })
  }
  return { mae2: mean(e2.map(Math.abs)), mae3: e3.length ? mean(e3.map(Math.abs)) : NaN, bias2: mean(e2), bias3: e3.length ? mean(e3) : NaN, undef3, reps }
}

describe('3D 角度の採用の基準（仕様 4.4 の 3回目）', () => {
  const rows: string[] = []
  const log = (name: string, r: ReturnType<typeof run>) =>
    rows.push(`${name.padEnd(28)} 2D ${r.mae2.toFixed(1)}°  3D ${r.mae3.toFixed(1)}°  (偏り 2D ${r.bias2.toFixed(1)} / 3D ${r.bias3.toFixed(1)}  3D 無し ${r.undef3}/${r.reps})`)

  const table: Record<string, ReturnType<typeof run>> = {}
  for (const toe of [0, 20]) {
    for (const yaw of [0, 15, 30, 45]) {
      for (const sc of [1, 0.95, 1.05]) {
        if (sc !== 1 && toe !== 0) continue
        const name = `φ${yaw} つま先${toe} 骨${sc === 1 ? '±0' : sc < 1 ? '-5%' : '+5%'}`
        table[name] = run({ yaw, toeOut: toe, lenScale: sc })
        log(name, table[name])
      }
    }
  }

  it('結果の表（コンソールに出す）', () => {
    console.info('\n' + rows.join('\n'))
    expect(rows.length).toBeGreaterThan(0)
  })

  it('3D が出ないのは world が不信と判定されたレップだけ（φ15 以下では全レップで出る）', () => {
    for (const [name, r] of Object.entries(table)) if (/^φ(0|15) /.test(name)) expect(r.undef3).toBe(0)
  })

  it('真横（φ0）：3D は 2D より 0.3° 以上悪くならない（つま先 0。基準 1）', () => {
    const r = table['φ0 つま先0 骨±0']
    expect(r.mae3).toBeLessThanOrEqual(r.mae2 + 0.3)
  })

  // 以下は基準に合わせて調整していない「現状の記録」。基準 2（φ30 で 2D の 50% 以下、骨の長さ ±5% で 2D を超えない）は
  // 満たさない条件があり（報告のとおり）、採用はメインが決める。値が大きく変わったら気づけるよう、範囲で押さえる。
  it('φ30°（骨の長さが正確）：3D は 2D より小さい。ただし 2D の 50% 以下には届かない（現状）', () => {
    const r = table['φ30 つま先0 骨±0']
    expect(r.mae3).toBeLessThan(r.mae2)
    expect(r.mae3 / r.mae2).toBeGreaterThan(0.5)
  })

  it('斜めが大きい（φ45、つま先 20°）：骨の長さが正確なら 3D は 2D より大きく小さい', () => {
    for (const n of ['φ45 つま先0 骨±0', 'φ30 つま先20 骨±0', 'φ45 つま先20 骨±0']) {
      expect(table[n].mae3).toBeLessThan(table[n].mae2 * 0.5)
    }
  })

  it('骨の長さを ±5% ずらしたとき：骨が短いと見積もる側（-5%）は φ30° で 2D より悪くなる（現状）', () => {
    expect(table['φ30 つま先0 骨+5%'].mae3).toBeLessThanOrEqual(table['φ30 つま先0 骨+5%'].mae2)
    expect(table['φ30 つま先0 骨-5%'].mae3).toBeGreaterThan(table['φ30 つま先0 骨-5%'].mae2)
  })

  it('world が不信（z が潰れる・ノイズが大きい）のとき 3D は出さない（undefined）', () => {
    for (const wc of ['flat', 'noisy'] as const) {
      const r = run({ yaw: 30, worldCollapse: wc })
      expect(r.undef3).toBe(r.reps)
    }
  })

  it('オフ（既定）なら計算しない：angle3dBottom は付かない', () => {
    const sc = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 30 }, seed: 1 })
    const tr = new RepTracker('squat')
    tr.setRefLengths(0.2, 0.2)
    for (const f of sc.frames) tr.push(f.pose ? toAspectCorrected(f.pose, sc.aspect) : undefined, f.t, f.world)
    const out = tr.flush()
    expect(out.length).toBeGreaterThan(0)
    for (const r of out) expect(r.metrics?.angle3dBottom).toBeUndefined()
  })

  it('立位の骨の長さが無ければ 3D は出さない（オンでも）', () => {
    const sc = makeScene({ exercise: 'squat', reps: REPS, camera: { yawDeg: 30 }, seed: 1 })
    const tr = new RepTracker('squat')
    tr.setLift3d(true)
    for (const f of sc.frames) tr.push(f.pose ? toAspectCorrected(f.pose, sc.aspect) : undefined, f.t, f.world)
    for (const r of tr.flush()) expect(r.metrics?.angle3dBottom).toBeUndefined()
  })
})
