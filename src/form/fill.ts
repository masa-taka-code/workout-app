/**
 * 見えなかったコマの補間、平滑化、外れ値の判定（純粋関数。まだ本体からは呼ばない）。
 * 仕様：form3d-spec.md の 3.2・3.3・3.8。
 *
 * 数値の区別：
 * - 【論文】埋める欠けの最大長 G をあらかじめ決め、それを超える欠けは埋めない（PMC12744387 refineDLC、本文。例：G=5 コマ≈30fps で 0.17 秒）。
 * - 【設計値・暫定】6 コマ／0.2 秒、傾きを求める 3 コマ、外れ値の倍率、可動域の下限、平滑化の窓。
 *   欠けの大きさと誤差の関係は仕様 2.2 の【計算】（余弦状の動き、30fps）に基づく。論文の値ではない。
 */

import type { FormExerciseKey, JointSource, Landmark, Pose } from './types'
import { CONFIG, MAIN_JOINTS, MIN_VISIBILITY, SIDE_INDEX, computeAngles, computeMainAngle } from './rules'
import type { Joint, Side } from './rules'
import type { MeasureFrame } from './measure'

/** 補間の最大の欠け（コマ数）。【設計値・暫定】 */
export const FILL_MAX_FRAMES = 6
/** 補間の最大の欠け（ミリ秒）。【設計値・暫定】 */
export const FILL_MAX_MS = 200
/** 傾きを求めるときに使う、欠けの前後それぞれの measured のコマ数（最大）。【設計値・暫定】 */
export const SLOPE_FRAMES = 3
/** 画面上の骨の長さが立位の長さのこの倍を超えたら外れ値。遠近の効果（距離 2.5m・奥行き差 ±0.3m で約 ±12%）を見込む。【設計値・暫定】 */
export const OUTLIER_LENGTH_RATIO = 1.15
/** 1コマの飛び：骨の長さに対するこの倍を超えて動き、次のコマで戻る。【設計値・暫定】 */
export const SPIKE_RATIO = 0.5
/** 膝・肘の内角の下限（度）。これ未満は左右の取り違えなどによる外れ値。【設計値・暫定】 */
export const MIN_KNEE_ANGLE = 25
export const MIN_ELBOW_ANGLE = 20
/** 平滑化の窓（30fps のとき 7、20fps 未満のとき 5）と次数。【設計値・暫定】 */
export const SAVGOL_WINDOW = 7
export const SAVGOL_WINDOW_SLOW = 5
export const SAVGOL_ORDER = 2

export type GapSource = 'measured' | 'interpolated' | 'missing'

export interface FillOptions {
  maxFrames?: number
  maxMs?: number
  /**
   * 傾きを求めるコマ数（既定 SLOPE_FRAMES＝3。仕様 3.3）。2 にすると前後の隣り合う 2 点の差分になる
   * （仕様 2.2 の計算 gap.py はこの 2 点の差分で求めた値。比べるための選択肢で、既定は変えない）
   */
  slopeFrames?: number
}

export interface FillResult {
  /** 補間後の値。埋めなかった欠けは undefined */
  values: (number | undefined)[]
  /** コマごとの出どころ（補間したコマは 'interpolated'、埋めなかった欠けは 'missing'） */
  source: GapSource[]
}

const isNum = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** 最小二乗の直線の傾き（単位：値/秒）。点が2つ未満、時間が同じなら undefined */
function lineSlope(ts: number[], vs: number[]): number | undefined {
  const n = ts.length
  if (n < 2) return undefined
  const mt = ts.reduce((s, x) => s + x, 0) / n
  const mv = vs.reduce((s, x) => s + x, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (ts[i] - mt) * (vs[i] - mv)
    den += (ts[i] - mt) ** 2
  }
  return den > 0 ? num / den : undefined
}

/**
 * 短い欠け（undefined または有限でない値）を 3 次エルミート補間で埋める。
 * - 欠けが maxFrames コマ以下、かつ maxMs ミリ秒以下（両方）で、前後に measured のコマがあるときだけ埋める。
 *   欠けの長さ（時間）は「欠けたコマ数 × コマの間隔」（前後の measured のコマの間隔を欠けた数＋1 で割ったもの）。
 * - レップの最初・最後にかかる欠け（片側に measured が無い）と、それより長い欠けは埋めずに 'missing' のまま残す。
 * - 傾きは、前後それぞれ最大 SLOPE_FRAMES コマの measured のコマ（欠けに隣り合う連続したコマ）の直線のあてはめで求める。
 *   1コマしか取れないときは、前後の measured のコマを結ぶ直線の傾きを使う。
 * 時間 times はミリ秒で、series と同じ長さ。
 */
export function fillGaps(series: (number | undefined)[], times: number[], opts: FillOptions = {}): FillResult {
  const maxFrames = opts.maxFrames ?? FILL_MAX_FRAMES
  const maxMs = opts.maxMs ?? FILL_MAX_MS
  const slopeN = Math.max(2, opts.slopeFrames ?? SLOPE_FRAMES)
  const n = series.length
  const values: (number | undefined)[] = series.map(v => (isNum(v) ? v : undefined))
  const source: GapSource[] = values.map(v => (v === undefined ? 'missing' : 'measured'))
  let i = 0
  while (i < n) {
    if (isNum(series[i])) { i++; continue }
    // 連続する欠けを i..j とする
    let j = i
    while (j + 1 < n && !isNum(series[j + 1])) j++
    const count = j - i + 1
    const prev = i - 1
    const next = j + 1
    if (prev >= 0 && next < n) {
      const span = times[next] - times[prev]
      const durMs = (span * count) / (count + 1)
      if (count <= maxFrames && durMs <= maxMs + 1e-6) {
        // 傾き：欠けの前後それぞれ最大 SLOPE_FRAMES コマ（連続した measured のコマ）
        const bt: number[] = []
        const bv: number[] = []
        for (let k = prev; k >= 0 && bt.length < slopeN && isNum(series[k]); k--) { bt.push(times[k] / 1000); bv.push(series[k] as number) }
        const at: number[] = []
        const av: number[] = []
        for (let k = next; k < n && at.length < slopeN && isNum(series[k]); k++) { at.push(times[k] / 1000); av.push(series[k] as number) }
        const t0 = times[prev] / 1000
        const t1 = times[next] / 1000
        const y0 = series[prev] as number
        const y1 = series[next] as number
        const secant = (y1 - y0) / (t1 - t0)
        const m0 = lineSlope(bt, bv) ?? secant
        const m1 = lineSlope(at, av) ?? secant
        const h = t1 - t0
        for (let k = i; k <= j; k++) {
          const s = (times[k] / 1000 - t0) / h
          const s2 = s * s
          const s3 = s2 * s
          values[k] = (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * y1 + (s3 - s2) * h * m1
          source[k] = 'interpolated'
        }
      }
    }
    i = j + 1
  }
  return { values, source }
}

/** 小さな連立方程式（ガウスの消去法）。解けなければ undefined */
function solve(a: number[][], b: number[]): number[] | undefined {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r
    if (Math.abs(m[piv][c]) < 1e-12) return undefined
    ;[m[c], m[piv]] = [m[piv], m[c]]
    for (let r = c + 1; r < n; r++) {
      const k = m[r][c] / m[c][c]
      for (let q = c; q <= n; q++) m[r][q] -= k * m[c][q]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n]
    for (let q = r + 1; q < n; q++) s -= m[r][q] * x[q]
    x[r] = s / m[r][r]
  }
  return x
}

/**
 * Savitzky–Golay 法による平滑化（窓 window コマ、order 次の多項式のあてはめ）。コマの間隔は一定と仮定する。
 * 前後のコマを使うので遅れはない。両端は、窓を内側へずらしてあてはめる。
 * 有限でない値は使わず、そのコマはそのまま返す。窓がデータより長いときはデータ長以下の最大の奇数にする。
 */
export function savgol(series: number[], window = SAVGOL_WINDOW, order = SAVGOL_ORDER): number[] {
  const n = series.length
  let w = window % 2 === 0 ? window - 1 : window
  if (w > n) w = n % 2 === 0 ? n - 1 : n
  if (w < order + 1) return [...series]
  const half = (w - 1) / 2
  const out = [...series]
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(series[i])) continue
    const start = Math.min(Math.max(i - half, 0), n - w)
    const xs: number[] = []
    const ys: number[] = []
    for (let k = start; k < start + w; k++) {
      if (Number.isFinite(series[k])) { xs.push(k - i); ys.push(series[k]) }
    }
    if (xs.length < order + 1) continue
    // 正規方程式 (XᵀX) c = Xᵀy。x を i からの差にしたので、i の値は c[0]
    const m = order + 1
    const A: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0))
    const B = new Array<number>(m).fill(0)
    for (let q = 0; q < xs.length; q++) {
      for (let r = 0; r < m; r++) {
        B[r] += ys[q] * xs[q] ** r
        for (let c = 0; c < m; c++) A[r][c] += xs[q] ** (r + c)
      }
    }
    const coef = solve(A, B)
    if (coef) out[i] = coef[0]
  }
  return out
}

/** fps に応じた平滑化の窓（20fps 未満なら 5、それ以外は 7）。【設計値・暫定】 */
export function savgolWindowFor(fps: number): number {
  return fps < 20 ? SAVGOL_WINDOW_SLOW : SAVGOL_WINDOW
}

/** 画面上の骨の長さ l が、立位の長さ L の ratio 倍を超えたら外れ値（投影した長さは骨の長さを超えないはず） */
export function isOutlierLength(l: number, L: number, ratio = OUTLIER_LENGTH_RATIO): boolean {
  return L > 0 && l > L * ratio
}

/** 関節の内角が可動域の外か（膝 25° 未満、肘 20° 未満）。他の関節は判定しない */
export function isAngleOutOfRange(joint: 'knee' | 'elbow', deg: number): boolean {
  return deg < (joint === 'knee' ? MIN_KNEE_ANGLE : MIN_ELBOW_ANGLE)
}

export interface XY {
  x: number
  y: number
}

/**
 * 1コマだけの飛び：prev→cur と cur→next がどちらも骨の長さ L の ratio 倍を超え、prev と next は近い（ratio 倍以内）とき true。
 * 座標は縦横比をそろえたもの。
 */
export function isSpike(prev: XY, cur: XY, next: XY, L: number, ratio = SPIKE_RATIO): boolean {
  if (!(L > 0)) return false
  const lim = L * ratio
  const d = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y)
  return d(prev, cur) > lim && d(cur, next) > lim && d(prev, next) <= lim
}

/** 点の時系列（欠けは undefined）から、1コマの飛びのコマを探す。両隣が measured のコマだけを判定する */
export function findSpikes(points: (XY | undefined)[], L: number, ratio = SPIKE_RATIO): boolean[] {
  return points.map((p, i) => {
    const a = points[i - 1]
    const b = points[i + 1]
    return !!(p && a && b && isSpike(a, p, b, L, ratio))
  })
}

// ---------------------------------------------------------------------------
// レップ単位の補正（外れ値 → 短い欠けの補間 → 奥側での代用）。RepTracker の finishRep が、計測の前に呼ぶ。
// ---------------------------------------------------------------------------

/**
 * 両脚・両腕を同じように動かす種目（奥側での代用の対象。仕様 3.4）。
 * bss（片側ずつ）は対象外。curl は片腕ずつ（交互）のこともあるので対象外にした（仕様は curl を両方に書いていて矛盾）。lateral は正面撮影なので対象外。
 */
export const MIRROR_KEYS: readonly FormExerciseKey[] = ['squat', 'bench', 'rdl', 'ohp', 'pulldown', 'ohext']

export interface RefineOptions {
  /** 立位などで分かっている、画面上の骨の長さ（太もも／上腕、すね／前腕）。飛びの判定（SPIKE_RATIO×骨の長さ）に使う。無ければレップ内の中央値 */
  lens?: { a: number; b: number }
}

const medianNum = (xs: number[]): number | undefined => {
  if (xs.length === 0) return undefined
  const v = [...xs].sort((a, b) => a - b)
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
const farOf = (side: Side): Side => (side === 'left' ? 'right' : 'left')

/**
 * 1レップのコマ（RepTracker が溜めたもの）の、見えなかった関節を補う。元の配列は変えず、補ったコマだけ新しいオブジェクトにして返す。
 * 1. 飛び（前後のコマから大きく離れて戻る 1 コマ）を欠けにする（外れ値）。長さ・可動域の外れ値は RepTracker が push のときに欠けにしている。
 * 2. 関節ごとに、短い欠け（6 コマ以下かつ 0.2 秒以下）を fillGaps で補間する。補ったコマは 'interpolated'。
 * 3. それでも主関節が欠けているコマは、奥側の主関節がすべて見えていれば、その座標で代用する（'mirrored'。MIRROR_KEYS の種目だけ）。
 * 4. 主関節の 3 点が揃ったコマは角度を計算し直して visible にする。埋められなかった関節は 'missing' のまま残す。
 * 欠けが無ければ frames をそのまま返す。lateral は補正しない（左右の腕を使うため）。
 */
export function refineRep(key: FormExerciseKey, frames: MeasureFrame[], opts: RefineOptions = {}): MeasureFrame[] {
  if (key === 'lateral' || frames.length < 3) return frames
  const joints = CONFIG[key].joints
  const main = MAIN_JOINTS[key]
  const n = frames.length
  // このレップで使った側（いちばん多い側）
  const cnt = { left: 0, right: 0 }
  for (const f of frames) if (f.side) cnt[f.side]++
  if (cnt.left + cnt.right === 0) return frames
  const side: Side = cnt.left >= cnt.right ? 'left' : 'right'
  const times = frames.map(f => f.t)

  // 1. measured の印と座標
  const meas: Record<string, boolean[]> = {}
  const pos: Record<string, (Landmark | undefined)[]> = {}
  for (const j of joints) {
    meas[j] = frames.map(f => f.side === side && (f.src ? f.src[j] === 'measured' : !!f.pts?.[j]) && !!f.pts?.[j])
    pos[j] = frames.map((f, i) => (meas[j][i] ? f.pts?.[j] : undefined))
  }

  // 飛びの判定：骨の長さ L（立位の長さがあればそれ、無ければレップ内の中央値の小さい方）
  const L = opts.lens
    ? Math.min(opts.lens.a, opts.lens.b)
    : (() => {
        const a = medianNum(frames.map(f => f.segA).filter((v): v is number => v !== undefined))
        const b = medianNum(frames.map(f => f.segB).filter((v): v is number => v !== undefined))
        return a !== undefined && b !== undefined ? Math.min(a, b) : 0
      })()
  if (L > 0) {
    for (const j of joints) {
      const spikes = findSpikes(pos[j].map(p => (p ? { x: p.x, y: p.y } : undefined)), L)
      spikes.forEach((sp, i) => {
        if (sp) { meas[j][i] = false; pos[j][i] = undefined }
      })
    }
  }

  // 2. 関節ごとに補間（x と y は同じ欠けなので、同じコマが埋まる）
  const filled: Record<string, { x: (number | undefined)[]; y: (number | undefined)[]; source: GapSource[] }> = {}
  for (const j of joints) {
    const fx = fillGaps(pos[j].map(p => p?.x), times)
    const fy = fillGaps(pos[j].map(p => p?.y), times)
    filled[j] = { x: fx.values, y: fy.values, source: fx.source.map((sx, i) => (sx === 'interpolated' && fy.source[i] === 'interpolated' ? 'interpolated' : sx === 'measured' ? 'measured' : 'missing')) }
  }

  const farIdx = SIDE_INDEX[farOf(side)]
  const nearIdx = SIDE_INDEX[side]
  const out: MeasureFrame[] = new Array(n)
  let changed = false
  for (let i = 0; i < n; i++) {
    const f = frames[i]
    // 少数側（使った側と別の側）で主関節を実測したコマは、その側の角度をそのまま使う。
    // 主関節の角度は左右どちらでも同じ量を表すので、角度の系列としては使える（捨てると、側が入れ替わる種目で最下点が浅く出る）
    if (f.side && f.side !== side && f.visible && f.angle !== undefined && main.every(j => f.src?.[j] === 'measured' && !!f.pts?.[j])) {
      out[i] = f
      continue
    }
    // 補間した結果、主関節が揃うか
    const src: Partial<Record<Joint, JointSource>> = {}
    for (const j of joints) src[j] = filled[j].source[i]
    // 3. 奥側での代用：主関節のどれかが埋まらず、奥側の主関節がすべて見えているとき
    let mirror = false
    if (MIRROR_KEYS.includes(key) && f.pose && main.some(j => src[j] === 'missing')) {
      mirror = main.every(j => {
        const lm = f.pose?.[farIdx[j]]
        return !!lm && (lm.visibility ?? 0) >= MIN_VISIBILITY
      })
    }
    const orig = f.src
    const unchanged = !mirror && joints.every(j => src[j] === (orig?.[j] ?? (f.pts?.[j] ? 'measured' : 'missing')))
    if (unchanged) { out[i] = f; continue }
    changed = true

    const pts: Partial<Record<Joint, Landmark>> = {}
    const pose: Pose = f.pose ? [...f.pose] : (Array.from({ length: 33 }, () => undefined) as unknown as Pose)
    for (const j of joints) {
      if (mirror && main.includes(j)) {
        const lm = f.pose?.[farIdx[j]] as Landmark
        pts[j] = lm
        src[j] = 'mirrored'
      } else if (src[j] === 'measured') {
        pts[j] = f.pts?.[j]
      } else if (src[j] === 'interpolated') {
        // 補間した点。visibility は「見えている」ぎりぎりにして、他の計測が使えるようにする（推定の印は src に付いている）
        pts[j] = { x: filled[j].x[i] as number, y: filled[j].y[i] as number, z: 0, visibility: MIN_VISIBILITY }
      } else if (f.pose && (f.pose[farIdx[j]]?.visibility ?? 0) >= MIN_VISIBILITY && mirror) {
        // （代用したコマで、主関節以外が欠けているとき）奥側の同じ関節
        pts[j] = f.pose[farIdx[j]]
        src[j] = 'mirrored'
      }
      const p = pts[j]
      if (p) pose[nearIdx[j]] = p
    }
    const mainOk = main.every(j => !!pts[j])
    let angle: number | undefined
    let angles: Record<string, number> | undefined
    if (mainOk) {
      if (joints.every(j => !!pts[j])) {
        angles = computeAngles(key, pts as Record<Joint, Landmark>, pose)
        angle = angles[CONFIG[key].main]
      } else {
        angle = computeMainAngle(key, pts)
        if (angle !== undefined) angles = { [CONFIG[key].main]: angle }
      }
    }
    // 補ったコマの minVis：measured と mirrored の関節だけで見る（補間した点は推定の割合で別に下げる）
    let minVis = 1
    let any = false
    for (const j of joints) {
      if ((src[j] === 'measured' || src[j] === 'mirrored') && pts[j]) { minVis = Math.min(minVis, pts[j]?.visibility ?? 0); any = true }
    }
    out[i] = {
      ...f,
      side,
      visible: mainOk && angle !== undefined,
      pose: f.pose || mainOk ? pose : undefined,
      // world は補ったコマでは使わない（奥行きがあてにならないため）
      world: undefined,
      pts,
      angle,
      angles,
      minVis: any ? minVis : 0,
      segA: undefined,
      segB: undefined,
      worldLen: undefined,
      src,
    }
  }
  if (!changed) return frames
  // 補ったコマは生の角度（RepTracker の中央値フィルタを通っていない）なので、主関節の角度を出し直し、前後 1 コマを含む 3 コマの中央値にそろえる。
  // そうしないと、補ったコマのノイズが最小角度（最下点）に直接出て、実測のコマより深く出る
  const rawAng = out.map(f => (f.visible ? computeMainAngle(key, f.pts ?? {}) : undefined))
  const mainName = CONFIG[key].main
  return out.map((f, i) => {
    if (!f.visible) return f
    const win = [rawAng[i - 1], rawAng[i], rawAng[i + 1]].filter((v): v is number => v !== undefined)
    const m = medianNum(win)
    return m === undefined ? f : { ...f, angle: m, angles: { ...f.angles, [mainName]: m } }
  })
}
