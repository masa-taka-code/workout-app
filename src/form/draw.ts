/** 骨格の描画（canvas） */
import { LM } from './types'
import type { Pose } from './types'

const LINES: [number, number][] = [
  [LM.leftShoulder, LM.leftElbow], [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow], [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip], [LM.leftHip, LM.leftKnee], [LM.leftKnee, LM.leftAnkle],
  [LM.rightShoulder, LM.rightHip], [LM.rightHip, LM.rightKnee], [LM.rightKnee, LM.rightAnkle],
  [LM.leftShoulder, LM.rightShoulder], [LM.leftHip, LM.rightHip],
]
const POINTS = [
  LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist,
  LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle,
]

export interface SkeletonColors { good: string; warn: string; bad: string; neutral: string }

/** 直近レップの点数から色を選ぶ（80以上 good、60以上 warn、未満 bad） */
export function colorForScore(score: number | undefined, c: SkeletonColors): string {
  if (score === undefined) return c.neutral
  if (score >= 80) return c.good
  if (score >= 60) return c.warn
  return c.bad
}

/** 角度ラベルを付ける関節（キー名 → 関節番号の候補。見えている側を使う） */
const ANGLE_JOINT: Record<string, [number, number]> = {
  knee: [LM.leftKnee, LM.rightKnee],
  hip: [LM.leftHip, LM.rightHip],
  elbow: [LM.leftElbow, LM.rightElbow],
}

export function drawSkeleton(
  canvas: HTMLCanvasElement,
  pose: Pose | undefined,
  color: string,
  angles: Record<string, number>,
  mirror: boolean,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  if (!pose) return
  const px = (i: number) => ({ x: (mirror ? 1 - pose[i].x : pose[i].x) * w, y: pose[i].y * h })
  const ok = (i: number) => !!pose[i] && (pose[i].visibility ?? 1) > 0.3
  ctx.lineWidth = Math.max(3, w / 120)
  ctx.lineCap = 'round'
  ctx.strokeStyle = color
  for (const [a, b] of LINES) {
    if (!ok(a) || !ok(b)) continue
    const p = px(a), q = px(b)
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke()
  }
  ctx.fillStyle = color
  for (const i of POINTS) {
    if (!ok(i)) continue
    const p = px(i)
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(4, w / 90), 0, Math.PI * 2); ctx.fill()
  }
  // 主関節の角度を関節の横に表示
  const fontPx = Math.max(14, Math.round(w / 28))
  ctx.font = `bold ${fontPx}px sans-serif`
  ctx.textBaseline = 'middle'
  for (const [key, deg] of Object.entries(angles)) {
    const pair = ANGLE_JOINT[key]
    if (!pair || !Number.isFinite(deg)) continue
    const i = [...pair].filter(ok).sort((a, b) => (pose[b].visibility ?? 1) - (pose[a].visibility ?? 1))[0]
    if (i === undefined) continue
    const p = px(i)
    const text = `${Math.round(deg)}°`
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'
    ctx.strokeText(text, p.x + 10, p.y)
    ctx.fillStyle = '#fff'
    ctx.fillText(text, p.x + 10, p.y)
    ctx.strokeStyle = color
    ctx.fillStyle = color
  }
}
