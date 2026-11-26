/**
 * 長押しの連続実行（−/＋ボタン用）。押した瞬間に1回、400ms 押し続けたら 100ms ごとに step を呼ぶ。
 * step が false を返したら（上限・下限に着いたら）止める。タイマー関数は差し替えられる（テスト用）。
 */
export const HOLD_DELAY_MS = 400
export const HOLD_INTERVAL_MS = 100

export interface HoldRepeat {
  start: () => void
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

  const stop = () => {
    running = false
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
    tick()
    if (!running) return
    delayId = timers.setTimeout(() => {
      delayId = undefined
      if (!running) return
      intervalId = timers.setInterval(tick, HOLD_INTERVAL_MS)
    }, HOLD_DELAY_MS)
  }

  return {
    start,
    stop,
    get running() {
      return running
    },
  }
}
