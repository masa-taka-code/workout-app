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
}

export interface SetLog {
  weight: number
  reps: number
  done: boolean
  /** あと何回できたか (Reps In Reserve)。未入力なら目標RIRどおりとみなす */
  rir?: number
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
}

export type Condition = 'good' | 'normal' | 'bad'

export interface Entry {
  exerciseId: string
  sets: SetLog[]
  /** このセッション開始時に提示された目標（達成率の計算に使う） */
  target?: Target
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
}
