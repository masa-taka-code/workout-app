import { useEffect, useRef, useState } from 'react'
import './RestTimer.css'
import { playRestEnd, playRestWarn } from '../sound'
import SetQuantity from './SetQuantity'
import { PRE_ALERT_SECONDS, shouldPreAlert, showRestRir } from './todayLogic'
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
  /** 直前に完了したセットの余力（RIR）を、休憩の最初の30秒だけ入れられるようにする。省略すると出さない */
  restRir?: {
    /** いま入っている値（未入力は undefined。押さなければ目標 RIR として記録される） */
    value: number | undefined
    onPick: (rir: number) => void
  }
}

/** 休憩終了の表示を出しておく時間（ミリ秒） */
const FINISHED_SHOWN_MS = 3000
/** 残り時間がこの秒数以下になったら進み具合バーを注意色にする */
const WARN_SECONDS = PRE_ALERT_SECONDS

/** 固定バー（CurrentSetBar）の中に置く休憩タイマー。休憩中と休憩終了の2状態の表示を持つ */
export default function RestTimer({ seconds, onSkip, sound = true, next, startedAt, onFinishedShown, onComplete, restRir }: Props) {
  const [endAt, setEndAt] = useState(() => (startedAt ?? Date.now()) + seconds * 1000)
  const [totalMs, setTotalMs] = useState(() => Math.max(1, seconds * 1000))
  const [now, setNow] = useState(() => Date.now())
  // 余力の入力を出す時間（休憩を始めてから30秒）の起点
  const [beganAt] = useState(() => startedAt ?? Date.now())
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

  // 残り10秒の予告（短い振動と短い音）。音は設定の「音」がオフなら鳴らさない。+30秒で10秒より上に戻ったら、次の10秒でもう一度
  const warnedRef = useRef(false)
  useEffect(() => {
    if (remaining > PRE_ALERT_SECONDS) {
      warnedRef.current = false
      return
    }
    if (!shouldPreAlert(remaining, warnedRef.current)) return
    warnedRef.current = true
    if (sound) playRestWarn()
    try {
      navigator.vibrate?.(80)
    } catch {
      /* 振動に対応していない環境では無視 */
    }
    // sound は予告の瞬間の値だけ使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining])

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
          <span className="timer-time">
            {`${mm}:${ss}`}
            {remaining <= WARN_SECONDS && <span className="timer-soon">まもなく</span>}
          </span>
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
            <p className="timer-next">
              <span className="timer-next-name">次：{next.exerciseName}</span>
              <span className="timer-next-count">{next.setNo}/{next.totalSets}</span>
            </p>
            <p className="timer-target">
              <SetQuantity weight={next.weight} reps={next.reps} />
            </p>
          </>
        ) : (
          <p className="timer-next">次：すべてのセットが完了しました</p>
        )}
      </div>
      {restRir && showRestRir(now - beganAt) && (
        <div className="timer-rir" role="group" aria-label="さっきのセットの余力（RIR）">
          <p className="timer-rir-label">さっきのセットの余力（あと何回できた？）</p>
          <div className="timer-rir-btns">
            {[0, 1, 2, 3, 4, 5].map(r => (
              <button
                key={r}
                type="button"
                className="timer-rir-btn"
                aria-pressed={restRir.value === r}
                onClick={() => restRir.onPick(r)}
              >
                {r === 5 ? '5+' : r}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
