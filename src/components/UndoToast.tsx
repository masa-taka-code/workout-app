import { useEffect, useLayoutEffect, useRef } from 'react'
import './UndoToast.css'

interface Props {
  message: string
  onUndo: () => void
  /** 5 秒たったときに呼ぶ */
  onExpire: () => void
  /** 表示までの時間（ミリ秒） */
  duration?: number
  /** true なら、自分の高さ＋8px を --undo-below-h に出す（上に重ねるトーストのため。記録画面のトースト用） */
  reportHeight?: boolean
  /** true なら、--undo-below-h の分だけ上にずらす（App レベルのトースト用） */
  above?: boolean
}

/** 画面下（タブバーと休憩タイマーの上）に固定する「元に戻す」トースト。message が変わると 5 秒数え直す */
export default function UndoToast({ message, onUndo, onExpire, duration = 5000, reportHeight = false, above = false }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setTimeout(onExpire, duration)
    return () => clearTimeout(t)
    // onExpire は毎回作り直されるので、message が変わったときだけ数え直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, duration])

  // 下に別のトーストがあるとき、その高さを上のトーストに伝えて縦に並べる
  useLayoutEffect(() => {
    if (!reportHeight || !ref.current) return
    const root = document.documentElement
    root.style.setProperty('--undo-below-h', `${ref.current.offsetHeight + 8}px`)
    return () => {
      root.style.removeProperty('--undo-below-h')
    }
  }, [reportHeight, message])

  return (
    <div ref={ref} className={`undo-toast${above ? ' undo-toast-above' : ''}`} role="status">
      <span className="undo-text">{message}</span>
      <button type="button" className="undo-btn" onClick={onUndo}>元に戻す</button>
    </div>
  )
}
