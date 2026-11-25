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
