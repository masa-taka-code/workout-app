/**
 * 長押しの連続実行（−/＋ボタン用）。押した瞬間には動かさない（スクロールの開始と区別できないため）。
 * 1回目は release()（指を離した。取り消し・外れていない場合）で実行する。
 * 400ms 押し続けたら連続実行を始め（以後 100ms ごとに step を呼ぶ）、その場合 release() では追加の1回を行わない。
 * stop()（取り消し・指が外れた）は何も実行せず止める。
 * step が false を返したら（上限・下限に着いたら）止める。タイマー関数は差し替えられる（テスト用）。
 */
export const HOLD_DELAY_MS = 400
export const HOLD_INTERVAL_MS = 100

export interface HoldRepeat {
  start: () => void
  /** 指を離した。連続実行前なら1回だけ実行して止める */
  release: () => void
  /** 取り消し。実行せずに止める */
  stop: () => void
  readonly running: boolean
}

interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (id: unknown) => void
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: id => clearInterval(id as ReturnType<typeof setInterval>),
}

export function createHoldRepeat(step: () => boolean | void, timers: Timers = realTimers): HoldRepeat {
  let delayId: unknown
  let intervalId: unknown
  let running = false
  let repeating = false

  const stop = () => {
    running = false
    repeating = false
    if (delayId !== undefined) timers.clearTimeout(delayId)
    if (intervalId !== undefined) timers.clearInterval(intervalId)
    delayId = undefined
    intervalId = undefined
  }

  const tick = () => {
    if (step() === false) stop()
  }

  const start = () => {
    stop()
    running = true
    delayId = timers.setTimeout(() => {
      delayId = undefined
      if (!running) return
      repeating = true
      tick()
      if (!running) return
      intervalId = timers.setInterval(tick, HOLD_INTERVAL_MS)
    }, HOLD_DELAY_MS)
  }

  const release = () => {
    const shouldStep = running && !repeating
    stop()
    if (shouldStep) step()
  }

  return {
    start,
    release,
    stop,
    get running() {
      return running
    },
  }
}
