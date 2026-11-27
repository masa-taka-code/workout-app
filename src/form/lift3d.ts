/**
 * 試験的な 3D 角度（純粋関数）：画面上の位置＋骨の長さから求めた奥行き＋world 座標の前後の向き。
 * 仕様：form3d-spec.md の 3.6（3回目）。合格するまで採点・崩れの判定・基準には使わない（記録だけ）。
 *
 * 方式：
 * - 骨の長さ L は立位の値（setRefLengths の segA・segB。画面の高さを 1 とした長さ）。立位では骨がほぼ鉛直なので、
 *   画面上の長さが本当の長さの尺度になる。
 * - 各骨の奥行き |Δz| = √max(0, L² − ℓ²)（ℓ は画面上の長さ）。ℓ が L を超えるときは奥行き 0 に丸める。
 * - 奥行きの符号（前後）は world の z の差から取る（world が不信なら出さない＝undefined）。
 *   左右の骨で符号が逆になるかどうかだけが角度に効くので、z の向きの決まり（近いほど小さいか）は結果に影響しない。
 *
 * 数値の区別：論文の値は無い。LIFT3D_MIN_LEN などのしきい値はすべて【設計値・暫定】。
 * 【計算】の根拠は仕様 2.1（モンテカルロ）。骨の長さが 5% ずれると効果が消える性質があるので、立位の長さの質を呼び出し側で確かめること。
 */
import type { Joint } from './rules'
import { MAIN_JOINTS } from './rules'
import type { FormExerciseKey } from './types'

const RAD = 180 / Math.PI

/** 立位の骨の長さ（画面の高さを 1 とした長さ）。a＝太もも／上腕、b＝すね／前腕 */
export interface Lift3dLens {
  a: number
  b: number
}

interface Pt2 {
  x: number
  y: number
}

/** 3D 角度を出せる種目か（主関節が 脚 hip-knee-ankle または 腕 shoulder-elbow-wrist の種目。rdl・lateral は対象外） */
export function lift3dSupported(key: FormExerciseKey): boolean {
  const m = MAIN_JOINTS[key]
  const is = (a: Joint, b: Joint, c: Joint) => m.length === 3 && m[0] === a && m[1] === b && m[2] === c
  return is('hip', 'knee', 'ankle') || is('shoulder', 'elbow', 'wrist')
}

/** 画面上の長さ ℓ と骨の長さ L から奥行きの大きさ（ℓ ≥ L なら 0） */
export function depthFromLength(len2d: number, bone: number): number {
  return Math.sqrt(Math.max(0, bone * bone - len2d * len2d))
}

/**
 * 3 点（近位・頂点・遠位。例：股関節・膝・足首）の 3D の内角（度）。
 * zAB は 近位−頂点 の world の z の差、zCB は 遠位−頂点 の z の差（符号だけを使う）。
 * 長さが不正（0 以下・NaN）なら undefined。
 */
export function lift3dAngle(
  prox: Pt2, vertex: Pt2, distal: Pt2, lens: Lift3dLens, zAB: number, zCB: number,
): number | undefined {
  if (!(lens.a > 0) || !(lens.b > 0) || !Number.isFinite(zAB) || !Number.isFinite(zCB)) return undefined
  const v1 = { x: prox.x - vertex.x, y: prox.y - vertex.y }
  const v2 = { x: distal.x - vertex.x, y: distal.y - vertex.y }
  const l1 = Math.hypot(v1.x, v1.y)
  const l2 = Math.hypot(v2.x, v2.y)
  const d1 = depthFromLength(l1, lens.a) * (zAB < 0 ? -1 : 1)
  const d2 = depthFromLength(l2, lens.b) * (zCB < 0 ? -1 : 1)
  const n = Math.hypot(v1.x, v1.y, d1) * Math.hypot(v2.x, v2.y, d2)
  if (!(n > 0)) return undefined
  const dot = v1.x * v2.x + v1.y * v2.y + d1 * d2
  return Math.acos(Math.min(1, Math.max(-1, dot / n))) * RAD
}
