export type BodyPart = '胸' | '背中' | '脚' | '肩' | '腕' | '腹' | 'その他'

export const BODY_PARTS: BodyPart[] = ['胸', '背中', '脚', '肩', '腕', '腹', 'その他']

/** 種目。repMin〜repMax の範囲でレップを伸ばし、上限に届いたら increment だけ重量を上げる（ダブルプログレッション） */
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
}

export interface SetLog {
  weight: number
  reps: number
  done: boolean
}

export interface Target {
  weight: number
  reps: number
  reason: string
}

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
  note?: string
}

export interface AppData {
  version: 1
  exercises: Exercise[]
  sessions: Session[]
  restSeconds: number
}
