/** 種目ごとの主関節・しきい値・減点ルール */
import type { FormExerciseKey, Issue, Landmark, Pose } from './types'
import { LM } from './types'
import { jointAngle, signedTiltFromVertical, tiltFromVertical } from './geometry'

export type Side = 'left' | 'right'
export type Joint = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle'

export const SIDE_INDEX: Record<Side, Record<Joint, number>> = {
  left: {
    shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist,
    hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle,
  },
  right: {
    shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist,
    hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle,
  },
}

export interface FormConfig {
  /** 主関節の角度の名前 */
  main: 'knee' | 'elbow' | 'hip' | 'shoulder'
  /** 伸びた状態とみなす角度（これを超えたら top） */
  top: number
  /** 必要な関節 */
  joints: Joint[]
  /** 下ろす動作（eccentric）が前半か */
  eccentricFirst: boolean
}

export const CONFIG: Record<FormExerciseKey, FormConfig> = {
  squat: { main: 'knee', top: 160, joints: ['shoulder', 'hip', 'knee', 'ankle'], eccentricFirst: true },
  bench: { main: 'elbow', top: 155, joints: ['shoulder', 'elbow', 'wrist'], eccentricFirst: true },
  curl: { main: 'elbow', top: 130, joints: ['shoulder', 'elbow', 'wrist', 'hip'], eccentricFirst: false },
  // 追加6種目の top はすべて暫定
  // rdl：主関節は股関節（肩-股関節-膝の内角）
  rdl: { main: 'hip', top: 160, joints: ['shoulder', 'hip', 'knee', 'ankle'], eccentricFirst: true },
  ohp: { main: 'elbow', top: 150, joints: ['shoulder', 'elbow', 'wrist', 'hip'], eccentricFirst: true },
  // lateral：主関節は肩の外転を 180 から引いたもの（180 − 外転角。腕を下ろした状態が約 180°）。上げる動作が前半
  lateral: { main: 'shoulder', top: 150, joints: ['shoulder', 'elbow', 'wrist', 'hip'], eccentricFirst: false },
  // pulldown：バーを引き下ろす（肘が曲がる）動作が前半
  // top は 130（150 だと「上で伸ばしきらない（<150）」レップが数えられず、partial-top が出ない。curl と同じ理由）
  pulldown: { main: 'elbow', top: 130, joints: ['shoulder', 'elbow', 'wrist', 'hip'], eccentricFirst: false },
  ohext: { main: 'elbow', top: 150, joints: ['shoulder', 'elbow', 'wrist'], eccentricFirst: true },
  // bss：主関節は前脚の膝（前脚の選び方は RepTracker.pickSide）
  bss: { main: 'knee', top: 160, joints: ['shoulder', 'hip', 'knee', 'ankle'], eccentricFirst: true },
}

/** 脚（太もも・すね）で体節長・速度を見る種目 */
export function isLegKey(key: FormExerciseKey): boolean {
  return key === 'squat' || key === 'rdl' || key === 'bss'
}

/** 肩の外転角（度）：肩→股関節の線と肩→肘の線のなす角。腕を下ろしていれば 0、真横に上げれば 90。見えていなければ undefined */
export function abductionOf(pose: Pose, side: Side): number | undefined {
  const idx = SIDE_INDEX[side]
  const s = pose[idx.shoulder]
  const e = pose[idx.elbow]
  const h = pose[idx.hip]
  if (!s || !e || !h) return undefined
  if ([s, e, h].some(q => (q.visibility ?? 0) < MIN_VISIBILITY)) return undefined
  return jointAngle(h, s, e)
}

/** 1点が見えているとみなす visibility の下限 */
export const MIN_VISIBILITY = 0.5

/** pose（縦横比補正済みの全点）は lateral が左右の腕を比べるときだけ使う */
export function computeAngles(key: FormExerciseKey, p: Record<Joint, Landmark>, pose?: Pose): Record<string, number> {
  if (key === 'squat') {
    return {
      knee: jointAngle(p.hip, p.knee, p.ankle),
      hip: jointAngle(p.shoulder, p.hip, p.knee),
      torso: tiltFromVertical(p.hip, p.shoulder),
    }
  }
  if (key === 'bench') {
    return { elbow: jointAngle(p.shoulder, p.elbow, p.wrist) }
  }
  if (key === 'rdl') {
    return {
      hip: jointAngle(p.shoulder, p.hip, p.knee),
      knee: jointAngle(p.hip, p.knee, p.ankle),
      torso: tiltFromVertical(p.hip, p.shoulder),
    }
  }
  if (key === 'bss') {
    return {
      knee: jointAngle(p.hip, p.knee, p.ankle),
      torso: tiltFromVertical(p.hip, p.shoulder),
    }
  }
  if (key === 'ohp' || key === 'pulldown') {
    return {
      elbow: jointAngle(p.shoulder, p.elbow, p.wrist),
      torso: tiltFromVertical(p.hip, p.shoulder),
      trunkSigned: signedTiltFromVertical(p.hip, p.shoulder),
    }
  }
  if (key === 'ohext') {
    return { elbow: jointAngle(p.shoulder, p.elbow, p.wrist) }
  }
  if (key === 'lateral') {
    // 左右の腕の外転のうち大きい方で数える。片側しか見えなければその側だけ
    const out: Record<string, number> = {
      torso: tiltFromVertical(p.hip, p.shoulder),
      trunkSigned: signedTiltFromVertical(p.hip, p.shoulder),
    }
    const l = pose ? abductionOf(pose, 'left') : undefined
    const r = pose ? abductionOf(pose, 'right') : undefined
    if (l !== undefined) out.abdL = l
    if (r !== undefined) out.abdR = r
    const best = Math.max(l ?? -Infinity, r ?? -Infinity)
    out.shoulder = 180 - (Number.isFinite(best) ? best : jointAngle(p.hip, p.shoulder, p.elbow))
    return out
  }
  return {
    elbow: jointAngle(p.shoulder, p.elbow, p.wrist),
    upperArm: jointAngle(p.elbow, p.shoulder, p.hip),
    torso: tiltFromVertical(p.hip, p.shoulder),
  }
}

export function makeIssue(code: string, message: string, fix: string, penalty: number): Issue {
  return { code, message, fix, penalty }
}

/** 1レップ中の統計（採点の入力） */
export interface RepStats {
  minAngle: number
  maxAngle: number
  /** 主関節以外の角度のレップ中の最小・最大 */
  ranges: Record<string, { min: number; max: number }>
  /** 最も曲がった時点の股関節・膝の y（squat のみ） */
  hipY?: number
  kneeY?: number
}

/** 主関節の可動域・時間以外の、種目ごとの減点 */
export function formIssues(key: FormExerciseKey, s: RepStats): Issue[] {
  const out: Issue[] = []
  const span = (name: string) => {
    const r = s.ranges[name]
    return r ? r.max - r.min : 0
  }
  if (key === 'squat') {
    if (s.hipY !== undefined && s.kneeY !== undefined && s.hipY < s.kneeY - 0.02 && s.minAngle > 95) {
      out.push(makeIssue('shallow', 'しゃがみが浅い', '太ももが床と平行になるまでしゃがみましょう（伸びた位置まで動かすほど筋肥大に有利）', 30))
    }
    if ((s.ranges.torso?.max ?? 0) > 55) {
      out.push(makeIssue('lean', '上体が前に倒れすぎ', '胸を張り、目線を前に。かかとに体重を乗せましょう', 15))
    }
  } else if (key === 'bench') {
    if (s.minAngle > 100) {
      out.push(makeIssue('shallow', 'バーを胸まで下ろせていない', '胸に軽く触れるまで下ろしましょう', 25))
    }
  } else if (key === 'curl') {
    if (s.maxAngle < 150) {
      out.push(makeIssue('partial-bottom', '腕を伸ばしきれていない', '下で肘を伸ばしきると、伸びた位置で負荷がかかり効果的です', 25))
    }
    if (s.minAngle > 60) {
      out.push(makeIssue('partial-top', '上まで巻き上げられていない', '手首が肩に近づくまで曲げましょう', 10))
    }
    if (span('upperArm') > 25) {
      out.push(makeIssue('swing', '肘が前後に動いている', '肘を体の横に固定しましょう', 15))
    }
    if (span('torso') > 15) {
      out.push(makeIssue('body-english', '反動を使っている', '上体を動かさず、重量を下げてでも腕だけで挙げましょう', 10))
    }
  }
  return out
}
