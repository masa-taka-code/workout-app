/**
 * 動画フォーム採点の「受け渡しの約束」。
 * - 計算部分（src/form/engine.ts）と画面（src/components/FormCheck*.tsx）はこの型だけでつながる。
 * - 姿勢推定は MediaPipe Pose Landmarker（33点、座標は画像に対して 0〜1 の正規化値）。
 */
import type { Side } from './rules'

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
export type FormExerciseKey =
  | 'squat' | 'bench' | 'curl'
  | 'rdl' | 'ohp' | 'lateral' | 'pulldown' | 'ohext' | 'bss'

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

/**
 * 関節1点の出どころ（見えない部分の補正。fill.ts）。
 * measured＝見えている（visibility が十分で外れ値でもない）／interpolated＝短い欠けを前後のコマから補間／
 * mirrored＝手前の関節が長く見えず、奥側の同じ関節で代用／missing＝埋められなかった
 */
export type JointSource = 'measured' | 'interpolated' | 'mirrored' | 'missing'

/** 1レップの計測値（推定を含む）。値が出せないものは undefined */
export interface RepMetrics {
  /** 信頼度 0〜1（見えやすさ × 撮影角度 × 体節長の安定 × 欠損の少なさ）。0.6 未満は減点・原因判定に使わない */
  confidence: number
  view: ViewKind
  viewOk: ViewOk
  /**
   * 撮影条件（枠・距離・向き・傾き・見えやすさ）が許容内だったか。レップのフレームの半分以上が ng なら false。
   * false のレップは回数には数えるが、減点・崩れの判定・採点の平均から外す。判定していない（古い記録・動画の一部）は undefined
   */
  placementOk?: boolean
  /**
   * レップの中で、必要な関節のどれかが measured でなかったコマ（補間・代用・埋められなかった）の割合 0〜1。
   * 0 のときは付けない。信頼度は ×(1 − 0.5×この値)、安全に関わる崩れは 0.2 以上のとき出さない（設計値・暫定）
   */
  estimatedRatio?: number
  /**
   * 最下点（主関節の最小角度のコマ）の前後 3 コマ以内に、主関節の 3 点のどれかが measured でないコマがあったか。
   * true のレップは「浅い」系の崩れの確信度を low にし、減点しない（深さは推定のため）
   */
  bottomEstimated?: boolean
  /** 奥側の関節で代用したコマがあったか（確信度は代用したコマの分だけ ×0.7。設計値・暫定） */
  mirrored?: boolean
  /** world 座標を信用できたか（world.ts の judgeWorldTrust）。false のとき、φ は 2D の比で判定し、速度をメートルに換算しない。world が無いときは付けない */
  worldTrust?: boolean
  /** 真横（lateral は正面）からのずれ φ（度。judgeView の値そのまま。world が無ければ undefined）。自分の基準の撮影条件の比較に使う */
  phiDeg?: number
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
  // --- rdl / ohp / lateral / pulldown / ohext / bss（追加6種目） ---
  /** 最下点の股関節屈曲（度、180 − 肩-股関節-膝の内角）。rdl */
  hipFlexionBottom?: number
  /** 最下点の膝の内角（度）。rdl（膝の曲げすぎの判定用） */
  kneeAngleBottom?: number
  /** レップ中の体幹の後傾の最大（鉛直から後ろへの角度、前傾は 0）。ohp・pulldown */
  trunkLeanBack?: number
  /** そのレップの開始時（top の時点）の後傾。ohp（反りの増加を見る） */
  trunkLeanBackBaseline?: number
  /** レップ中の肩外転の最大（左右の大きい方、度）。lateral */
  abductionTop?: number
  /** 上げきった時点の左右の外転角の差（度）。lateral（参考表示のみ） */
  abductionAsymmetry?: number
  /** 最下点の肘の屈曲（度、180 − 肘の内角）。ohext・ohp */
  elbowFlexionBottom?: number
  /** レップの開始・終了時（伸ばしきり側）の肘の内角の最大（度）。pulldown */
  elbowExtensionTop?: number
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
  /** 自分の基準を使わなかった理由（撮影条件が基準と違うとき。画面の注記欄に出す） */
  baselineNote?: string
  /** 見えなかった関節を補った・判定しなかったことの注記（1 行ずつ。画面の注記欄に出す。なければ undefined） */
  notes?: string[]
  /** 必ず表示する注意（推定であること、痛みがあれば中止） */
  disclaimer: string
}

/**
 * 開始前の立位フレームから取る、その人・その撮影の基準値（「自分の基準」で使う。値だけで UI は無い）。
 * 座標は縦横比をそろえた 2D で、画面の高さを 1 とした長さ。体幹角・傾きは傾き補正前の値。
 */
export interface StandingSnapshot {
  /** 脚の種目は太もも、腕の種目は上腕の長さ */
  segA: number
  /** 脚の種目はすね、腕の種目は前腕の長さ */
  segB: number
  /** 立位の体幹角（鉛直からの前傾、度） */
  trunkLeanDeg?: number
  /** 真横からのずれ φ（度。world があるときだけ） */
  phiDeg?: number
  /** スマホの傾き（度。不明なら undefined） */
  tiltDeg?: number
  /** 計測に使った側（見えやすい側）。自分の基準の撮影条件の比較に使う */
  side?: Side
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
  /** 開始前の立位から取った基準値（撮影条件の判定を通ったライブ撮影のときだけ） */
  standing?: StandingSnapshot
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
  /** 旧形式の基準（可動域の中央値など。analyzeSet は personal があればそれから作り直す） */
  baseline?: Baseline
  /** 自分の基準（複数レップの中央値）。撮影条件が合うときだけ崖の判定に使う（baseline.ts） */
  personal?: PersonalBaseline
  targetId?: string
  /** スマホの水平が不明（センサー非対応・拒否・動画ファイル）だったか。体幹の前傾の崩れの確信度を low にする */
  tiltUnknown?: boolean
  /** 開始前の立位から取った基準値（要約に保存する） */
  standing?: StandingSnapshot
}

// ---------------------------------------------------------------------------
// 自分の基準（B4）：条件の良い複数レップの中央値。計算は baseline.ts
// ---------------------------------------------------------------------------

/** 中央値と、ばらつき（1.4826×MAD。3 レップ未満なら 0） */
export interface BaselineStat {
  med: number
  mad: number
}

export type BaselineMetric =
  | 'minAngle' | 'maxAngle' | 'romDeg' | 'kneeFlexionBottom' | 'trunkLeanMax'
  | 'hipFlexionBottom' | 'elbowFlexionBottom' | 'elbowExtensionTop' | 'heelLift'

/** 基準を取ったときの撮影条件（今の撮影と比べて、使えるかを決める） */
export interface BaselineConditions {
  source: 'live' | 'file'
  view: ViewKind
  phiDeg?: number
  tiltDeg?: number
  side?: Side
  /** 立位の太もも＋すね、または上腕＋前腕（画面高比）。StandingSnapshot から */
  segLen?: number
}

export interface PersonalBaseline {
  version: 2
  key: FormExerciseKey
  savedAt: string
  /** 基準を取ったセットの重量（kg、分からなければ 0） */
  weight: number
  repCount: number
  stats: Partial<Record<BaselineMetric, BaselineStat>>
  conditions: BaselineConditions
  /** 基準に使ったレップの半数以上で、一般のしきい値の崩れが出た code */
  belowGeneral: string[]
  /** 旧形式（1 レップ）から読み替えたもの */
  legacy?: true
}
