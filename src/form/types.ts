/**
 * 動画フォーム採点の「受け渡しの約束」。
 * - 計算部分（src/form/engine.ts）と画面（src/components/FormCheck*.tsx）はこの型だけでつながる。
 * - 姿勢推定は MediaPipe Pose Landmarker（33点、座標は画像に対して 0〜1 の正規化値）。
 */

/** MediaPipe の1点。x, y は 0〜1（左上が原点）、visibility は 0〜1 */
export interface Landmark {
  x: number
  y: number
  z: number
  visibility?: number
}

/** 33点の配列（MediaPipe の並び） */
export type Pose = Landmark[]

/** MediaPipe Pose の主な関節の番号 */
export const LM = {
  nose: 0,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
} as const

/** 採点に対応している種目（真横から撮影） */
export type FormExerciseKey = 'squat' | 'bench' | 'curl'

export type Phase = 'idle' | 'top' | 'down' | 'bottom' | 'up'

/** 減点の理由と直し方 */
export interface Issue {
  code: string
  /** 何が起きたか（例「しゃがみが浅い」） */
  message: string
  /** 直し方（例「太ももが床と平行になるまでしゃがみましょう」） */
  fix: string
  /** 減点 */
  penalty: number
}

export interface RepResult {
  /** 1 始まり */
  index: number
  /** 0〜100 */
  score: number
  /** 主関節の可動域（度） = 最大角度 − 最小角度 */
  romDeg: number
  /** 基準に対する可動域の割合（基準がなければ undefined） */
  romPct?: number
  /** 下ろす動作の秒数 */
  eccentricSec: number
  /** 上げる動作の秒数 */
  concentricSec: number
  /** 最小角度（最も曲がった位置） */
  minAngle: number
  /** 最大角度（最も伸びた位置） */
  maxAngle: number
  issues: Issue[]
}

export interface FrameResult {
  /** 必要な関節が見えているか（visibility が低いと false） */
  visible: boolean
  /** 主な角度（度）。キーは 'knee' 'hip' 'elbow' 'torso' など */
  angles: Record<string, number>
  phase: Phase
  /** これまでに完了したレップ（この push で増えることがある） */
  reps: RepResult[]
  /** 今すぐ画面に出す短い注意（例「もう少し深く」）。なければ undefined */
  cue?: string
}

export interface Baseline {
  romDeg: number
  minAngle: number
  maxAngle: number
}

export interface SetSummary {
  reps: number
  /** 平均点（四捨五入）。レップ0なら 0 */
  avgScore: number
  /** 回数の多い順に最大3件（同じ code はまとめる） */
  mainIssues: Issue[]
  /** 伸びた位置まで動かせたか（可動域の割合が 90% 以上、基準がなければ種目の既定値で判定） */
  lengthenedOk: boolean
}
