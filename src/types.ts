export type BodyPart = '胸' | '背中' | '脚' | '肩' | '腕' | '腹' | 'その他'

export const BODY_PARTS: BodyPart[] = ['胸', '背中', '脚', '肩', '腕', '腹', 'その他']

/** 週ボリュームを数える単位の筋肉 */
export type Muscle =
  | '胸' | '背中' | '肩前部' | '肩側部' | '肩後部'
  | '上腕二頭筋' | '上腕三頭筋' | '大腿四頭筋' | 'ハムストリング' | '臀筋' | 'ふくらはぎ' | '腹筋'

export const MUSCLES: Muscle[] = [
  '胸', '背中', '肩前部', '肩側部', '肩後部', '上腕二頭筋', '上腕三頭筋',
  '大腿四頭筋', 'ハムストリング', '臀筋', 'ふくらはぎ', '腹筋',
]

/**
 * 種目。repMin〜repMax の範囲でレップを伸ばし、上限に届いたら increment だけ重量を上げる（ダブルプログレッション）。
 * 週ボリュームは主働筋 1 セット、補助筋 0.5 セットで数える（部分セット）。
 */
export interface Exercise {
  id: string
  name: string
  part: BodyPart
  repMin: number
  repMax: number
  /** 重量を上げるときの刻み (kg) */
  increment: number
  /** 標準のセット数 */
  sets: number
  /** 目標の残り回数 (RIR)。多関節 1〜2、単関節 0〜1 が目安 */
  targetRir: number
  primary: Muscle[]
  secondary: Muscle[]
  /** 器具。barbell のときだけプレート計算を出す。未設定は other 扱い */
  equipment?: Equipment
}

export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'bodyweight' | 'other'

export const EQUIPMENTS: { value: Equipment; label: string }[] = [
  { value: 'barbell', label: 'バーベル' },
  { value: 'dumbbell', label: 'ダンベル' },
  { value: 'machine', label: 'マシン・ケーブル' },
  { value: 'bodyweight', label: '自重' },
  { value: 'other', label: 'その他' },
]

export interface SetLog {
  weight: number
  reps: number
  done: boolean
  /** あと何回できたか (Reps In Reserve)。未入力なら目標RIRどおりとみなす */
  rir?: number
  /** セットごとのメモ（痛み・感覚など） */
  note?: string
  /**
   * 限界テストのセット。目標回数の時点で RIR を予測して rir に記録し、そのまま限界まで続けて reps に総回数を記録する。
   * 誤差 = (reps − target.reps) − rir
   */
  amrap?: boolean
  /** 動画フォーム採点の平均点（0〜100） */
  formScore?: number
}

/** 種目を終えたあとの振り返り（0〜2 の3段階） */
export interface Feedback {
  /** パンプ：0 弱い / 1 ふつう / 2 強い */
  pump?: 0 | 1 | 2
  /** きつさ：0 楽 / 1 ちょうど / 2 きつい */
  workload?: 0 | 1 | 2
  /** 前回この種目をやったあとの筋肉痛：0 なし / 1 ちょうど回復 / 2 まだ残っている */
  soreness?: 0 | 1 | 2
  /** 関節の痛みがあったか */
  joint?: boolean
}

export interface Schedule {
  /** トレーニングする曜日（0=日〜6=土） */
  days: number[]
  /** 開始時刻 HH:MM */
  time: string
}

export type TargetKind = 'first' | 'increase' | 'reps' | 'deload'

export interface Target {
  kind: TargetKind
  /** 0 は「未定（初回）」 */
  weight: number
  reps: number
  sets: number
  rir: number
  reason: string
  /** 注意表示（不調の日など）。量は変えない */
  caution?: string
  /** 最終セットを限界テスト（RIR の答え合わせ）にする */
  amrap?: boolean
}

export type Condition = 'good' | 'normal' | 'bad'

export interface Entry {
  exerciseId: string
  sets: SetLog[]
  /** このセッション開始時に提示された目標（達成率の計算に使う） */
  target?: Target
  feedback?: Feedback
}

export interface Session {
  id: string
  /** YYYY-MM-DD */
  date: string
  entries: Entry[]
  bodyWeight?: number
  condition?: Condition
  note?: string
}

export interface AppData {
  version: 1
  exercises: Exercise[]
  sessions: Session[]
  restSeconds: number
  /** 筋肉ごとの週の目標部分セット数（10 から始めて上限 20） */
  weeklyTargets: Partial<Record<Muscle, number>>
  /** 週目標の見直し（rampWeeklyTargets）を最後に行った週の月曜日 */
  lastRampWeek?: string
  /** 休憩終了の音を鳴らすか（未設定は鳴らす） */
  sound?: boolean
  /** トレーニングの予定（曜日と時刻） */
  schedule?: Schedule
  /** 動画フォーム採点の基準（自分の良いフォームの可動域）。種目キーごと */
  formBaselines?: Partial<Record<string, { romDeg: number; minAngle: number; maxAngle: number; savedAt: string }>>
}

/** 各画面に渡す props */
export interface ScreenProps {
  data: AppData
  setData: (update: (prev: AppData) => AppData) => void
}
