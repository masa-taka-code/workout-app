/**
 * スマホの傾き（画面の回転方向のロール）の計算と、傾きに合わせた座標の補正（純粋関数）。
 * センサーの読み取りは tiltSensor.ts。ここは数値の計算だけ。
 * 傾きの符号：世界の「上」が画面の右へ傾いて見えるとき（スマホの上端が左へ倒れているとき）が正。
 */
import type { Pose } from './types'

const RAD = Math.PI / 180

/** 設計値・暫定：傾きが |3°| 以下なら ok */
export const TILT_OK_DEG = 3
/** 設計値・暫定：傾きが |7°| 以下なら caution、それより大きいと ng */
export const TILT_CAUTION_DEG = 7

/**
 * 設計値・暫定：計測中に、計測開始時の傾き（固定値）からこれ以上ずれたら、スマホが動いたとして置き場所を ng にする。
 * 補正は固定値で行うので、ずれが大きいと補正が合わなくなる。ok の幅（3°）と同じ値にしている。
 */
export const TILT_SHIFT_NG_DEG = 3

export type TiltLevel = 'ok' | 'caution' | 'ng'

export function tiltLevel(tiltDeg: number): TiltLevel {
  const a = Math.abs(tiltDeg)
  if (a <= TILT_OK_DEG) return 'ok'
  if (a <= TILT_CAUTION_DEG) return 'caution'
  return 'ng'
}

/**
 * DeviceOrientationEvent の beta・gamma（度）と画面の向き（screen.orientation.angle。縦持ちは 0）から、
 * 画面の回転方向の傾き（度）を求める。
 * 重力の「上」の向きを端末の座標で組み立て（beta=90 付近は gamma が不安定なので角度では読まない）、
 * 画面の向きに合わせて回してから、画面の上方向とのずれを取る。縦持ちで立てていれば 0。
 */
export function tiltFromOrientation(beta: number, gamma: number, screenAngleDeg = 0): number {
  const b = beta * RAD
  const g = gamma * RAD
  // 端末座標（x＝右、y＝上端、z＝画面の手前）での「世界の上」
  const ux = -Math.sin(g) * Math.cos(b)
  const uy = Math.sin(b)
  const s = screenAngleDeg * RAD
  // 画面の座標（右・上）に直す
  const sx = ux * Math.cos(s) - uy * Math.sin(s)
  const sy = ux * Math.sin(s) + uy * Math.cos(s)
  if (sx === 0 && sy === 0) return 0
  return Math.atan2(sx, sy) / RAD
}

/**
 * 内カメラは生の映像が左右反転（プレビューだけ鏡）なので、画像上の傾きの符号が逆になる。
 * 画像の座標を補正するための傾きに直す。
 */
export function imageTilt(deviceTiltDeg: number, facing: 'user' | 'environment'): number {
  return facing === 'user' ? -deviceTiltDeg : deviceTiltDeg
}

/** 姿勢の全点を原点まわりに angleDeg 回す（x・y のみ。縦横比をそろえた座標を渡す）。角度・長さは変わらない */
export function rotatePose(pose: Pose, angleDeg: number): Pose {
  if (angleDeg === 0) return pose
  const c = Math.cos(angleDeg * RAD)
  const s = Math.sin(angleDeg * RAD)
  return pose.map(p => ({ ...p, x: p.x * c - p.y * s, y: p.x * s + p.y * c }))
}

/**
 * 傾き補正：座標を −傾き 分だけ回して、鉛直を基準にした計測（体幹・すねの前傾など）を画面の鉛直から世界の鉛直に戻す。
 * 縦横比をそろえた座標（geometry.toAspectCorrected 後）に使う。
 */
export function correctTilt(pose: Pose, tiltDeg: number): Pose {
  return rotatePose(pose, -tiltDeg)
}

/**
 * 補正をかける傾きか。傾きが分かっていれば常に補正する（不明のときだけかけない）。
 * 計測を始めた時点の傾き（待機中の中央値）をセットのあいだ固定して渡す。
 * 閾値で補正のオン・オフを切り替えると、傾きが閾値のあたりで揺れたとき体幹の角度に段差が出るため。
 */
export function needsTiltCorrection(tiltDeg: number | undefined): tiltDeg is number {
  return tiltDeg !== undefined && Number.isFinite(tiltDeg)
}
