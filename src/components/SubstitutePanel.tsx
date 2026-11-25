import type { AppData, Entry, Exercise } from '../types'

/** 置き換え先。既存の種目ならそのもの、カタログ等の新しい種目なら id なし */
export type ReplaceWith = Exercise | Omit<Exercise, 'id'>

interface Props {
  ex: Exercise
  entry: Entry
  data: AppData
  onReplace: (next: ReplaceWith) => void
}

// 仮。implementer が種目の代わりの提案を実装する。
export default function SubstitutePanel(_props: Props) {
  return null
}
