/** 2D の角度計算（x, y。y は下向きが正） */
export interface Pt {
  x: number
  y: number
}

const RAD = 180 / Math.PI

/** 点 b を頂点とする a-b-c の角度（0〜180 度）。線が潰れている場合は 0 */
export function jointAngle(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const cross = v1x * v2y - v1y * v2x
  const dot = v1x * v2x + v1y * v2y
  if (cross === 0 && dot === 0) return 0
  return Math.atan2(Math.abs(cross), dot) * RAD
}

/** from から to へ向かう線と、鉛直上向きのなす角（0〜180 度）。to が真上なら 0 */
export function tiltFromVertical(from: Pt, to: Pt): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return 0
  return Math.atan2(Math.abs(dx), -dy) * RAD
}

/** from から to へ向かう線の、鉛直上向きからの符号つきの角度（度）。to が from より +x 側なら正 */
export function signedTiltFromVertical(from: Pt, to: Pt): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return 0
  return Math.atan2(dx, -dy) * RAD
}

/**
 * MediaPipe の正規化座標は x を画像の幅、y を画像の高さで割った値なので、
 * そのまま角度を計算すると縦横比のぶんだけゆがむ（縦長 3:4 で膝 115° が 101° に見える等）。
 * x に幅÷高さを掛けて、縦横を同じ尺度にそろえる。y・z・visibility はそのまま。
 */
export function toAspectCorrected<T extends { x: number }>(pose: T[], aspect: number): T[] {
  if (!(aspect > 0) || aspect === 1) return pose
  return pose.map(p => ({ ...p, x: p.x * aspect }))
}
