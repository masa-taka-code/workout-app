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
  /** v2 の計測値（計測側が埋める。古いテストの互換のため省略可） */
  metrics?: RepMetrics
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
  /** 基準レップの体幹の前傾の最大（squat のみ。forward-lean を本人基準 +15° で判定するため） */
  trunkLeanMax?: number
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

// ---------------------------------------------------------------------------
// v2：精度・効き・ストレッチ・崩れの原因（設計書「フォーム解析 v2」）
// 計測（engine.ts / measure.ts）が RepMetrics を埋め、分析（analysis.ts）が FormReport を作る。
// ---------------------------------------------------------------------------

/** 撮影の向き */
export type ViewKind = 'side' | 'front' | 'oblique' | 'unknown'
/** 撮影角度の良否：真横からのずれ ≤15° ok、15〜30° caution、>30° ng（正面の種目指標は別判定） */
export type ViewOk = 'ok' | 'caution' | 'ng'

/** 1レップの計測値（推定を含む）。値が出せないものは undefined */
export interface RepMetrics {
  /** 信頼度 0〜1（見えやすさ × 撮影角度 × 体節長の安定 × 欠損の少なさ）。0.6 未満は減点・原因判定に使わない */
  confidence: number
  view: ViewKind
  viewOk: ViewOk
  /** 上げる動作の平均速度（m/s、推定。腰＝squat、手首＝bench/curl の上下動から） */
  concentricVelocity?: number
  /** そのセットの最初の2レップの最大速度に対する低下率（%） */
  velocityLossPct?: number
  /** 上げる動作で最初の速度ピーク後に最も遅くなった時点の主関節角度（スティッキングポイント） */
  stickingAngle?: number
  /** 主関節の伸張側の範囲にいた時間の割合 0〜1（stretch の滞在率 T） */
  timeInStretch?: number
  // --- squat ---
  /** 最下点の膝屈曲（度、180 − 膝の内角） */
  kneeFlexionBottom?: number
  /** レップ中の体幹の前傾（鉛直からの角度）の最大 */
  trunkLeanMax?: number
  /** 最下点のすねの前傾（鉛直からの角度） */
  shinLeanBottom?: number
  /** 最下点の体幹の前傾（鉛直からの角度） */
  trunkLeanBottom?: number
  /** 最下点での股関節モーメントの割合 0〜1（バー≒肩の水平位置から股関節・膝までの水平距離の比） */
  hipMomentShare?: number
  /** かかとの浮き（つま先に対するかかとの上昇量の最大、脚の長さに対する比） */
  heelLift?: number
  /** 正面撮影のときの膝の内側への倒れ込み（膝の投影角、度。2D の見かけの値で、3D の外反とは一致しない） */
  kneeValgusDeg?: number
  // --- bench ---
  /** 手首の水平方向のずれ（そのセットの1レップ目の軌道との差の最大、前腕の長さに対する比） */
  barPathDrift?: number
  /** 上げる動作中の腰の持ち上がり（胴の長さに対する比） */
  hipRise?: number
  // --- curl ---
  /** 上腕の前後の振れ（度） */
  upperArmRange?: number
  /** 体幹の振れ（度） */
  torsoRange?: number
  /** 最下点（伸ばしきり）での肩の角度：上腕と体幹のなす角（後ろ＝マイナス、前＝プラス。度） */
  shoulderAngleAtBottom?: number
}

/** 原因の種類 */
export type CauseKind = 'strength' | 'mobility' | 'technique' | 'fatigue' | 'load' | 'structure'
export type Confidence = 'high' | 'mid' | 'low'

export interface CauseCandidate {
  cause: CauseKind
  confidence: Confidence
  /** 判断の手がかり（例「1レップ目から出ていて、軽い重量の日も同じ」） */
  reason: string
}

export interface FaultFinding {
  code: string
  /** 崩れの名前（例「上体の前傾が大きい」） */
  label: string
  /** 起きたレップ番号（1 始まり） */
  reps: number[]
  /** 確信度の高い順。確信度「低」しかないときは原因を言わずセルフチェックへ誘導する */
  causes: CauseCandidate[]
  /** 外的焦点の短いキュー（例「床を外に押し広げる」） */
  cue: string
  /** 補強・改善の練習 */
  drills: string[]
  /** セルフチェック（例：膝-壁テストの手順） */
  selfCheck?: string
  /** 関係しうる筋肉と、その根拠の強さ（断定しない） */
  muscleHint?: string
  /** 出典（著者 年） */
  evidence?: string
}

/** 効かせたい部位の選択肢（種目ごとに analysis.ts が定義） */
export interface EmphasisTarget {
  id: string
  label: string
}

export interface EmphasisShare {
  label: string
  muscles: import('../types').Muscle[]
  /** 0〜1（合計 1）。比率を出せない種目は undefined（向きだけ） */
  share?: number
}

export interface FormReport {
  /** 0〜100（v1 の採点の平均） */
  overallScore: number
  /** レップの信頼度の平均 0〜1 */
  confidence: number
  view: ViewKind
  viewOk: ViewOk
  /** 撮り直しをすすめる理由（なければ undefined） */
  retakeReason?: string
  stretch?: {
    /** 0〜100（推定） */
    score: number
    /** 到達度 0〜1 の平均 */
    reach: number
    /** 到達度 0.9 以上のレップの割合 */
    consistency: number
    /** 伸張側にいた時間の割合の平均 */
    timeInStretch?: number
    /** 何と比べたか（例「論文の基準（膝屈曲 90〜140°）」「あなたの基準動画」） */
    reference: string
  }
  emphasis: {
    distribution: EmphasisShare[]
    /** 負荷配分の段階の名前（例「やや股関節寄り」）。段階に分けない種目は undefined */
    level?: string
    /** 選んだ狙いの部位 */
    target?: {
      id: string
      label: string
      /** 狙いの部位への配分 0〜1（出せない種目は undefined） */
      share?: number
      /** 効き具合スコア 0〜100（推定） */
      score?: number
      /** 狙いに効かせるためのコツ（根拠つき） */
      tips: string[]
    }
    note: string
  }
  effort: {
    velocityLossPct?: number
    /** 筋肥大向けの目安（速度低下 25% 以上）にどれだけ届いたか 0〜1（squat・bench のみ。Hickmott 2022） */
    proximity?: number
    source: 'velocity' | 'none'
  }
  faults: FaultFinding[]
  /** 1セットに1つだけ出すキュー（安全に関わるもの ＞ 基準からのずれが最大のもの） */
  primaryCue?: string
  /** 過去の記録との比較（例「前回より伸張位の到達が +8 点」） */
  trend?: string
  /** 必ず表示する注意（推定であること、痛みがあれば中止） */
  disclaimer: string
}

/** セッションをまたいだ原因判定のために保存する、1セット分の要約 */
export interface FormSessionSummary {
  date: string
  exerciseId: string
  key: FormExerciseKey
  /** そのセットの重量（kg、分からなければ 0） */
  weight: number
  reps: number
  avgScore: number
  stretchScore?: number
  /** 崩れの code ごとの発生レップ数 */
  faultCounts: Record<string, number>
  confidence: number
}

/** 分析に渡す文脈 */
export interface FormContext {
  key: FormExerciseKey
  exerciseId: string
  /** このセットの重量（kg、分からなければ 0） */
  weight: number
  /** 直近の同種目の最大重量（kg、なければ undefined） */
  recentBestWeight?: number
  /** 過去のフォーム要約（新しい順） */
  history: FormSessionSummary[]
  baseline?: Baseline
  targetId?: string
}
