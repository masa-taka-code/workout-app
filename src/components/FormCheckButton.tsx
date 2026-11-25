import type { AppData, Entry, Exercise } from '../types'

export interface FormCheckButtonProps {
  ex: Exercise
  entry: Entry
  data: AppData
  /** 撮影したセットの結果を、今日の次の未完了セットに反映する */
  onApply: (result: { reps: number; formScore: number }) => void
  /** 基準（良いフォームの可動域）を保存する */
  onSaveBaseline: (key: string, baseline: { romDeg: number; minAngle: number; maxAngle: number }) => void
}

// 仮。implementer が「フォームを撮影」ボタンと撮影画面を実装する。
export default function FormCheckButton(_props: FormCheckButtonProps) {
  return null
}
