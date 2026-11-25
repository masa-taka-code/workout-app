import { useEffect, useState } from 'react'
import { playRestEnd } from '../sound'

interface Props {
  /** 休憩の秒数。リセットしたいときは親が key を変えて作り直す */
  seconds: number
  onSkip: () => void
  /** 終了時に音を鳴らすか */
  sound?: boolean
}

/** 画面下部に固定表示する休憩タイマー */
export default function RestTimer({ seconds, onSkip, sound = true }: Props) {
  const [endAt, setEndAt] = useState(() => Date.now() + seconds * 1000)
  const [now, setNow] = useState(() => Date.now())
  const remaining = Math.max(0, Math.ceil((endAt - now) / 1000))
  const finished = remaining === 0

  useEffect(() => {
    if (finished) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [finished, endAt])

  useEffect(() => {
    if (!finished) return
    if (sound) playRestEnd()
    try {
      navigator.vibrate?.(200)
    } catch {
      /* 振動に対応していない環境では無視 */
    }
    // sound は終了の瞬間の値だけ使う（変わっても鳴らし直さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished])

  const mm = Math.floor(remaining / 60)
  const ss = String(remaining % 60).padStart(2, '0')

  return (
    <div className={`timer${finished ? ' timer-done' : ''}`} role="timer">
      <span className="timer-time">{finished ? '休憩終了' : `残り ${mm}:${ss}`}</span>
      <button className="btn" onClick={() => setEndAt(t => Math.max(t, Date.now()) + 30000)}>+30秒</button>
      <button className="btn" onClick={onSkip}>スキップ</button>
    </div>
  )
}
