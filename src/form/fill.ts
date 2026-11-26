/**
 * 見えなかったコマの補間、平滑化、外れ値の判定（純粋関数。まだ本体からは呼ばない）。
 * 仕様：form3d-spec.md の 3.2・3.3・3.8。
 *
 * 数値の区別：
 * - 【論文】埋める欠けの最大長 G をあらかじめ決め、それを超える欠けは埋めない（PMC12744387 refineDLC、本文。例：G=5 コマ≈30fps で 0.17 秒）。
 * - 【設計値・暫定】6 コマ／0.2 秒、傾きを求める 3 コマ、外れ値の倍率、可動域の下限、平滑化の窓。
 *   欠けの大きさと誤差の関係は仕様 2.2 の【計算】（余弦状の動き、30fps）に基づく。論文の値ではない。
 */

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
