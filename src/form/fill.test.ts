import { describe, expect, it } from 'vitest'
import { RepTracker } from './engine'
import {
  FILL_MAX_FRAMES, OUTLIER_LENGTH_RATIO, fillGaps, findSpikes, isAngleOutOfRange, isOutlierLength, isSpike, savgol, savgolWindowFor,
} from './fill'
import { jointAngle, toAspectCorrected } from './geometry'
import { makeScene } from './synthetic'
import type { Scene, SceneSpec } from './synthetic'
import { LM } from './types'

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
const FPS = 30
const times = (n: number, fps = FPS) => Array.from({ length: n }, (_, i) => (i * 1000) / fps)

describe('fillGaps（短い欠けの補間）', () => {
  it('欠けが無ければそのまま。出どころはすべて measured', () => {
    const r = fillGaps([1, 2, 3, 4], times(4))
    expect(r.values).toEqual([1, 2, 3, 4])
    expect(r.source).toEqual(['measured', 'measured', 'measured', 'measured'])
  })

  it('直線の動きなら、3 コマ・6 コマの欠けを正確に埋め、interpolated の印を付ける', () => {
    for (const n of [3, 6]) {
      const series: (number | undefined)[] = Array.from({ length: 30 }, (_, i) => 100 - 2 * i)
      for (let k = 10; k < 10 + n; k++) series[k] = undefined
      const r = fillGaps(series, times(30))
      for (let k = 10; k < 10 + n; k++) {
        expect(r.values[k]).toBeCloseTo(100 - 2 * k, 6)
        expect(r.source[k]).toBe('interpolated')
      }
      expect(r.source[9]).toBe('measured')
      expect(r.source[10 + n]).toBe('measured')
    }
  })

  it('NaN・Infinity も欠けとして扱う', () => {
    const r = fillGaps([1, 2, NaN, 4, 5, 6, 7, Infinity, 9, 10], times(10))
    expect(r.source[2]).toBe('interpolated')
    expect(r.source[7]).toBe('interpolated')
    expect(r.values[2]).toBeCloseTo(3, 6)
  })

  it('6 コマを超える欠け（7・10 コマ）は埋めず、missing のまま印を付ける', () => {
    for (const n of [7, 10]) {
      const series: (number | undefined)[] = Array.from({ length: 40 }, (_, i) => i)
      for (let k = 10; k < 10 + n; k++) series[k] = undefined
      const r = fillGaps(series, times(40))
      for (let k = 10; k < 10 + n; k++) {
        expect(r.values[k]).toBeUndefined()
        expect(r.source[k]).toBe('missing')
      }
    }
    expect(FILL_MAX_FRAMES).toBe(6)
  })

  it('コマ数が 6 以下でも、0.2 秒を超えるなら埋めない（20fps の 6 コマ＝0.3 秒）。30fps の 6 コマ＝0.2 秒は埋める', () => {
    const mk = (n: number) => {
      const s: (number | undefined)[] = Array.from({ length: 30 }, (_, i) => i)
      for (let k = 10; k < 10 + n; k++) s[k] = undefined
      return s
    }
    expect(fillGaps(mk(6), times(30, 20)).source[10]).toBe('missing')
    expect(fillGaps(mk(4), times(30, 20)).source[10]).toBe('interpolated') // 4 コマ＝0.2 秒
    expect(fillGaps(mk(5), times(30, 20)).source[10]).toBe('missing') // 5 コマ＝0.25 秒
    expect(fillGaps(mk(6), times(30, 30)).source[10]).toBe('interpolated')
  })

  it('レップの最初・最後にかかる欠けは、短くても埋めない', () => {
    const r = fillGaps([undefined, undefined, 3, 4, 5, 6, undefined, undefined], times(8))
    expect(r.source).toEqual(['missing', 'missing', 'measured', 'measured', 'measured', 'measured', 'missing', 'missing'])
    expect(r.values[0]).toBeUndefined()
  })

  it('欠けが2か所あっても、それぞれ別に判定する（短い方だけ埋める）', () => {
    const s: (number | undefined)[] = Array.from({ length: 40 }, (_, i) => i)
    s[5] = undefined
    for (let k = 20; k < 28; k++) s[k] = undefined
    const r = fillGaps(s, times(40))
    expect(r.source[5]).toBe('interpolated')
    expect(r.source[22]).toBe('missing')
  })

  it('傾きのコマが取れない（前に 1 コマしかない）ときは、前後を結ぶ直線で埋める', () => {
    const r = fillGaps([10, undefined, undefined, 40, 50, 60], times(6))
    expect(r.values[1]).toBeCloseTo(20, 6)
    expect(r.values[2]).toBeCloseTo(30, 6)
  })

  it('入力の配列は書き換えない', () => {
    const s = [1, undefined, 3, 4]
    fillGaps(s, times(4))
    expect(s).toEqual([1, undefined, 3, 4])
  })
})

/** 仕様 2.2 の欠けの誤差：膝 175→80→175°（余弦状）、30fps。欠けの位置をずらした最大誤差（度）。ノイズなし */
function gapMaxError(ecc: number, con: number, n: number, opts: Parameters<typeof fillGaps>[2], linear = false): number {
  const ang = (i: number) => {
    const t = (i - 10) / FPS
    if (t < 0 || t > ecc + con) return 175
    if (t < ecc) return 175 - (95 * (1 - Math.cos((Math.PI * t) / ecc))) / 2
    return 80 + (95 * (1 - Math.cos((Math.PI * (t - ecc)) / con))) / 2
  }
  const total = Math.round((ecc + con) * FPS) + 20
  let worst = 0
  for (let k0 = 12; k0 < total - n - 12; k0++) {
    const s: (number | undefined)[] = Array.from({ length: total }, (_, i) => ang(i))
    for (let k = k0; k < k0 + n; k++) s[k] = undefined
    const r = fillGaps(s, times(total), opts)
    for (let k = k0; k < k0 + n; k++) {
      let v = r.values[k]
      if (linear) {
        const a = ang(k0 - 1)
        const b = ang(k0 + n)
        v = a + ((b - a) * (k - (k0 - 1))) / (n + 1)
      }
      if (v === undefined) return NaN
      worst = Math.max(worst, Math.abs(v - ang(k)))
    }
  }
  return worst
}

describe('欠けの補間の誤差（ノイズなしの余弦状の動き、最大誤差の度数）', () => {
  const big = { maxFrames: 20, maxMs: 1000 }
  it('3 次エルミートは線形補間より小さく、3 コマ（0.10 秒）では 1° 以内、ゆっくりなら 6 コマ（0.20 秒）も 1° 以内', () => {
    for (const [ecc, con] of [[1.0, 0.7], [2.0, 1.0]]) {
      for (const n of [3, 6]) {
        const h = gapMaxError(ecc, con, n, {})
        const l = gapMaxError(ecc, con, n, {}, true)
        expect(h).toBeLessThan(l)
      }
    }
    expect(gapMaxError(1.0, 0.7, 3, {})).toBeLessThanOrEqual(1.0)
    expect(gapMaxError(2.0, 1.0, 3, {})).toBeLessThanOrEqual(1.0)
    expect(gapMaxError(2.0, 1.0, 6, {})).toBeLessThanOrEqual(1.0)
  })

  it('速いレップの 6 コマは、傾きを 3 コマの直線で取ると 1.0° を少し超える（2 点の差分なら 1° 付近）：仕様 2.2 の計算との差の記録', () => {
    const three = gapMaxError(1.0, 0.7, 6, {})
    const two = gapMaxError(1.0, 0.7, 6, { slopeFrames: 2 })
    expect(three).toBeLessThan(2.0)
    expect(two).toBeLessThan(three)
    expect(two).toBeLessThan(1.1)
  })

  it('10 コマ（0.33 秒）は既定では埋めない。無理に埋めると誤差が大きい', () => {
    expect(gapMaxError(1.0, 0.7, 10, {})).toBeNaN()
    expect(gapMaxError(1.0, 0.7, 10, big)).toBeGreaterThan(1.5)
  })
})

describe('savgol（平滑化）', () => {
  it('定数・直線・2 次式はそのまま（窓 7・2 次）。両端も', () => {
    const lin = Array.from({ length: 20 }, (_, i) => 3 + 0.5 * i)
    const quad = Array.from({ length: 20 }, (_, i) => 0.1 * i * i - i + 4)
    expect(savgol(new Array<number>(20).fill(5))).toEqual(new Array<number>(20).fill(5))
    savgol(lin).forEach((v, i) => expect(v).toBeCloseTo(lin[i], 8))
    savgol(quad).forEach((v, i) => expect(v).toBeCloseTo(quad[i], 8))
  })

  it('ノイズを減らす（滑らかな信号＋ノイズの誤差が小さくなる）', () => {
    let seed = 1
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5 }
    const clean = Array.from({ length: 90 }, (_, i) => 100 + 40 * Math.sin(i / 14))
    const noisy = clean.map(v => v + 4 * rnd())
    const sm = savgol(noisy)
    const err = (a: number[]) => mean(a.map((v, i) => Math.abs(v - clean[i])))
    expect(err(sm)).toBeLessThan(err(noisy) * 0.8)
  })

  it('窓がデータより長いとき・短いデータ・NaN を含むとき壊れない。入力は書き換えない', () => {
    expect(savgol([1, 2, 3])).toHaveLength(3)
    expect(savgol([1, 2])).toEqual([1, 2])
    expect(savgol([])).toEqual([])
    const s = [1, 2, NaN, 4, 5, 6, 7, 8, 9]
    const r = savgol(s)
    expect(Number.isNaN(r[2])).toBe(true)
    expect(Number.isFinite(r[3])).toBe(true)
    expect(Number.isNaN(s[2])).toBe(true)
  })

  it('窓は fps が 20 未満なら 5、それ以外は 7', () => {
    expect(savgolWindowFor(30)).toBe(7)
    expect(savgolWindowFor(20)).toBe(7)
    expect(savgolWindowFor(15)).toBe(5)
  })
})

describe('外れ値の判定', () => {
  it('画面上の長さが立位の 1.15 倍を超えたら外れ値', () => {
    expect(OUTLIER_LENGTH_RATIO).toBe(1.15)
    expect(isOutlierLength(0.3, 0.26)).toBe(true)
    expect(isOutlierLength(0.29, 0.26)).toBe(false)
    expect(isOutlierLength(0.5, 0)).toBe(false)
  })

  it('膝の内角 25° 未満・肘の内角 20° 未満は可動域の外', () => {
    expect(isAngleOutOfRange('knee', 24)).toBe(true)
    expect(isAngleOutOfRange('knee', 25)).toBe(false)
    expect(isAngleOutOfRange('elbow', 19)).toBe(true)
    expect(isAngleOutOfRange('elbow', 20)).toBe(false)
  })

  it('1コマの飛び：行って戻るときだけ。ずっと動いたとき・ゆっくり動いたときは外れ値にしない', () => {
    const L = 0.2
    expect(isSpike({ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.01, y: 0 }, L)).toBe(true)
    expect(isSpike({ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.6, y: 0 }, L)).toBe(false) // 飛んだまま（戻らない）
    expect(isSpike({ x: 0, y: 0 }, { x: 0.05, y: 0 }, { x: 0.1, y: 0 }, L)).toBe(false) // 速い通常の動き
    expect(isSpike({ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0, y: 0 }, 0)).toBe(false)
  })

  it('findSpikes：両隣が measured のコマだけを判定する', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0, y: 0 }, undefined, { x: 0.4, y: 0 }, { x: 0, y: 0 }]
    expect(findSpikes(pts, 0.2)).toEqual([false, false, true, false, false, false, false])
  })
})

// ---------------------------------------------------------------------------
// 作った姿勢データでの試験（仕様 4.4 の 2 回目の採用の基準のうち、1 回目で測れるもの）
// ---------------------------------------------------------------------------

const REPS = Array.from({ length: 5 }, () => ({ minAngle: 80, eccS: 1.0, conS: 0.7 }))
const median3 = (a: (number | undefined)[]) =>
  a.map((v, i) => {
    if (v === undefined) return undefined
    const w = [a[i - 1], v, a[i + 1]].filter((x): x is number => x !== undefined).sort((p, q) => p - q)
    return w[w.length >> 1]
  })

interface Pipeline {
  /** レップごとの最小角度の推定 */
  minAngles: number[]
  /** コマごとの、膝の出どころ */
  kneeSource: string[]
  spikeFlagged: boolean[][]
}

/**
 * 補間の試験用の流れ（本体の流れの試作）：手前の股関節・膝・足首の x,y から、見えないコマ（visibility<0.5・pose なし）と
 * 外れ値（removeSpikes のとき）を欠けにして、fillGaps で埋め、角度を計算 → 3 コマの中央値フィルタ（RepTracker と同じ） →
 * 真値のレップの範囲（前後 0.1 秒）の最小。
 */
function pipeline(sc: Scene, opts: { removeSpikes?: boolean }): Pipeline {
  const P = sc.frames.map(f => (f.pose ? toAspectCorrected(f.pose, sc.aspect) : undefined))
  const ts = sc.frames.map(f => f.t)
  const idx = [LM.leftHip, LM.leftKnee, LM.leftAnkle]
  // 立位の太もも（最初の 0.5 秒の中央値）。外れ値の判定の L
  const stand = P.slice(0, 15).map(p => (p ? Math.hypot(p[LM.leftHip].x - p[LM.leftKnee].x, p[LM.leftHip].y - p[LM.leftKnee].y) : NaN)).sort((a, b) => a - b)
  const L = stand[stand.length >> 1]
  const spikeFlagged: boolean[][] = []
  const filled = idx.map(lm => {
    const pts = P.map(p => (p && (p[lm].visibility ?? 0) >= 0.5 ? { x: p[lm].x, y: p[lm].y } : undefined))
    const sp = opts.removeSpikes ? findSpikes(pts, L) : pts.map(() => false)
    spikeFlagged.push(sp)
    const xs = pts.map((p, i) => (p && !sp[i] ? p.x : undefined))
    const ys = pts.map((p, i) => (p && !sp[i] ? p.y : undefined))
    return { x: fillGaps(xs, ts), y: fillGaps(ys, ts) }
  })
  const raw = P.map((_, i) => {
    const [h, k, a] = filled
    const get = (f: (typeof filled)[number]) => (f.x.values[i] !== undefined && f.y.values[i] !== undefined ? { x: f.x.values[i] as number, y: f.y.values[i] as number } : undefined)
    const ph = get(h), pk = get(k), pa = get(a)
    return ph && pk && pa ? jointAngle(ph, pk, pa) : undefined
  })
  const ang = median3(raw)
  const minAngles = sc.truth.map(tr => {
    const w = ang.filter((v, i): v is number => v !== undefined && ts[i] >= tr.startT - 100 && ts[i] <= tr.endT + 100)
    return Math.min(...w)
  })
  return { minAngles, kneeSource: filled[1].x.source, spikeFlagged }
}

/** 隠れ：レップごとに、最下点を中心に n コマ（shift コマずらす）の膝の lowVis */
function occlusionsAt(base: Scene, n: number, shift: number) {
  return base.truth.map(tr => {
    const k0 = Math.round((tr.minT * FPS) / 1000) - Math.floor(n / 2) + shift
    return { joint: 'knee' as const, side: 'near' as const, startS: k0 / FPS - 1e-6, durS: n / FPS - 1e-6, mode: 'lowVis' as const }
  })
}

const SETS = 10
function mae(spec: Omit<SceneSpec, 'seed'>, n: number, shift: number, mode: 'fill' | 'tracker', seed0 = 200) {
  const errs: number[] = []
  for (let s = 0; s < SETS; s++) {
    const base = makeScene({ ...spec, seed: seed0 + s })
    const sc = n > 0 ? makeScene({ ...spec, seed: seed0 + s, occlusions: occlusionsAt(base, n, shift) }) : base
    if (mode === 'tracker') {
      const tr = new RepTracker('squat')
      for (const f of sc.frames) tr.push(f.pose ? toAspectCorrected(f.pose, sc.aspect) : undefined, f.t, f.world)
      const r = tr.flush()
      expect(r).toHaveLength(5)
      r.forEach((x, i) => errs.push(Math.abs(x.minAngle - sc.truth[i].minAngle)))
    } else {
      pipeline(sc, {}).minAngles.forEach((v, i) => errs.push(Math.abs(v - sc.truth[i].minAngle)))
    }
  }
  return mean(errs)
}

describe('作った姿勢データでの補間の誤差（採用の基準 2・3：真横 φ=0、50 レップ、真値 80°）', () => {
  const spec = { exercise: 'squat' as const, reps: REPS, camera: { yawDeg: 0 } }
  const none = mae(spec, 0, 0, 'fill')

  it('欠け 3・6 コマ（最下点を含む）：誤差は「欠けなし＋1.0°」以内で、今のコード（そのコマを捨てる）より小さい（6 コマ）', () => {
    for (const n of [3, 6]) {
      expect(mae(spec, n, 0, 'fill')).toBeLessThanOrEqual(none + 1.0)
    }
    expect(mae(spec, 6, 0, 'fill')).toBeLessThan(mae(spec, 6, 0, 'tracker'))
  })

  it('欠け 3・6 コマ（最下点を外す）：誤差は「欠けなし＋1.0°」以内', () => {
    for (const n of [3, 6]) {
      expect(mae(spec, n, -12, 'fill')).toBeLessThanOrEqual(none + 1.0)
    }
  })

  it('回数：今のコード（欠けたコマを捨てる）でも 5 レップを数える（mae の中で全セット 5 回を確かめている）。補間は回数の数え方を変えない', () => {
    for (const n of [3, 6, 10]) expect(mae(spec, n, 0, 'tracker')).toBeGreaterThan(0)
  })

  it('欠け 10 コマ：埋めない（missing の印）。最下点がその欠けに入っていることが分かる', () => {
    const base = makeScene({ ...spec, seed: 200 })
    const sc = makeScene({ ...spec, seed: 200, occlusions: occlusionsAt(base, 10, 0) })
    const p = pipeline(sc, {})
    for (const tr of sc.truth) {
      const i = Math.round((tr.minT * FPS) / 1000)
      expect(p.kneeSource[i]).toBe('missing')
    }
    expect(p.kneeSource.filter(s => s === 'interpolated')).toHaveLength(0)
    // 欠けた 10 コマは全部 missing
    expect(p.kneeSource.filter(s => s === 'missing')).toHaveLength(50)
  })

  it('欠け 6 コマ：補ったコマには interpolated の印が付く（6 コマ × 5 レップ）', () => {
    const base = makeScene({ ...spec, seed: 200 })
    const sc = makeScene({ ...spec, seed: 200, occlusions: occlusionsAt(base, 6, 0) })
    const p = pipeline(sc, {})
    expect(p.kneeSource.filter(s => s === 'interpolated')).toHaveLength(30)
    expect(p.kneeSource.filter(s => s === 'missing')).toHaveLength(0)
  })

  it('missing（コマごと pose なし）3 コマも同じように埋められる', () => {
    const base = makeScene({ ...spec, seed: 201 })
    const occ = base.truth.map(tr => {
      const k0 = Math.round((tr.minT * FPS) / 1000) - 1
      return { joint: 'knee' as const, side: 'near' as const, startS: k0 / FPS - 1e-6, durS: 3 / FPS - 1e-6, mode: 'missing' as const }
    })
    const sc = makeScene({ ...spec, seed: 201, occlusions: occ })
    expect(sc.frames.filter(f => !f.pose)).toHaveLength(15)
    const p = pipeline(sc, {})
    expect(p.kneeSource.filter(s => s === 'interpolated')).toHaveLength(15)
  })
})

describe('作った姿勢データでの外れ値の除去（採用の基準 4：外れ値 5%）', () => {
  const spec = { exercise: 'squat' as const, reps: REPS, camera: { yawDeg: 0 } }

  it('入れた飛びを見つけ（見逃し 2% 以下）、普通のコマを外れ値にしない（誤検出 0）', () => {
    let tp = 0, fn = 0, fp = 0
    for (let s = 0; s < 20; s++) {
      const sc = makeScene({ ...spec, seed: 300 + s, spikeRate: 0.05 })
      const flags = pipeline(sc, { removeSpikes: true }).spikeFlagged
      const lms = [LM.leftHip, LM.leftKnee, LM.leftAnkle]
      const truth = new Set(sc.spikes.map(x => `${x.frame}:${x.landmark}`))
      lms.forEach((lm, j) => flags[j].forEach((b, i) => {
        const t = truth.has(`${i}:${lm}`)
        if (b && t) tp++
        else if (b) fp++
        else if (t) fn++
      }))
    }
    expect(tp + fn).toBeGreaterThan(50)
    expect(fn / (tp + fn)).toBeLessThanOrEqual(0.02)
    expect(fp).toBe(0)
  })

  it('外れ値を除いて埋めた最小角度の誤差は、「外れ値なし＋0.5°」以内', () => {
    const err = (rate: number, remove: boolean) => {
      const e: number[] = []
      for (let s = 0; s < SETS; s++) {
        const sc = makeScene({ ...spec, seed: 300 + s, spikeRate: rate })
        pipeline(sc, { removeSpikes: remove }).minAngles.forEach((v, i) => e.push(Math.abs(v - sc.truth[i].minAngle)))
      }
      return mean(e)
    }
    expect(err(0.05, true)).toBeLessThanOrEqual(err(0, false) + 0.5)
  })
})
