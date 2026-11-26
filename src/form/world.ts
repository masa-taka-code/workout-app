/**
 * world 座標（MediaPipe の worldLandmarks、メートル）の奥行きが崩れていないかの判定（純粋関数。まだ本体からは呼ばない）。
 * 仕様：form3d-spec.md の 3.5（判定 1〜3。判定 4 は実機で z の符号が分かってから入れる）。
 *
 * 数値の区別：
 * - 【論文】単一カメラの MediaPipe 3D は、2台のカメラから組み立てた場合より位置の誤差がほぼ倍（56.3mm 対 30.1mm、PMID 39686309 の抄録）。
 *   主な課題は奥行きのあいまいさ（PMC10781343、本文）。
 * - 下のしきい値はすべて【設計値・暫定】。論文の値ではない。作った姿勢データ（synthetic.ts）での試験と実機の確認で決め直す。
 */
import type { FormExerciseKey, Landmark, Pose } from './types'
import { LM } from './types'
import { SIDE_INDEX, isLegKey } from './rules'
import type { Side } from './rules'

/** 判定 1：骨の長さがセットの中央値から ±この割合を超えたコマを「崩れ」とする */
export const WORLD_LEN_TOL = 0.15
/** 判定 1：崩れたコマがこの割合を超えたら false */
export const WORLD_LEN_BAD_RATIO = 0.2
/** 判定 2：world から求めた φ の標準偏差（度）がこれを超えたら false */
export const WORLD_PHI_SD_MAX = 10
/** 判定 2：隣のコマとの φ の差（度）がこれを超えたコマを「飛び」とする */
export const WORLD_PHI_JUMP_DEG = 20
/** 判定 2：飛びのコマがこの割合を超えたら false */
export const WORLD_PHI_JUMP_RATIO = 0.1
/** 判定 3：左右の太もも（腕の種目は上腕）の長さの比（左÷右、中央値）の許容範囲 */
export const WORLD_LR_MIN = 0.8
export const WORLD_LR_MAX = 1.25
/** world の点を使う visibility の下限（rules.ts の MIN_VISIBILITY と同じ 0.5） */
const MIN_VIS = 0.5
/** 判定に必要な最小のコマ数。これ未満は判断できないので false。【設計値・暫定】 */
export const WORLD_MIN_FRAMES = 10

export interface WorldFrame {
  /** worldLandmarks。無ければ undefined（そのコマは使わない） */
  world?: Pose
}

export interface WorldTrust {
  trust: boolean
  /** false の理由（日本語）。true のときは空 */
  reasons: string[]
  stats: {
    /** 使えたコマ数 */
    frames: number
    /** 判定 1：骨の長さが中央値から ±15% を超えたコマの割合（両側のうち大きい方、または指定した側） */
    lenBadRatio?: number
    /** 判定 2：φ の標準偏差（度）と、隣のコマとの差が 20° を超えたコマの割合 */
    phiSd?: number
    phiJumpRatio?: number
    /** 判定 3：左右の長さの比（左÷右）の中央値 */
    lrRatio?: number
  }
}

const dist3 = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const ok = (p: Landmark | undefined): p is Landmark => !!p && (p.visibility ?? 1) >= MIN_VIS

function medianOf(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 近位の骨（太もも／上腕）と遠位の骨（すね／前腕）の長さ（m）。測れなければ undefined */
function boneLengths(world: Pose, side: Side, leg: boolean): { prox: number; dist: number } | undefined {
  const idx = SIDE_INDEX[side]
  const [a, b, c] = leg ? [idx.hip, idx.knee, idx.ankle] : [idx.shoulder, idx.elbow, idx.wrist]
  const p = world[a]
  const q = world[b]
  const r = world[c]
  if (!ok(p) || !ok(q) || !ok(r)) return undefined
  return { prox: dist3(p, q), dist: dist3(q, r) }
}

/** world の左右の肩を結ぶ線から、真横からのずれ φ（度）。measure.ts の phiFromWorld と同じ式（あちらを変えても影響を受けないよう別に持つ） */
function phiOf(world: Pose): number | undefined {
  const l = world[LM.leftShoulder]
  const r = world[LM.rightShoulder]
  if (!ok(l) || !ok(r)) return undefined
  const sx = r.x - l.x
  const sz = r.z - l.z
  if (sx === 0 && sz === 0) return undefined
  return (Math.atan2(Math.abs(sx), Math.abs(sz)) * 180) / Math.PI
}

/**
 * セット（またはその一部）の world 座標が信用できるかを返す。次のどれかに当てはまると false（すべて【設計値・暫定】）。
 * 1. 太もも・すね（腕の種目は上腕・前腕）の長さが、セットの中央値から ±15% を超えるコマが 20% を超える
 * 2. world から求めた φ の標準偏差が 10° を超える、または隣のコマとの差が 20° を超えるコマが 10% を超える
 * 3. 左右の太ももの長さの比（左÷右、中央値）が 0.8〜1.25 の範囲外
 * 4. 使えるコマが WORLD_MIN_FRAMES 未満（判断できないので信用しない）
 * 5. z がほぼ全点で同じ（奥行きが潰れている。isWorldDepthFlat。1回目の提案をメインが採用）
 *
 * side を渡すと判定 1 はその側だけで見る（普通は計測に使う側）。渡さなければ両側を見て、悪い方を使う。
 * 判定 2 の φ は、肩の線が奥行き方向（真横）に近いほど x が小さく不安定になるので、真横の撮影では標準偏差が大きめに出る。
 * 判定 3 は、体の片側が奥にあるとき奥側のノイズが大きいので、中央値で見る。
 */
export function judgeWorldTrust(key: FormExerciseKey, frames: WorldFrame[], opts: { side?: Side } = {}): WorldTrust {
  const leg = isLegKey(key)
  const sides: Side[] = opts.side ? [opts.side] : ['left', 'right']
  const reasons: string[] = []
  const worlds = frames.map(f => f.world).filter((w): w is Pose => !!w)

  // 判定 1・3 の元データ
  const per: Record<Side, { prox: number[]; dist: number[] }> = { left: { prox: [], dist: [] }, right: { prox: [], dist: [] } }
  const phis: (number | undefined)[] = []
  for (const w of worlds) {
    for (const s of ['left', 'right'] as const) {
      const b = boneLengths(w, s, leg)
      if (b) { per[s].prox.push(b.prox); per[s].dist.push(b.dist) }
    }
    phis.push(phiOf(w))
  }

  const usable = Math.max(per.left.prox.length, per.right.prox.length)
  const stats: WorldTrust['stats'] = { frames: usable }
  if (usable < WORLD_MIN_FRAMES) {
    return { trust: false, reasons: ['world 座標のコマが少なすぎて判断できません'], stats }
  }

  // 判定 1
  let worst = 0
  for (const s of sides) {
    for (const arr of [per[s].prox, per[s].dist]) {
      const med = medianOf(arr)
      if (!med || arr.length === 0) continue
      const bad = arr.filter(v => Math.abs(v - med) > WORLD_LEN_TOL * med).length / arr.length
      worst = Math.max(worst, bad)
    }
  }
  stats.lenBadRatio = worst
  if (worst > WORLD_LEN_BAD_RATIO) reasons.push('world 座標の骨の長さが大きく変わっています')

  // 判定 2
  const ph = phis.filter((v): v is number => v !== undefined)
  if (ph.length >= 2) {
    const mean = ph.reduce((s, v) => s + v, 0) / ph.length
    const sd = Math.sqrt(ph.reduce((s, v) => s + (v - mean) ** 2, 0) / ph.length)
    let jumps = 0
    let pairs = 0
    for (let i = 1; i < phis.length; i++) {
      const a = phis[i - 1]
      const b = phis[i]
      if (a === undefined || b === undefined) continue
      pairs++
      if (Math.abs(b - a) > WORLD_PHI_JUMP_DEG) jumps++
    }
    stats.phiSd = sd
    stats.phiJumpRatio = pairs > 0 ? jumps / pairs : 0
    if (sd > WORLD_PHI_SD_MAX) reasons.push('world 座標から求めた撮影の向きが安定しません')
    else if ((stats.phiJumpRatio ?? 0) > WORLD_PHI_JUMP_RATIO) reasons.push('world 座標から求めた撮影の向きが急に変わっています')
  }

  // 判定 3：左右の近位の骨の比（コマごとの比の中央値）
  const ratios: number[] = []
  for (const w of worlds) {
    const l = boneLengths(w, 'left', leg)
    const r = boneLengths(w, 'right', leg)
    if (l && r && r.prox > 0) ratios.push(l.prox / r.prox)
  }
  const lr = medianOf(ratios)
  if (lr !== undefined) {
    stats.lrRatio = lr
    if (lr < WORLD_LR_MIN || lr > WORLD_LR_MAX) reasons.push('world 座標の左右の骨の長さが合っていません')
  }

  // 判定 5（2回目で追加）：奥行きが潰れている（z が全点でほぼ同じ）。φ≤30° の真横に近い撮影では判定 1〜3 で見つからないため
  if (isWorldDepthFlat(frames)) reasons.push('world 座標の奥行きが潰れています')

  return { trust: reasons.length === 0, reasons, stats }
}

/** 判定 5：z がほぼ全点で同じ（奥行きが潰れている）コマの判定。このしきい値は【設計値・暫定】 */
export const WORLD_FLAT_RANGE_M = 0.01
/** 判定 5：潰れたコマがこの割合を超えたら「奥行きが潰れている」。【設計値・暫定】 */
export const WORLD_FLAT_RATIO = 0.5

/**
 * 判定 5（仕様 3.5 には無い。1回目の提案で、2回目に judgeWorldTrust へ組み込んだ）：world の z が潰れている（全点がほぼ同じ z）かを返す。
 * 仕様の判定 1〜3 だけでは、真横に近い撮影（φ≤30°）で z が 0 に潰れても検出できない（骨がほぼ画面と平行で、長さが変わらないため）。
 * 使う点は、肩・腰・膝・足首・肘・手首の両側（visibility 0.5 以上のもの）。
 */
export function isWorldDepthFlat(frames: WorldFrame[]): boolean {
  const idx = [
    LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist,
    LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle,
  ]
  let flat = 0
  let used = 0
  for (const f of frames) {
    if (!f.world) continue
    const zs = idx.map(i => f.world?.[i]).filter(ok).map(p => p.z)
    if (zs.length < 4) continue
    used++
    if (Math.max(...zs) - Math.min(...zs) < WORLD_FLAT_RANGE_M) flat++
  }
  return used >= WORLD_MIN_FRAMES && flat / used > WORLD_FLAT_RATIO
}
