interface Props {
  value: string | undefined
  onChange: (note: string | undefined) => void
  /** 読み上げ用（例「1セット目のメモ」） */
  label: string
}

// 仮。implementer がセットごとのメモ入力を実装する。
export default function SetNote(_props: Props) {
  return null
}
