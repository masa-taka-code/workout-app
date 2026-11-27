/**
 * 答え合わせ（B2 の最小版）：アプリが検出したレップ・最下点の角度を、ユーザーがコマ送りで確かめた正解と比べる。
 * 純粋な計算と、localStorage への保存（キー workout-app:answer-keys）だけを持つ。動画・関節の座標の時系列は保存しない。
 * 数値（一致の許容時間・上限件数・コマ送りの幅）はすべて設計値・暫定。
 * 比較で分かるのは「画面上（2D）での推定誤差」であり、実際の関節角度とのずれではない。
 */
import type { FormExerciseKey, ViewKind } from './types'
import { jointAngle } from './geometry'
import type { Pt } from './geometry'
import { CONFIG, MAIN_JOINTS } from './rules'
import type { Joint } from './rules'

/** レップの一致とみなす最下点の時刻の差（秒。設計値・暫定） */
export const MATCH_TOLERANCE_SEC = 0.5
/** 保存する最大件数（新しい順。設計値・暫定） */
export const MAX_ANSWER_KEYS = 200
/** コマ送りの幅（秒。1/30 秒。設計値・暫定） */
export const FRAME_STEP_SEC = 1 / 30
export const ANSWER_KEYS_STORAGE_KEY = 'workout-app:answer-keys'

/** アプリが検出した 1 レップ（時刻は秒） */
export interface AppRep {
  startT?: number
  bottomT: number
  endT?: number
  /** アプリの最下点の主関節角度（度） */
  angle?: number
}

/** 解析中に残す 1 コマ（t は秒）。angle は主関節の角度、pts は主関節 3 点（画像に対する 0〜1 の座標） */
export interface TraceFrame {
  t: number
  angle?: number
  pts?: Pt[]
}

/** 正解側の 1 レップ */
export interface TrueRep {
  bottomT: number
  /** ユーザーが置いた 3 点から出した角度（度）。置かなければ undefined */
  angle?: number
}

/** 保存する 1 レップ分の比較結果 */
export interface AnswerRepRow {
  appBottomT?: number
  trueBottomT?: number
  appAngle?: number
  trueAngle?: number
  matched: boolean
}

export interface AnswerKeyRecord {
  id: string
  date: string
  exerciseKey: FormExerciseKey
  view: ViewKind
  phiDeg?: number
  appReps: number
  trueReps: number
  reps: AnswerRepRow[]
}

// ---------------------------------------------------------------------------
// 角度（3 点）
// ---------------------------------------------------------------------------

/**
 * 角度を置ける種目の、3 点の関節名（頂点が真ん中）。lateral は 4 点で数える種目なので置かない（回数だけの答え合わせ）。
 * rules.ts の主関節の定義をそのまま使う
 */
export function angleJoints(key: FormExerciseKey): Joint[] | undefined {
  if (key === 'lateral') return undefined
  const js = MAIN_JOINTS[key]
  return js.length === 3 ? js : undefined
}

/** 主関節の角度の名前（engine の FrameResult.angles のキー） */
export function mainAngleName(key: FormExerciseKey): string {
  return CONFIG[key].main
}

/** 3 点から角度（度）。画像の縦横比（幅÷高さ）で x をそろえてから計算する */
export function angleFromPoints(pts: Pt[], aspect: number): number | undefined {
  if (pts.length !== 3) return undefined
  const k = aspect > 0 && Number.isFinite(aspect) ? aspect : 1
  const [a, b, c] = pts.map(p => ({ x: p.x * k, y: p.y }))
  return jointAngle(a, b, c)
}

// ---------------------------------------------------------------------------
// アプリのレップの時刻を、解析中の記録から出す
// ---------------------------------------------------------------------------

/**
 * セットの完了した順に、レップ ends[i]（確定した時刻、秒）の手前で主関節の角度が最小のコマを最下点とする。
 * 探す範囲は前のレップの確定の時刻から。ends が足りないレップ（flush で確定したもの）は、記録の最後までを探す。
 * 記録が空・角度が無いときは bottomT を出せないので、そのレップは省く（呼び出し側で数が減る）。
 */
export function deriveAppReps(
  minAngles: number[],
  ends: number[],
  trace: TraceFrame[],
  segmentStartT: number,
): AppRep[] {
  const out: AppRep[] = []
  let from = segmentStartT
  const lastT = trace.length > 0 ? trace[trace.length - 1].t : segmentStartT
  for (let i = 0; i < minAngles.length; i++) {
    const to = ends[i] ?? lastT
    let best: TraceFrame | undefined
    for (const f of trace) {
      if (f.t < from || f.t > to || f.angle === undefined) continue
      if (!best || (f.angle as number) < (best.angle as number)) best = f
    }
    if (best) out.push({ startT: from, bottomT: best.t, endT: to, angle: minAngles[i] })
    from = to
  }
  return out
}

/** 時刻 t にいちばん近いコマ（なければ undefined。maxGapSec を超えて離れていれば undefined） */
export function nearestFrame(trace: TraceFrame[], t: number, maxGapSec = 1): TraceFrame | undefined {
  let best: TraceFrame | undefined
  let bd = Infinity
  for (const f of trace) {
    const d = Math.abs(f.t - t)
    if (d < bd) { bd = d; best = f }
  }
  return best && bd <= maxGapSec ? best : undefined
}

// ---------------------------------------------------------------------------
// 評価
// ---------------------------------------------------------------------------

export interface MatchResult {
  /** [アプリの添字, 正解の添字] */
  pairs: [number, number][]
  unmatchedApp: number[]
  unmatchedTrue: number[]
}

/** 最下点の時刻の差が tol 以内のものを、差の小さい順に 1 対 1 で対応づける */
export function matchReps(appT: number[], trueT: number[], tol = MATCH_TOLERANCE_SEC): MatchResult {
  const cand: { a: number; b: number; d: number }[] = []
  appT.forEach((ta, a) => trueT.forEach((tb, b) => {
    const d = Math.abs(ta - tb)
    if (d <= tol) cand.push({ a, b, d })
  }))
  cand.sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b)
  const usedA = new Set<number>()
  const usedB = new Set<number>()
  const pairs: [number, number][] = []
  for (const c of cand) {
    if (usedA.has(c.a) || usedB.has(c.b)) continue
    usedA.add(c.a)
    usedB.add(c.b)
    pairs.push([c.a, c.b])
  }
  pairs.sort((x, y) => x[0] - y[0])
  return {
    pairs,
    unmatchedApp: appT.map((_, i) => i).filter(i => !usedA.has(i)),
    unmatchedTrue: trueT.map((_, i) => i).filter(i => !usedB.has(i)),
  }
}

export interface CountScore {
  appReps: number
  trueReps: number
  /** アプリ − 正解 */
  diff: number
  matched: number
  /** 誤検出（アプリにあって正解にない） */
  falsePositives: number
  /** 見逃し（正解にあってアプリにない） */
  misses: number
  /** 適合率＝一致 ÷ アプリの数。アプリが 0 なら undefined */
  precision?: number
  /** 再現率＝一致 ÷ 正解の数。正解が 0 なら undefined */
  recall?: number
  f1?: number
}

export function countScore(appCount: number, trueCount: number, matched: number): CountScore {
  const precision = appCount > 0 ? matched / appCount : undefined
  const recall = trueCount > 0 ? matched / trueCount : undefined
  let f1: number | undefined
  if (precision !== undefined && recall !== undefined) {
    f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  }
  return {
    appReps: appCount, trueReps: trueCount, diff: appCount - trueCount, matched,
    falsePositives: appCount - matched, misses: trueCount - matched, precision, recall, f1,
  }
}

export interface AngleStats {
  n: number
  /** 差の平均（アプリ − 正解） */
  meanDiff?: number
  /** 差の標準偏差（標本。2 件未満は undefined） */
  sd?: number
  /** 平均絶対誤差 */
  mae?: number
  /** Bland-Altman の一致の範囲（平均の差 ± 1.96 SD。2 件未満は undefined） */
  loaLow?: number
  loaHigh?: number
}

/** 差（アプリ − 正解）の一覧から統計を出す。件数が少ないときは、出せるものだけ出す */
export function angleStats(diffs: number[]): AngleStats {
  const d = diffs.filter(Number.isFinite)
  const n = d.length
  if (n === 0) return { n }
  const mean = d.reduce((s, v) => s + v, 0) / n
  const mae = d.reduce((s, v) => s + Math.abs(v), 0) / n
  if (n < 2) return { n, meanDiff: mean, mae }
  const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
  return { n, meanDiff: mean, sd, mae, loaLow: mean - 1.96 * sd, loaHigh: mean + 1.96 * sd }
}

/** 一致したレップのうち、両方の角度があるものの差（アプリ − 正解） */
export function angleDiffs(rows: AnswerRepRow[]): number[] {
  const out: number[] = []
  for (const r of rows) {
    if (r.matched && r.appAngle !== undefined && r.trueAngle !== undefined) out.push(r.appAngle - r.trueAngle)
  }
  return out
}

/** アプリのレップと正解のレップから、保存する行と回数の評価を作る */
export function evaluate(app: AppRep[], truth: TrueRep[], tol = MATCH_TOLERANCE_SEC): {
  rows: AnswerRepRow[]
  count: CountScore
  angle: AngleStats
} {
  const m = matchReps(app.map(r => r.bottomT), truth.map(r => r.bottomT), tol)
  const rows: AnswerRepRow[] = []
  for (const [a, b] of m.pairs) {
    rows.push(clean({
      appBottomT: app[a].bottomT, trueBottomT: truth[b].bottomT,
      appAngle: app[a].angle, trueAngle: truth[b].angle, matched: true,
    }))
  }
  for (const a of m.unmatchedApp) rows.push(clean({ appBottomT: app[a].bottomT, appAngle: app[a].angle, matched: false }))
  for (const b of m.unmatchedTrue) rows.push(clean({ trueBottomT: truth[b].bottomT, trueAngle: truth[b].angle, matched: false }))
  return { rows, count: countScore(app.length, truth.length, m.pairs.length), angle: angleStats(angleDiffs(rows)) }
}

/** undefined の項目を取り除く（JSON に残さない） */
function clean(r: AnswerRepRow): AnswerRepRow {
  const o: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(r)) if (v !== undefined) o[k] = v
  return o as unknown as AnswerRepRow
}

// ---------------------------------------------------------------------------
// 累計（その種目の保存済みの答え合わせ）
// ---------------------------------------------------------------------------

export interface AnswerTotals {
  videos: number
  appReps: number
  trueReps: number
  /** 回数が正解と一致した動画の本数 */
  exactVideos: number
  count: CountScore
  angle: AngleStats
}

export function summarizeKeys(records: AnswerKeyRecord[], key: FormExerciseKey): AnswerTotals {
  const rs = records.filter(r => r.exerciseKey === key)
  let appReps = 0
  let trueReps = 0
  let matched = 0
  let exact = 0
  const diffs: number[] = []
  for (const r of rs) {
    appReps += r.appReps
    trueReps += r.trueReps
    matched += r.reps.filter(x => x.matched).length
    if (r.appReps === r.trueReps) exact++
    diffs.push(...angleDiffs(r.reps))
  }
  return {
    videos: rs.length, appReps, trueReps, exactVideos: exact,
    count: countScore(appReps, trueReps, matched), angle: angleStats(diffs),
  }
}

// ---------------------------------------------------------------------------
// 保存（localStorage。読み書きは必ず try/catch）
// ---------------------------------------------------------------------------

const KEYS: FormExerciseKey[] = ['squat', 'bench', 'curl', 'rdl', 'ohp', 'lateral', 'pulldown', 'ohext', 'bss']
const VIEWS: ViewKind[] = ['side', 'front', 'oblique', 'unknown']
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const optNum = (v: unknown): number | undefined => (isNum(v) ? v : undefined)

function normalizeRow(v: unknown): AnswerRepRow | undefined {
  if (!isObj(v) || typeof v.matched !== 'boolean') return undefined
  return clean({
    appBottomT: optNum(v.appBottomT), trueBottomT: optNum(v.trueBottomT),
    appAngle: optNum(v.appAngle), trueAngle: optNum(v.trueAngle), matched: v.matched,
  })
}

/** 壊れた値を捨てて整える（新しい順の並びはそのまま。最大 MAX_ANSWER_KEYS 件） */
export function normalizeAnswerKeys(raw: unknown): AnswerKeyRecord[] {
  if (!Array.isArray(raw)) return []
  const out: AnswerKeyRecord[] = []
  for (const v of raw) {
    if (!isObj(v)) continue
    if (typeof v.id !== 'string' || typeof v.date !== 'string') continue
    if (typeof v.exerciseKey !== 'string' || !KEYS.includes(v.exerciseKey as FormExerciseKey)) continue
    const view = VIEWS.includes(v.view as ViewKind) ? (v.view as ViewKind) : 'unknown'
    if (!isNum(v.appReps) || !isNum(v.trueReps) || v.appReps < 0 || v.trueReps < 0) continue
    const rows = Array.isArray(v.reps) ? v.reps.map(normalizeRow).filter((r): r is AnswerRepRow => !!r) : []
    const phi = optNum(v.phiDeg)
    out.push({
      id: v.id, date: v.date, exerciseKey: v.exerciseKey as FormExerciseKey, view,
      ...(phi !== undefined ? { phiDeg: phi } : {}),
      appReps: Math.round(v.appReps), trueReps: Math.round(v.trueReps), reps: rows,
    })
    if (out.length >= MAX_ANSWER_KEYS) break
  }
  return out
}

export function loadAnswerKeys(): AnswerKeyRecord[] {
  try {
    const s = localStorage.getItem(ANSWER_KEYS_STORAGE_KEY)
    return s ? normalizeAnswerKeys(JSON.parse(s)) : []
  } catch {
    return []
  }
}

/** 先頭に足して保存する。保存できたら新しい一覧、できなければ undefined */
export function addAnswerKey(rec: AnswerKeyRecord): AnswerKeyRecord[] | undefined {
  const next = [rec, ...loadAnswerKeys()].slice(0, MAX_ANSWER_KEYS)
  try {
    localStorage.setItem(ANSWER_KEYS_STORAGE_KEY, JSON.stringify(next))
    return next
  } catch {
    return undefined
  }
}
