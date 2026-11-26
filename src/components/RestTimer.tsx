import { useEffect, useRef, useState } from 'react'
import './RestTimer.css'
import { playRestEnd } from '../sound'
import SetQuantity from './SetQuantity'
import type { NextSet } from './todayLogic'

export type { NextSet } from './todayLogic'

interface Props {
  /** 休憩の秒数。リセットしたいときは親が key を変えて作り直す */
  seconds: number
  onSkip: () => void
  /** 終了時に音を鳴らすか */
  sound?: boolean
  /** 次にやるセット（今日の未完了セットがなければ undefined） */
  next?: NextSet
  /** 休憩の開始時刻（Date.now() の値）。省略時は表示した時点から数える（動画撮影の自動終了時刻など） */
  startedAt?: number
  /** 休憩終了の表示を3秒出したあと（または画面に触れたとき）に呼ぶ。親は作業中の表示へ戻す */
  onFinishedShown?: () => void
  /** 休憩終了の表示で出す「✓ 完了」ボタンの動作（次のセットがあるときだけ出す） */
  onComplete?: () => void
}

/** 休憩終了の表示を出しておく時間（ミリ秒） */
const FINISHED_SHOWN_MS = 3000
/** 残り時間がこの秒数以下になったら進み具合バーを注意色にする */
const WARN_SECONDS = 10

/** 固定バー（CurrentSetBar）の中に置く休憩タイマー。休憩中と休憩終了の2状態の表示を持つ */
export default function RestTimer({ seconds, onSkip, sound = true, next, startedAt, onFinishedShown, onComplete }: Props) {
  const [endAt, setEndAt] = useState(() => (startedAt ?? Date.now()) + seconds * 1000)
  const [totalMs, setTotalMs] = useState(() => Math.max(1, seconds * 1000))
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
      navigator.vibrate?.([200, 100, 200, 100, 400])
    } catch {
      /* 振動に対応していない環境では無視 */
    }
    // sound は終了の瞬間の値だけ使う（変わっても鳴らし直さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished])

  // 親が毎回作り直すコールバックで3秒が数え直されないよう、最新のものを ref に持つ
  const shownRef = useRef(onFinishedShown)
  useEffect(() => {
    shownRef.current = onFinishedShown
  })

  // 終了の表示は3秒、または画面に触れるまで
  useEffect(() => {
    if (!finished) return
    const dismiss = () => shownRef.current?.()
    const t = setTimeout(dismiss, FINISHED_SHOWN_MS)
    document.addEventListener('click', dismiss)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', dismiss)
    }
  }, [finished])

  const mm = Math.floor(remaining / 60)
  const ss = String(remaining % 60).padStart(2, '0')
  const ratio = finished ? 0 : Math.min(1, Math.max(0, (endAt - now) / totalMs))

  if (finished) {
    // 数字が長い（例「102.5kg × 12回」）ときは、完了ボタンと並ぶ幅に収めるため一段小さくする
    const longQty = next !== undefined && `${Math.round(next.weight * 100) / 100}${next.reps}`.length >= 6
    return (
      <div className={`timer timer-done${longQty ? ' timer-done-long' : ''}`} role="timer">
        <div className="timer-body timer-body-done">
          <div className="timer-done-info">
            <p className="timer-finish">休憩終了</p>
            {next && (
              <p className="timer-target">
                <SetQuantity weight={next.weight} reps={next.reps} />
              </p>
            )}
          </div>
          {next && onComplete && (
            <button
              type="button"
              className="csb-donebtn csb-donebtn-ring"
              aria-label={`${next.exerciseName} ${next.setNo}セット目を完了`}
              onClick={onComplete}
            >
              ✓ 完了
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`timer${remaining <= WARN_SECONDS ? ' timer-warn' : ''}`} role="timer">
      <div className="timer-bar" aria-hidden="true">
        <div className="timer-bar-fill" style={{ transform: `scaleX(${ratio})` }} />
      </div>
      <div className="timer-body">
        <div className="timer-row">
          <span className="timer-time">{`${mm}:${ss}`}</span>
          <button
            className="btn timer-btn timer-btn-add"
            onClick={() => {
              setEndAt(t => Math.max(t, Date.now()) + 30000)
              setTotalMs(t => t + 30000)
            }}
          >
            +30秒
          </button>
          <button className="btn timer-btn timer-btn-skip" onClick={onSkip}>スキップ</button>
        </div>
        {next ? (
          <>
            <p className="timer-next">次：{next.exerciseName}　{next.setNo}/{next.totalSets}</p>
            <p className="timer-target">
              <SetQuantity weight={next.weight} reps={next.reps} />
            </p>
          </>
        ) : (
          <p className="timer-next">次：すべてのセットが完了しました</p>
        )}
      </div>
    </div>
  )
}
