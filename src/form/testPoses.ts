/** テスト用の姿勢生成。角度から関節の座標を幾何的に組み立てる（体は画面右向き） */
import type { Landmark, Pose } from './types'
import { LM } from './types'

const RAD = Math.PI / 180

export interface PoseOpts {
  /** 左側の visibility（既定 1） */
  visLeft?: number
  /** 右側の visibility（既定 1） */
  visRight?: number
  /** squat：かかとの浮き（正規化座標の高さ。既定 0＝足裏がべったり） */
  heelLift?: number
  /** squat：すねの前傾（鉛直からの角度。既定 0） */
  shinLean?: number
}

type Pt = { x: number; y: number }

/** 33点を (0.5, 0.5) で埋めた姿勢 */
function blank(): Pose {
  return Array.from({ length: 33 }, (): Landmark => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
}

const LEFT = {
  shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist, hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle,
  heel: 29, toe: 31,
}
const RIGHT = {
  shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist, hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle,
  heel: 30, toe: 32,
}

type Joints = Partial<Record<keyof typeof LEFT, Pt>>

/** 関節の座標を両側に置く（右側は x を少しずらす）。visibility は側ごとに指定 */
function place(joints: Joints, opts: PoseOpts): Pose {
  const pose = blank()
  for (const name of Object.keys(joints) as (keyof typeof LEFT)[]) {
    const p = joints[name]
    if (!p) continue
    pose[LEFT[name]] = { x: p.x, y: p.y, z: 0, visibility: opts.visLeft ?? 1 }
    pose[RIGHT[name]] = { x: p.x + 0.01, y: p.y, z: 0, visibility: opts.visRight ?? 1 }
  }
  return pose
}

const SEG = 0.2 // 太もも・すね・上腕・前腕の長さ
const TORSO_LEN = 0.25

/**
 * スクワット（真横）。knee = 膝の角度、torso = 体幹の前傾（鉛直からの角度）。
 * すねは鉛直。股関節の角度は knee と torso から決まる。
 */
export function squatPose(knee: number, torso: number, opts: PoseOpts = {}): Pose {
  const ankle = { x: 0.5, y: 0.9 }
  const lean = (opts.shinLean ?? 0) * RAD
  // 足首→膝は鉛直から lean 度、前（+x）側に傾ける
  const k = { x: ankle.x + SEG * Math.sin(lean), y: ankle.y - SEG * Math.cos(lean) }
  // 膝→足首の向きを、後ろ側（x が小さい側）に knee 度回した向きが膝→股関節
  const dx = -Math.sin(lean)
  const dy = Math.cos(lean)
  const c = Math.cos(knee * RAD)
  const s = Math.sin(knee * RAD)
  const hip = { x: k.x + SEG * (dx * c - dy * s), y: k.y + SEG * (dx * s + dy * c) }
  const shoulder = { x: hip.x + TORSO_LEN * Math.sin(torso * RAD), y: hip.y - TORSO_LEN * Math.cos(torso * RAD) }
  // かかとはつま先の高さから heelLift だけ上げる（つま先は足首の 0.05 下、前へ 0.1）
  const toe = { x: ankle.x + 0.1, y: ankle.y + 0.05 }
  const heel = { x: ankle.x - 0.05, y: ankle.y + 0.05 - (opts.heelLift ?? 0) }
  return place({ ankle, knee: k, hip, shoulder, heel, toe }, opts)
}

/** ベンチプレス（真横）。elbow = 肘の角度。上腕は鉛直（肩の真下に肘） */
export function benchPose(elbow: number, opts: PoseOpts = {}): Pose {
  const shoulder = { x: 0.4, y: 0.4 }
  const e = { x: shoulder.x, y: shoulder.y + SEG }
  const wrist = { x: e.x + SEG * Math.sin(elbow * RAD), y: e.y - SEG * Math.cos(elbow * RAD) }
  return place({ shoulder, elbow: e, wrist }, opts)
}

/**
 * カール（真横、立位）。elbow = 肘の角度、upperArm = 上腕が体幹から前に開く角度、
 * torso = 体幹の前傾。
 */
export function curlPose(elbow: number, upperArm = 0, torso = 0, opts: PoseOpts = {}): Pose {
  const shoulder = { x: 0.5, y: 0.3 }
  const hip = { x: shoulder.x - TORSO_LEN * Math.sin(torso * RAD), y: shoulder.y + TORSO_LEN * Math.cos(torso * RAD) }
  // 肩→股関節の向きを、前（+x）側に upperArm 度回した向きが上腕
  const dx = hip.x - shoulder.x
  const dy = hip.y - shoulder.y
  const c = Math.cos(upperArm * RAD)
  const s = Math.sin(upperArm * RAD)
  const ux = (dx * c + dy * s) / TORSO_LEN
  const uy = (-dx * s + dy * c) / TORSO_LEN
  const e = { x: shoulder.x + SEG * ux, y: shoulder.y + SEG * uy }
  // 肘→肩の向きから elbow 度、前（+x）側に回した向きが前腕
  const bx = (shoulder.x - e.x) / SEG
  const by = (shoulder.y - e.y) / SEG
  const ec = Math.cos(elbow * RAD)
  const es = Math.sin(elbow * RAD)
  const wrist = { x: e.x + SEG * (bx * ec + by * es), y: e.y + SEG * (-bx * es + by * ec) }
  const pose = place({ shoulder, elbow: e, wrist, hip }, opts)
  // 体の向き（+x 側）が分かるよう、鼻を肩の前に置く
  pose[LM.nose] = { x: shoulder.x + 0.05, y: shoulder.y - 0.1, z: 0, visibility: 1 }
  return pose
}

/** 左側の点は left から、右側の点は right から取る */
export function combineSides(left: Pose, right: Pose): Pose {
  const out = right.map((p) => ({ ...p }))
  for (const idx of Object.values(LEFT)) out[idx] = { ...left[idx] }
  return out
}

/** 指定した側の全ての点の visibility を変える */
export function setVisibility(pose: Pose, side: 'left' | 'right', v: number): Pose {
  const out = pose.map((p) => ({ ...p }))
  for (const idx of Object.values(side === 'left' ? LEFT : RIGHT)) out[idx].visibility = v
  return out
}

/** 指定した関節だけ visibility を変える（両側） */
export function setJointVisibility(pose: Pose, joint: keyof typeof LEFT, v: number): Pose {
  const out = pose.map((p) => ({ ...p }))
  out[LEFT[joint]].visibility = v
  out[RIGHT[joint]].visibility = v
  return out
}

export interface PathFrame {
  /** ミリ秒 */
  t: number
  /** 主関節の角度（入力値） */
  angle: number
  /** 0（伸びた）〜1（最も曲がった）に近い進み具合 */
  progress: number
}

export interface PathOpts {
  top: number
  /** レップごとの最も曲げた角度 */
  bottoms: number[]
  downSec: number
  upSec: number
  fps?: number
  /** 最初と各レップの間に伸びた状態で止まる秒数 */
  holdTopSec?: number
  holdBottomSec?: number
  startMs?: number
}

/** 伸びた状態から曲げて戻す動きを、一定間隔のフレーム列にする（直線補間） */
export function repPath(o: PathOpts): PathFrame[] {
  const fps = o.fps ?? 30
  const dt = 1000 / fps
  const holdTop = o.holdTopSec ?? 0.5
  const holdBottom = o.holdBottomSec ?? 0.2
  const out: PathFrame[] = []
  let t = o.startMs ?? 1000
  let cur = o.top
  const range = Math.max(...o.bottoms.map((b) => o.top - b), 1)
  const push = (angle: number) => {
    out.push({ t, angle, progress: Math.min(1, Math.max(0, (o.top - angle) / range)) })
    t += dt
  }
  const move = (to: number, sec: number) => {
    const n = Math.max(1, Math.round(sec * fps))
    const from = cur
    for (let i = 1; i <= n; i++) push(from + ((to - from) * i) / n)
    cur = to
  }
  const hold = (sec: number) => {
    const n = Math.round(sec * fps)
    for (let i = 0; i < n; i++) push(cur)
  }
  hold(holdTop)
  for (const b of o.bottoms) {
    move(b, o.downSec)
    hold(holdBottom)
    move(o.top, o.upSec)
    hold(holdTop)
  }
  return out
}

/** 全ての点を x 方向に dx ずらす（体ごと動いたことにする） */
export function shiftPose(pose: Pose, dx: number): Pose {
  return pose.map((p) => ({ ...p, x: p.x + dx }))
}

/**
 * worldLandmarks（メートル、原点は股関節、y は下向き、z は奥行き）の姿勢。
 * phi = 真横からのずれ（度）。0 なら肩の線がカメラの奥行き方向（真横）、90 なら画面の横方向（正面）。
 * 肩幅 0.4m、脚・腕は各区間 leg / arm メートルで真っすぐ下に伸ばす。
 */
export function worldPose(phi: number, leg = 0.4, arm = 0.3): Pose {
  const pose = blank().map((p) => ({ ...p, x: 0, y: 0, z: 0 }))
  const sx = 0.2 * Math.sin(phi * RAD)
  const sz = 0.2 * Math.cos(phi * RAD)
  const sy = -0.5
  const set = (i: number, x: number, y: number, z: number) => {
    pose[i] = { x, y, z, visibility: 1 }
  }
  set(LM.leftShoulder, -sx, sy, -sz)
  set(LM.rightShoulder, sx, sy, sz)
  set(LM.leftElbow, -sx, sy + arm, -sz)
  set(LM.rightElbow, sx, sy + arm, sz)
  set(LM.leftWrist, -sx, sy + 2 * arm, -sz)
  set(LM.rightWrist, sx, sy + 2 * arm, sz)
  for (const i of [LM.leftHip, LM.rightHip]) set(i, 0, 0, 0)
  for (const i of [LM.leftKnee, LM.rightKnee]) set(i, 0, leg, 0)
  for (const i of [LM.leftAnkle, LM.rightAnkle]) set(i, 0, 2 * leg, 0)
  return pose
}
