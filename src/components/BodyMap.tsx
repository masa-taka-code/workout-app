import type { Muscle } from '../types'

export interface BodyMapProps {
  /** 筋肉ごとの強さ 0〜1（0 または未指定は塗らない） */
  highlights: Partial<Record<Muscle, number>>
  /** 'sm' は種目カード用の小さな表示、'md' は分析画面用 */
  size?: 'sm' | 'md'
  /** 読み上げ用の説明 */
  label?: string
}

// 仮。implementer が人体図（前面・背面）を実装する。
export default function BodyMap(_props: BodyMapProps) {
  return null
}
