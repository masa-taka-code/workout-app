/**
 * 撮影前の置き場所の判定（純粋関数）。全身の枠内・距離・向き・スマホの水平・見えやすさを見て、
 * 良否（ok / caution / ng）と、画面に出す案内（reasons）を返す。
 * 判定は待機中の直近 1 秒（PLACEMENT_WINDOW_MS）の中央値で行う。1 フレームの揺れで表示や自動開始が変わらないようにするため。
 *
 * 以下の数値はすべて「設計値・暫定」。論文の値ではなく、撮影条件の悪い映像が角度誤差の大きな原因になるため、
 * 保守的に仮置きした値。実際の撮影データで見直す。
 */
import type { FormExerciseKey, Pose, StandingSnapshot } from './types'
import { LM } from './types'
import { MIN_VISIBILITY, SIDE_INDEX, CONFIG, isLegKey } from './rules'
import type { Side } from './rules'
import { tiltFromVertical } from './geometry'
import { judgeView, median } from './measure'
import type { MeasureFrame } from './measure'
import { tiltLevel } from './tilt'

/** 判定に使う直近の時間（ミリ秒）。設計値・暫定 */
export const PLACEMENT_WINDOW_MS = 1000
/** 画面の端からの余白（画面の幅・高さに対する割合）。設計値・暫定 */
export const FRAME_MARGIN = 0.03
/** 脚の種目：鼻〜足首の高さ（画面高に対する割合）の範囲。設計値・暫定 */
export const LEG_DIST_MIN = 0.45
export const LEG_DIST_MAX = 0.9
/** 脚の種目：これ未満は極端に小さい（ng）。設計値・暫定 */
export const LEG_DIST_EXTREME = 0.3
/** 上半身の種目：上腕＋前腕の長さ（画面高に対する割合）の下限。設計値・暫定 */
export const ARM_DIST_MIN = 0.15
/** 上半身の種目：これ未満は極端に小さい（ng）。設計値・暫定 */
export const ARM_DIST_EXTREME = 0.1
/** 見えやすさ：必要な関節の visibility の最小値の平均。これ以上で ok、未満は caution。設計値・暫定 */
export const VISIBILITY_OK = 0.7
/** 見えやすさ：これ未満は ng。設計値・暫定 */
export const VISIBILITY_NG = 0.5

/** 上げきった手首の位置を予測して枠を確認する種目（腕を頭上まで上げる） */
const RAISED_WRIST_KEYS: FormExerciseKey[] = ['ohp', 'pulldown', 'ohext', 'lateral']

/** hidden＝必要な関節が映っていない（reasons は空。画面は既存の「映っていない」表示） */
export type PlacementLevel = 'ok' | 'caution' | 'ng' | 'hidden'
export type PlacementKind = 'frame' | 'distance-far' | 'distance-near' | 'view' | 'tilt' | 'visibility'

export interface PlacementReason {
  kind: PlacementKind
  severity: 'caution' | 'ng'
  /** 画面に出す日本語の案内 */
  text: string
}

export interface PlacementResult {
  level: PlacementLevel
  /** 悪い順（ng が先） */
  reasons: PlacementReason[]
}

/** 待機中の 1 フレーム分の入力 */
export interface PlacementSample {
  /** 時刻（ミリ秒）。PlacementWindow が古いものを捨てるのに使う */
  t?: number
  /** 縦横比をそろえた姿勢 */
  pose?: Pose
  world?: Pose
  /** この時点のスマホの傾き（度、画像上の向き。tilt.ts）。不明なら undefined */
  tiltDeg?: number
}

export interface PlacementOptions {
  /** 姿勢の x に掛けてある縦横比（幅÷高さ）。枠の判定で正規化座標に戻すのに使う。既定 1 */
  aspect?: number
}

const rank = { ok: 0, caution: 1, ng: 2 } as const

/** 必要な関節の見え方が良い側と、その最小 visibility */
function bestSide(key: FormExerciseKey, pose: Pose): { side: Side; minVis: number } {
  const joints = CONFIG[key].joints
  const minVis = (side: Side) => Math.min(...joints.map(j => pose[SIDE_INDEX[side][j]]?.visibility ?? 0))
  const l = minVis('left')
  const r = minVis('right')
  return r > l ? { side: 'right', minVis: r } : { side: 'left', minVis: l }
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

interface FrameMetrics {
  hidden: boolean
  minVis: number
  margin?: number
  /** 脚の種目：鼻〜足首の高さ。上半身の種目：上腕＋前腕の長さ（どちらも画面高に対する割合） */
  distance?: number
}

function frameMetrics(key: FormExerciseKey, pose: Pose | undefined, aspect: number): FrameMetrics {
  if (!pose) return { hidden: true, minVis: 0 }
  const { side, minVis } = bestSide(key, pose)
  if (minVis < MIN_VISIBILITY) return { hidden: true, minVis }
  const idx = SIDE_INDEX[side]
  const pts = CONFIG[key].joints.map(j => pose[idx[j]])
  const shoulder = pose[idx.shoulder]
  const elbow = pose[idx.elbow]
  const wrist = pose[idx.wrist]
  const armLen = shoulder && elbow && wrist ? dist(shoulder, elbow) + dist(elbow, wrist) : undefined

  const check = [...pts]
  let distance: number | undefined
  if (isLegKey(key)) {
    const nose = pose[LM.nose]
    const foot = pose[side === 'left' ? 31 : 32]
    if (nose) check.push(nose)
    if (foot) check.push(foot)
    const ankle = pose[idx.ankle]
    if (nose && ankle && (nose.visibility ?? 0) >= MIN_VISIBILITY) distance = ankle.y - nose.y
  } else {
    distance = armLen
    // 上げきった手首の高さを、肩の高さ − (上腕 + 前腕) と予測して、画面の上端に収まるか見る
    if (RAISED_WRIST_KEYS.includes(key) && shoulder && armLen !== undefined) {
      check.push({ x: shoulder.x, y: shoulder.y - armLen, z: 0 })
    }
  }
  let margin = Infinity
  for (const p of check) {
    if (!p) continue
    const x = p.x / aspect
    margin = Math.min(margin, x, 1 - x, p.y, 1 - p.y)
  }
  return { hidden: false, minVis, margin: Number.isFinite(margin) ? margin : undefined, distance }
}

/** 向きの案内（種目によって、真横または正面） */
function viewText(key: FormExerciseKey, severity: 'caution' | 'ng'): string {
  const want = key === 'lateral' ? '体の正面' : '体の真横'
  return severity === 'caution'
    ? `${want}から撮影してください（深さが数度ずれる可能性があります）`
    : `${want}から撮影してください（今の向きでは角度が大きくずれます）`
}

/**
 * 直近の窓（samples）の中央値で置き場所を判定する。
 * 向きは今までと同じ φ の判定（ok ≤15°・caution ≤30°・ng）、傾きは tilt.ts の判定。
 * 傾きが不明（undefined）のときは傾きの判定を外す（ng にしない）。
 */
export function judgePlacement(key: FormExerciseKey, samples: PlacementSample[], opts: PlacementOptions = {}): PlacementResult {
  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 1
  const frames = samples.map(s => frameMetrics(key, s.pose, aspect))
  const hiddenCount = frames.filter(f => f.hidden).length
  if (samples.length === 0 || hiddenCount * 2 > frames.length) return { level: 'hidden', reasons: [] }

  const reasons: PlacementReason[] = []
  const add = (kind: PlacementKind, severity: 'caution' | 'ng', text: string) => reasons.push({ kind, severity, text })
  const med = (xs: Array<number | undefined>) => median(xs.filter((v): v is number => v !== undefined))

  // 枠の余白
  const margin = med(frames.filter(f => !f.hidden).map(f => f.margin))
  if (margin !== undefined && margin < FRAME_MARGIN) add('frame', 'ng', '少し離れるか、カメラの向きを調整してください')

  // 距離
  const distance = med(frames.filter(f => !f.hidden).map(f => f.distance))
  if (distance !== undefined) {
    if (isLegKey(key)) {
      if (distance < LEG_DIST_EXTREME) add('distance-far', 'ng', 'もう少し近づいてください')
      else if (distance < LEG_DIST_MIN) add('distance-far', 'caution', 'もう少し近づいてください')
      else if (distance > LEG_DIST_MAX) add('distance-near', 'caution', 'もう少し離れてください')
    } else if (distance < ARM_DIST_EXTREME) add('distance-far', 'ng', 'もう少し近づいてください')
    else if (distance < ARM_DIST_MIN) add('distance-far', 'caution', 'もう少し近づいてください')
  }

  // 向き
  const viewFrames: MeasureFrame[] = samples
    .filter((s, i) => s.pose && !frames[i].hidden)
    .map(s => ({ t: s.t ?? 0, visible: true, pose: s.pose, world: s.world }))
  const view = judgeView(viewFrames, key).viewOk
  if (view !== 'ok') add('view', view, viewText(key, view))

  // スマホの水平
  const tilt = med(samples.map(s => s.tiltDeg))
  if (tilt !== undefined) {
    const lv = tiltLevel(tilt)
    if (lv !== 'ok') add('tilt', lv, `スマホをまっすぐ立ててください（傾き ${Math.round(Math.abs(tilt))}°）`)
  }

  // 見えやすさ（直近の窓での、必要な関節の visibility の最小値の平均）
  const vis = frames.reduce((s, f) => s + f.minVis, 0) / frames.length
  if (vis < VISIBILITY_NG) add('visibility', 'ng', '体全体が明るく写るようにしてください')
  else if (vis < VISIBILITY_OK) add('visibility', 'caution', '体全体が明るく写るようにしてください')

  reasons.sort((a, b) => rank[b.severity] - rank[a.severity])
  const level = reasons.length === 0 ? 'ok' : reasons[0].severity
  return { level, reasons }
}

/** 直近 1 秒の入力を溜めて判定する（画面側のバッファ。時刻は単調増加のミリ秒） */
export class PlacementWindow {
  private samples: PlacementSample[] = []
  private readonly windowMs: number

  constructor(windowMs: number = PLACEMENT_WINDOW_MS) {
    this.windowMs = windowMs
  }

  push(sample: PlacementSample & { t: number }): void {
    this.samples.push(sample)
    while (this.samples.length > 1 && sample.t - (this.samples[0].t ?? 0) > this.windowMs) this.samples.shift()
  }

  judge(key: FormExerciseKey, opts?: PlacementOptions): PlacementResult {
    return judgePlacement(key, this.samples, opts)
  }

  samplesNow(): PlacementSample[] {
    return [...this.samples]
  }

  clear(): void {
    this.samples = []
  }
}

/**
 * 開始前の立位フレーム（直近の窓）から、「自分の基準」で使う値を作る。値だけで UI は無い。
 * 座標は縦横比をそろえた 2D（画面の高さ＝1）。体幹角と傾きは補正前の値（補正はそちらで tiltDeg を使う）。
 * 必要な関節が見えているフレームが無ければ undefined。
 */
export function standingSnapshot(key: FormExerciseKey, samples: PlacementSample[]): StandingSnapshot | undefined {
  const segA: number[] = []
  const segB: number[] = []
  const trunk: number[] = []
  const phi: number[] = []
  const tilt: number[] = []
  for (const s of samples) {
    if (s.tiltDeg !== undefined) tilt.push(s.tiltDeg)
    if (!s.pose) continue
    const { side, minVis } = bestSide(key, s.pose)
    if (minVis < MIN_VISIBILITY) continue
    const idx = SIDE_INDEX[side]
    const [p, q, r] = isLegKey(key) ? [idx.hip, idx.knee, idx.ankle] : [idx.shoulder, idx.elbow, idx.wrist]
    if (s.pose[p] && s.pose[q] && s.pose[r]) {
      segA.push(dist(s.pose[p], s.pose[q]))
      segB.push(dist(s.pose[q], s.pose[r]))
    }
    if (s.pose[idx.hip] && s.pose[idx.shoulder]) trunk.push(tiltFromVertical(s.pose[idx.hip], s.pose[idx.shoulder]))
    const f = s.world ? judgeView([{ t: 0, visible: true, pose: s.pose, world: s.world }], key).phi : undefined
    if (f !== undefined) phi.push(f)
  }
  const a = median(segA)
  const b = median(segB)
  if (a === undefined || b === undefined) return undefined
  return { segA: a, segB: b, trunkLeanDeg: median(trunk), phiDeg: median(phi), tiltDeg: median(tilt) }
}
