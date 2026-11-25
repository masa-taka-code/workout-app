import { useEffect } from 'react'
import './UndoToast.css'

interface Props {
  message: string
  onUndo: () => void
  /** 5 秒たったときに呼ぶ */
  onExpire: () => void
  /** 表示までの時間（ミリ秒） */
  duration?: number
}

/** 画面下（タブバーと休憩タイマーの上）に固定する「元に戻す」トースト。message が変わると 5 秒数え直す */
export default function UndoToast({ message, onUndo, onExpire, duration = 5000 }: Props) {
  useEffect(() => {
    const t = setTimeout(onExpire, duration)
    return () => clearTimeout(t)
    // onExpire は毎回作り直されるので、message が変わったときだけ数え直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, duration])

  return (
    <div className="undo-toast" role="status">
      <span className="undo-text">{message}</span>
      <button type="button" className="undo-btn" onClick={onUndo}>元に戻す</button>
    </div>
  )
}
