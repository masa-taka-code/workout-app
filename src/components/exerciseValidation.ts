import type { BodyPart, Exercise, Muscle } from '../types'
import { BODY_PARTS, MUSCLES } from '../types'

/** フォームの入力中の値（id は持たない） */
export type ExerciseDraft = Omit<Exercise, 'id'>

export type ExerciseErrors = Partial<Record<'name' | 'part' | 'rep' | 'increment' | 'sets' | 'targetRir' | 'primary' | 'secondary', string>>

export const newDraft = (): ExerciseDraft => ({
  name: '',
  part: '胸' as BodyPart,
  repMin: 6,
  repMax: 10,
  increment: 2.5,
  sets: 3,
  targetRir: 2,
  primary: [],
  secondary: [],
})

/**
 * 種目の入力を検証する。エラーがなければ空オブジェクトを返す。
 * others は自分以外の既存種目（同名チェック用）。
 */
export function validateExercise(draft: ExerciseDraft, others: Pick<Exercise, 'name'>[]): ExerciseErrors {
  const errors: ExerciseErrors = {}
  const name = draft.name.trim()
  if (!name) errors.name = '名前を入力してください'
  else if (others.some(o => o.name.trim() === name)) errors.name = '同じ名前の種目がすでにあります'

  if (!BODY_PARTS.includes(draft.part)) errors.part = '部位を選んでください'

  const { repMin, repMax } = draft
  if (!Number.isInteger(repMin) || !Number.isInteger(repMax)) errors.rep = 'レップ数は整数で入力してください'
  else if (repMin < 1 || repMax > 50) errors.rep = 'レップ数は1〜50の範囲で入力してください'
  else if (repMin >= repMax) errors.rep = '下限は上限より小さくしてください'

  if (!(Number.isFinite(draft.increment) && draft.increment > 0)) errors.increment = '刻みは0より大きい数にしてください'

  if (!Number.isInteger(draft.sets) || draft.sets < 1 || draft.sets > 10) errors.sets = 'セット数は1〜10で入力してください'

  if (!Number.isInteger(draft.targetRir) || draft.targetRir < 0 || draft.targetRir > 4) errors.targetRir = '目標RIRは0〜4で選んでください'

  if (draft.primary.length === 0) errors.primary = '主働筋を1つ以上選んでください'
  if (draft.primary.some(m => draft.secondary.includes(m))) errors.secondary = '同じ筋肉を主働筋と補助筋の両方には入れられません'
  if ([...draft.primary, ...draft.secondary].some(m => !MUSCLES.includes(m))) errors.primary = '筋肉の指定が正しくありません'

  return errors
}

/** 保存用に整える（名前の空白除去、筋肉は MUSCLES の順） */
export function normalizeDraft(draft: ExerciseDraft): ExerciseDraft {
  const order = (list: Muscle[]) => MUSCLES.filter(m => list.includes(m))
  return { ...draft, name: draft.name.trim(), primary: order(draft.primary), secondary: order(draft.secondary) }
}

export type MuscleRole = 'none' | 'primary' | 'secondary'

/** 筋肉のタップ切替：なし → 主 → 補助 → なし。同じ筋肉が両方に入ることはない */
export function cycleMuscle(draft: ExerciseDraft, m: Muscle): ExerciseDraft {
  const without = (list: Muscle[]) => list.filter(x => x !== m)
  if (draft.primary.includes(m)) return { ...draft, primary: without(draft.primary), secondary: [...draft.secondary, m] }
  if (draft.secondary.includes(m)) return { ...draft, secondary: without(draft.secondary) }
  return { ...draft, primary: [...draft.primary, m] }
}
