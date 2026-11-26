import { useEffect, useRef } from 'react'
import './CurrentSetBar.css'
import RestTimer from './RestTimer'
import SetQuantity from './SetQuantity'
import type { NextSet } from './todayLogic'

interface Props {
  /** 今のセット（未完了のセットがなければ undefined） */
  current?: NextSet
  /** 休憩中なら、その休憩の情報。作り直したいときは run を変える */
  rest?: { run: number; seconds: number; sound: boolean; startedAt?: number }
  /** 「✓ 完了」 */
  onComplete: () => void
  /** バーの文字部分を押したとき（今のセットへスクロール） */
  onJump: () => void
  /** 休憩の「スキップ」 */
  onSkipRest: () => void
  /** 休憩終了の表示を出し終えた */
  onRestFinishedShown: () => void
  /** 全部終わったときの「＋ 種目を追加」 */
  onAddExercise: () => void
}

/**
 * タブバーの真上に固定する「今のセット」バー。
 * 作業中（完了ボタン）／休憩中（残り時間と次）／休憩終了（緑）／全部終わった（種目を追加）の4状態。
 * 自分の高さを測って --timer-h に設定する（画面下の余白とトーストの位置に使われる）。
 */
export default function CurrentSetBar({ current, rest, onComplete, onJump, onSkipRest, onRestFinishedShown, onAddExercise }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)

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

  let body
  if (rest) {
    body = (
      <RestTimer
        key={rest.run}
        seconds={rest.seconds}
        sound={rest.sound}
        next={current}
        startedAt={rest.startedAt}
        onSkip={onSkipRest}
        onFinishedShown={onRestFinishedShown}
        onComplete={onComplete}
      />
    )
  } else if (current) {
    body = (
      <div className="csb-work">
        <button type="button" className="csb-info" onClick={onJump}>
          <span className="csb-line1">
            <span className="csb-name">{current.exerciseName}</span>
            <span className="csb-count">{current.setNo}/{current.totalSets}</span>
          </span>
          <span className="csb-line2">
            <SetQuantity weight={current.weight} reps={current.reps} />
          </span>
        </button>
        <button
          type="button"
          className="csb-donebtn"
          aria-label={`${current.exerciseName} ${current.setNo}セット目を完了`}
          onClick={onComplete}
        >
          ✓ 完了
        </button>
      </div>
    )
  } else {
    body = (
      <div className="csb-work">
        <p className="csb-alldone">今日のセットはすべて完了</p>
        <button type="button" className="csb-donebtn csb-addbtn" onClick={onAddExercise}>＋ 種目を追加</button>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="csb">
      {body}
    </div>
  )
}
