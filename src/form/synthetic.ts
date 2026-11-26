/**
 * 試験専用：作った姿勢データの生成器（本体のコードからは import しない）。
 *
 * 目的：本当の関節角度・撮影の向き・隠れ・ノイズが「分かっている」姿勢の時系列を作り、
 * 姿勢推定の誤差（今のコードの誤差、補間・外れ値除去の効果）を測る。
 * 仕様：form3d-spec.md の 4 章。
 *
 * 数値の区別（すべてこのファイルの値は【設計値・暫定】。論文の値ではない）：
 * - 体の寸法の既定値：一般的な成人の目安として仮置き。
 * - ノイズの大きさ：2D は正規化座標で σ=0.004（約 1cm 相当）、world の xy は σ=2cm、z は σ=5cm。
 *   z の 5cm は、単一カメラの MediaPipe 3D の位置誤差 56.3mm（PMID 39686309 の抄録、読めた範囲：抄録＋PMC 本文）を目安にした。
 * - visibility は手前 0.95・奥 0.7（仮置き）。
 *
 * 座標系：
 * - 体の座標 (u, v, w)：u＝体の前、v＝上、w＝体の左。足首が u=0。
 * - 撮影の向き yawDeg＝φ：真横（0°）からのずれ。0 のとき、左側がカメラに近い側（手前）。
 * - カメラ座標：x＝右、y＝下、z＝奥（遠いほど大きい）。ピンホールカメラで射影し、
 *   画像の高さを 1 とした焦点距離 f = 0.5 / tan(vfov / 2) を使う。
 *   正規化座標 x は幅で、y は高さで割る（MediaPipe と同じ。使う側が toAspectCorrected で戻す）。
 * - world：原点は両股関節の中点、軸はカメラと同じ向き（x 右、y 下、z 奥）、単位はメートル。
 *   「z はカメラに近いほど小さい」は【未確認の仮定】（仕様 1 章。実機で確かめる項目）。
 */
import type { Joint } from './rules'
import { SIDE_INDEX } from './rules'
import type { Landmark, Pose } from './types'
import { LM } from './types'

const RAD = Math.PI / 180

export interface Body {
  /** 太もも・すね・上腕・前腕・胴（股関節中点〜肩中点）・肩幅・腰幅（m）。【設計値・暫定】 */
  thigh: number
  shin: number
  upperArm: number
  forearm: number
  torso: number
  shoulderWidth: number
  hipWidth: number
}

export const DEFAULT_BODY: Body = {
  thigh: 0.45, shin: 0.43, upperArm: 0.30, forearm: 0.27, torso: 0.50, shoulderWidth: 0.38, hipWidth: 0.18,
}

export type SceneExercise = 'squat' | 'bench' | 'curl'

export interface SceneRep {
  /** 主関節（squat：膝、bench・curl：肘）の最小の内角（度） */
  minAngle: number
  /** 下ろす秒数・上げる秒数（squat・bench は角度が減る側が下ろす。curl は角度が減る側が「上げる」） */
  eccS: number
  conS: number
  /** レップ間の停止（秒）。既定 0.5 */
  pauseS?: number
}

export interface SceneCamera {
  /** 真横からのずれ φ（度） */
  yawDeg: number
  rollDeg?: number
  pitchDeg?: number
  /** 既定 2.5 m */
  distM?: number
  /** カメラの高さ。既定 0.9 m */
  heightM?: number
  /** 縦の画角。既定 60° */
  vfovDeg?: number
  /** 画像の幅÷高さ。既定 3/4（縦長） */
  aspect?: number
  /** 既定 30 */
  fps?: number
}

export interface SceneNoise {
  /** 2D（正規化座標）の標準偏差。既定 0.004 */
  px?: number
  /** 奥側のノイズの倍率。既定 2（PMID 37943887 の抄録：隠れた側のばらつきは約 2 倍） */
  farSideMult?: number
  /** world の xy・z の標準偏差（m）。既定 0.02・0.05 */
  worldXY?: number
  worldZ?: number
}

export interface SceneOcclusion {
  joint: Joint
  side: 'near' | 'far'
  startS: number
  durS: number
  /**
   * lowVis：visibility 0.2、座標はノイズ（σ0.03）／
   * drift：反対側の同じ関節へ寄っていく（visibility は 0.6 のまま＝見えているように見えて間違っている）／
   * missing：コマごと pose なし（pose・world が undefined）
   */
  mode: 'lowVis' | 'drift' | 'missing'
}

export interface SceneSpec {
  exercise: SceneExercise
  body?: Partial<Body>
  reps: SceneRep[]
  /** つま先を外に向けた角度（脚の平面の回転、度）。squat のみ */
  toeOutDeg?: number
  camera: SceneCamera
  noise?: SceneNoise
  occlusions?: SceneOcclusion[]
  /** 1コマだけの飛び（外れ値）を入れる割合（コマあたり。手前側の関節から1点） */
  spikeRate?: number
  /** world の奥行きが崩れる条件（z を 0 に潰す／z のノイズ 0.3 m） */
  worldCollapse?: 'flat' | 'noisy'
  seed: number
}

export interface SceneFrame {
  /** ミリ秒（0 始まり） */
  t: number
  /** missing のコマは undefined */
  pose: Pose | undefined
  world: Pose | undefined
}

export interface TruthRep {
  /** 本当の主関節の最小の内角（3D、度） */
  minAngle: number
  /** 角度が減り始めた時刻・最小になった時刻・戻りきった時刻（ミリ秒） */
  startT: number
  minT: number
  endT: number
  eccS: number
  conS: number
}

export interface Scene {
  frames: SceneFrame[]
  truth: TruthRep[]
  /** コマごとの、本当の主関節の内角（3D、度。手前側） */
  trueAngles: number[]
  /** 入れた外れ値（コマの番号と、動かした MediaPipe の点の番号） */
  spikes: { frame: number; landmark: number }[]
  aspect: number
  fps: number
  /** 手前の側（常に 'left'） */
  nearSide: 'left'
}

/** 乱数（種を固定して毎回同じ結果にする） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 正規分布（Box–Muller） */
function gauss(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
}

/** 伸びた側の角度（度）。【設計値・暫定】 */
const TOP_ANGLE: Record<SceneExercise, number> = { squat: 175, bench: 175, curl: 165 }
/** 最初と最後の静止（秒）。【設計値・暫定】 */
const LEAD_S = 1.0
const TAIL_S = 0.7

type P3 = { u: number; v: number; w: number }

/** 主関節の内角 → 体の座標での各関節（体の左右は別々に返す） */
function bodyJoints(ex: SceneExercise, angle: number, b: Body, toeOutDeg: number): Record<string, P3> {
  const out: Record<string, P3> = {}
  const hw = b.hipWidth / 2
  const sw = b.shoulderWidth / 2
  const ankleV = 0.08
  const set = (name: string, u: number, v: number, w: number) => { out[name] = { u, v, w } }

  if (ex === 'squat' || ex === 'curl') {
    // すねの前傾・体幹の前傾。squat は膝の曲がりに比例（【設計値・暫定】）。curl は立位で、ほぼ直立
    const flex = Math.max(0, 175 - angle)
    const shinLean = ex === 'squat' ? 0.33 * flex : 0
    const torsoLean = ex === 'squat' ? 15 + 0.28 * flex : 3
    const kneeAng = ex === 'squat' ? angle : 178
    // ankle→knee は鉛直から shinLean だけ前へ
    const s = shinLean * RAD
    const knee = { u: b.shin * Math.sin(s), v: ankleV + b.shin * Math.cos(s) }
    // knee→ankle を、後ろ向きに kneeAng だけ（時計回りに）回した向きが knee→hip
    const ka = { x: -Math.sin(s), y: -Math.cos(s) }
    const th = kneeAng * RAD
    const dir = { x: ka.x * Math.cos(th) + ka.y * Math.sin(th), y: -ka.x * Math.sin(th) + ka.y * Math.cos(th) }
    const hip = { u: knee.u + b.thigh * dir.x, v: knee.v + b.thigh * dir.y }
    // 脚の平面は、撮影の向き φ を増やす向きに回す（脚の平面のカメラに対する回転 ψ = φ + toeOutDeg。仕様 2.1 の前提。逆向きに回すと打ち消し合う）
    const to = ex === 'squat' ? -toeOutDeg * RAD : 0
    // つま先を外へ：足首を軸に、脚の平面を鉛直軸まわりに回す（骨の長さ・膝の内角は変わらない）
    for (const [name, sign] of [['L', 1], ['R', -1]] as const) {
      const rot = (p: { u: number }) => ({ u: p.u * Math.cos(to), w: sign * (hw + p.u * Math.sin(to)) })
      const a = rot({ u: 0 })
      set(`ankle${name}`, a.u, ankleV, a.w)
      const k = rot(knee)
      set(`knee${name}`, k.u, knee.v, k.w)
      const h = rot(hip)
      set(`hip${name}`, h.u, hip.v, h.w)
      // かかと・つま先（足の向きは to）
      set(`heel${name}`, a.u - 0.05 * Math.cos(to), 0, a.w - sign * 0.05 * Math.sin(to))
      set(`toe${name}`, a.u + 0.15 * Math.cos(to), 0, a.w + sign * 0.15 * Math.sin(to))
    }
    const hipMid = { u: (out.hipL.u + out.hipR.u) / 2, v: hip.v }
    const t = torsoLean * RAD
    const sh = { u: hipMid.u + b.torso * Math.sin(t), v: hipMid.v + b.torso * Math.cos(t) }
    set('shoulderL', sh.u, sh.v, sw)
    set('shoulderR', sh.u, sh.v, -sw)
    if (ex === 'squat') {
      // バーを担ぐ姿勢：腕は肩の前に出す（腕の計測には使わない）
      for (const [name, sign] of [['L', 1], ['R', -1]] as const) {
        set(`elbow${name}`, sh.u + 0.05, sh.v - 0.25, sign * sw)
        set(`wrist${name}`, sh.u + 0.12, sh.v - 0.05, sign * sw)
      }
    } else {
      // curl：上腕は鉛直に下げ、前腕が肘の内角 angle で前へ曲がる
      for (const [name, sign] of [['L', 1], ['R', -1]] as const) {
        const e = { u: sh.u, v: sh.v - b.upperArm }
        set(`elbow${name}`, e.u, e.v, sign * sw)
        const th2 = angle * RAD
        set(`wrist${name}`, e.u + b.forearm * Math.sin(th2), e.v + b.forearm * Math.cos(th2), sign * sw)
      }
    }
    set('nose', sh.u + 0.06, sh.v + 0.2, 0)
  } else {
    // bench：仰向け。体は u 方向に寝る（頭が +u）。肩を固定し、前腕は鉛直（手首が肘の真上）
    const benchV = 0.45
    const th = angle * RAD
    const sh = { u: 0, v: benchV }
    for (const [name, sign] of [['L', 1], ['R', -1]] as const) {
      set(`shoulder${name}`, sh.u, sh.v, sign * sw)
      const e = { u: b.upperArm * Math.sin(th), v: benchV - b.upperArm * Math.cos(th) }
      set(`elbow${name}`, e.u, e.v, sign * sw)
      set(`wrist${name}`, e.u, e.v + b.forearm, sign * sw)
      set(`hip${name}`, -b.torso, benchV, sign * hw)
      set(`knee${name}`, -b.torso - 0.25, benchV + 0.3, sign * hw)
      set(`ankle${name}`, -b.torso - 0.25, ankleV, sign * hw)
    }
    set('nose', 0.2, benchV + 0.05, 0)
  }
  return out
}

/** 角度の時系列（度）。レップごとに余弦状に動かす */
function buildTimeline(ex: SceneExercise, reps: SceneRep[], fps: number): { times: number[]; angles: number[]; truth: TruthRep[] } {
  const top = TOP_ANGLE[ex]
  const downFirst = (r: SceneRep) => (ex === 'curl' ? r.conS : r.eccS) // 角度が減る側の秒数
  const upSecond = (r: SceneRep) => (ex === 'curl' ? r.eccS : r.conS)
  const truth: TruthRep[] = []
  // 区間（開始秒、長さ秒、始点角、終点角）
  const segs: { s: number; d: number; a0: number; a1: number }[] = []
  let t = LEAD_S
  for (const r of reps) {
    const d1 = downFirst(r)
    const d2 = upSecond(r)
    segs.push({ s: t, d: d1, a0: top, a1: r.minAngle })
    segs.push({ s: t + d1, d: d2, a0: r.minAngle, a1: top })
    truth.push({
      minAngle: r.minAngle, startT: t * 1000, minT: (t + d1) * 1000, endT: (t + d1 + d2) * 1000, eccS: r.eccS, conS: r.conS,
    })
    t += d1 + d2 + (r.pauseS ?? 0.5)
  }
  const total = t - (reps.length ? (reps[reps.length - 1].pauseS ?? 0.5) : 0) + TAIL_S
  const n = Math.floor(total * fps) + 1
  const times: number[] = []
  const angles: number[] = []
  for (let i = 0; i < n; i++) {
    const ts = i / fps
    let a = top
    for (const sg of segs) {
      if (ts >= sg.s && ts < sg.s + sg.d) {
        const x = (ts - sg.s) / sg.d
        a = sg.a0 + (sg.a1 - sg.a0) * (1 - Math.cos(Math.PI * x)) / 2
        break
      }
    }
    times.push(ts * 1000)
    angles.push(a)
  }
  return { times, angles, truth }
}

/** 3D の内角（度） */
function angle3(a: P3, b: P3, c: P3): number {
  const v1 = [a.u - b.u, a.v - b.v, a.w - b.w]
  const v2 = [c.u - b.u, c.v - b.v, c.w - b.w]
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]
  const n = Math.hypot(...v1) * Math.hypot(...v2)
  return Math.acos(Math.min(1, Math.max(-1, dot / n))) / RAD
}

const NAME_TO_LM: Record<string, number> = {
  shoulderL: LM.leftShoulder, shoulderR: LM.rightShoulder,
  elbowL: LM.leftElbow, elbowR: LM.rightElbow,
  wristL: LM.leftWrist, wristR: LM.rightWrist,
  hipL: LM.leftHip, hipR: LM.rightHip,
  kneeL: LM.leftKnee, kneeR: LM.rightKnee,
  ankleL: LM.leftAnkle, ankleR: LM.rightAnkle,
  heelL: 29, heelR: 30, toeL: 31, toeR: 32,
  nose: LM.nose,
}

const blankLandmark = (): Landmark => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 })

/** 作った姿勢データを返す。同じ seed なら毎回同じ結果 */
export function makeScene(spec: SceneSpec): Scene {
  const rnd = mulberry32(spec.seed)
  const body: Body = { ...DEFAULT_BODY, ...spec.body }
  const cam = spec.camera
  const fps = cam.fps ?? 30
  const aspect = cam.aspect ?? 3 / 4
  const dist = cam.distM ?? 2.5
  const camH = cam.heightM ?? 0.9
  const f = 0.5 / Math.tan(((cam.vfovDeg ?? 60) * RAD) / 2)
  const yaw = cam.yawDeg * RAD
  const roll = (cam.rollDeg ?? 0) * RAD
  const pitch = (cam.pitchDeg ?? 0) * RAD
  const nz = spec.noise ?? {}
  const sigPx = nz.px ?? 0.004
  const farMult = nz.farSideMult ?? 2
  const sigWxy = nz.worldXY ?? 0.02
  const sigWz = spec.worldCollapse === 'noisy' ? 0.3 : (nz.worldZ ?? 0.05)
  const toeOut = spec.exercise === 'squat' ? (spec.toeOutDeg ?? 0) : 0

  const tl = buildTimeline(spec.exercise, spec.reps, fps)

  // 体の座標 → カメラ座標
  const toCam = (p: P3): { X: number; Y: number; Z: number } => {
    // 体の向きを yaw だけ回す。左（w>0）がカメラに近い（z が小さい）
    const x = p.u * Math.cos(yaw) + p.w * Math.sin(yaw)
    const z = dist + p.u * Math.sin(yaw) - p.w * Math.cos(yaw)
    const y = -(p.v - camH)
    const y2 = y * Math.cos(pitch) - z * Math.sin(pitch)
    const z2 = y * Math.sin(pitch) + z * Math.cos(pitch)
    const x3 = x * Math.cos(roll) - y2 * Math.sin(roll)
    const y3 = x * Math.sin(roll) + y2 * Math.cos(roll)
    return { X: x3, Y: y3, Z: z2 }
  }

  const frames: SceneFrame[] = []
  const trueAngles: number[] = []
  const spikes: { frame: number; landmark: number }[] = []
  const occ = spec.occlusions ?? []

  for (let i = 0; i < tl.times.length; i++) {
    const t = tl.times[i]
    const a = tl.angles[i]
    const j3 = bodyJoints(spec.exercise, a, body, toeOut)
    // 本当の主関節の内角（手前＝左）
    trueAngles.push(
      spec.exercise === 'squat'
        ? angle3(j3.hipL, j3.kneeL, j3.ankleL)
        : angle3(j3.shoulderL, j3.elbowL, j3.wristL),
    )

    const cams: Record<string, { X: number; Y: number; Z: number }> = {}
    for (const k of Object.keys(j3)) cams[k] = toCam(j3[k])
    const ref = {
      X: (cams.hipL.X + cams.hipR.X) / 2, Y: (cams.hipL.Y + cams.hipR.Y) / 2, Z: (cams.hipL.Z + cams.hipR.Z) / 2,
    }

    const pose: Pose = Array.from({ length: 33 }, blankLandmark)
    const world: Pose = Array.from({ length: 33 }, blankLandmark)
    for (const [name, idx] of Object.entries(NAME_TO_LM)) {
      const c = cams[name]
      if (!c) continue
      const far = name.endsWith('R')
      const sg = sigPx * (far ? farMult : 1)
      pose[idx] = {
        x: 0.5 + (f * c.X / c.Z) / aspect + sg * gauss(rnd),
        y: 0.5 + (f * c.Y / c.Z) + sg * gauss(rnd),
        z: 0,
        visibility: far ? 0.7 : 0.95,
      }
      const wz = spec.worldCollapse === 'flat' ? 0 : c.Z - ref.Z + sigWz * gauss(rnd)
      world[idx] = {
        x: c.X - ref.X + sigWxy * gauss(rnd),
        y: c.Y - ref.Y + sigWxy * gauss(rnd),
        z: wz,
        visibility: far ? 0.7 : 0.95,
      }
      pose[idx].z = wz
    }

    // 外れ値（1コマだけの飛び）
    if (spec.spikeRate && rnd() < spec.spikeRate) {
      const lms = ['shoulderL', 'hipL', 'kneeL', 'ankleL', 'elbowL', 'wristL'].filter(n => j3[n] && NAME_TO_LM[n] !== undefined)
      const pick = NAME_TO_LM[lms[Math.floor(rnd() * lms.length)]]
      const amp = 0.18 + 0.12 * rnd() // 画像の高さに対する長さ
      const ang = rnd() * 2 * Math.PI
      pose[pick] = { ...pose[pick], x: pose[pick].x + (amp * Math.cos(ang)) / aspect, y: pose[pick].y + amp * Math.sin(ang) }
      spikes.push({ frame: i, landmark: pick })
    }

    // 隠れ
    let missing = false
    for (const o of occ) {
      const ts = t / 1000
      if (ts < o.startS || ts >= o.startS + o.durS) continue
      if (o.mode === 'missing') { missing = true; continue }
      const lm = SIDE_INDEX[o.side === 'near' ? 'left' : 'right'][o.joint]
      const other = SIDE_INDEX[o.side === 'near' ? 'right' : 'left'][o.joint]
      if (o.mode === 'lowVis') {
        pose[lm] = {
          ...pose[lm], x: pose[lm].x + 0.03 * gauss(rnd), y: pose[lm].y + 0.03 * gauss(rnd), visibility: 0.2,
        }
      } else {
        const x = (ts - o.startS) / o.durS
        const w = Math.min(1, x / 0.25, (1 - x) / 0.25)
        pose[lm] = {
          ...pose[lm],
          x: pose[lm].x + (pose[other].x - pose[lm].x) * w,
          y: pose[lm].y + (pose[other].y - pose[lm].y) * w,
          visibility: 0.6,
        }
      }
    }
    frames.push({ t, pose: missing ? undefined : pose, world: missing ? undefined : world })
  }

  return { frames, truth: tl.truth, trueAngles, spikes, aspect, fps, nearSide: 'left' }
}
