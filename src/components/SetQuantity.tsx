import './SetQuantity.css'

const num = (n: number) => String(Math.round(n * 100) / 100)

/** 「60kg × 10回」。数字は親の文字サイズ、単位と「×」はその 0.65 倍で書く。重量が未定（0）なら全体を小さく「重量を決める × 6回」 */
export default function SetQuantity({ weight, reps }: { weight: number; reps: number }) {
  if (weight <= 0) {
    return (
      <span className="qty qty-undecided">
        重量を決める × {reps}回
      </span>
    )
  }
  return (
    <span className="qty">
      {num(weight)}
      <span className="qty-u">kg</span>
      <span className="qty-u qty-x">×</span>
      {reps}
      <span className="qty-u">回</span>
    </span>
  )
}
