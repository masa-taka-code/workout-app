import { useEffect, useRef, useState } from 'react'
import './RestTimer.css'
import { playRestEnd } from '../sound'

/** 休憩中に見せる「次のセット」 */
export interface NextSet {
  exerciseName: string
  /** 1 始まり */
  setNo: number
  totalSets: number
  /** 0 は未定（初回） */
  weight: number
  reps: number
}

interface Props {
  /** 休憩の秒数。リセットしたいときは親が key を変えて作り直す */
  seconds: number
  onSkip: () => void
  /** 終了時に音を鳴らすか */
  sound?: boolean
  /** 次にやるセット（今日の未完了セットがなければ undefined） */
  next?: NextSet
}

/** 画面下部に固定表示する休憩タイマー */
export default function RestTimer({ seconds, onSkip, sound = true, next }: Props) {
  const [endAt, setEndAt] = useState(() => Date.now() + seconds * 1000)
  const [totalMs, setTotalMs] = useState(() => Math.max(1, seconds * 1000))
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
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
      navigator.vibrate?.([200, 100, 200, 100, 400])
    } catch {
      /* 振動に対応していない環境では無視 */
    }
    // sound は終了の瞬間の値だけ使う（変わっても鳴らし直さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished])

  // 自分の高さを測って --timer-h に設定する（画面下の余白に使われる）
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const root = document.documentElement
    const apply = () => root.style.setProperty('--timer-h', `${Math.round(el.getBoundingClientRect().height)}px`)
    apply()
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(apply)
      ro.observe(el)
    }
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--timer-h')
    }
  }, [])

  const mm = Math.floor(remaining / 60)
  const ss = String(remaining % 60).padStart(2, '0')
  const ratio = finished ? 0 : Math.min(1, Math.max(0, (endAt - now) / totalMs))

  let line1: string
  if (finished) line1 = '次のセットへ'
  else if (next) line1 = `次：${next.exerciseName}　${next.setNo}/${next.totalSets}セット目`
  else line1 = '次：すべてのセットが完了しました'

  const line2 = next ? (next.weight > 0 ? `${next.weight}kg × ${next.reps}回` : `重量を決めて × ${next.reps}回`) : ''

  return (
    <div ref={rootRef} className={`timer${finished ? ' timer-done' : ''}`} role="timer">
      <div className="timer-bar" aria-hidden="true">
        <div className="timer-bar-fill" style={{ transform: `scaleX(${ratio})` }} />
      </div>
      <div className="timer-body">
        <p className="timer-next">{line1}</p>
        {next && <p className="timer-target">{line2}</p>}
        <div className="timer-row">
          <span className="timer-time">{finished ? '休憩終了' : `${mm}:${ss}`}</span>
          {!finished && (
            <button
              className="btn timer-btn"
              onClick={() => {
                setEndAt(t => Math.max(t, Date.now()) + 30000)
                setTotalMs(t => t + 30000)
              }}
            >
              +30秒
            </button>
          )}
          <button className="btn timer-btn" onClick={onSkip}>スキップ</button>
        </div>
      </div>
    </div>
  )
}
