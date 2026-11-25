import type { Entry, Exercise, Feedback } from '../types'

interface Props {
  ex: Exercise
  entry: Entry
  onChange: (feedback: Feedback) => void
}

// 仮。implementer が種目後の振り返り入力を実装する。
export default function FeedbackPanel(_props: Props) {
  return null
}
