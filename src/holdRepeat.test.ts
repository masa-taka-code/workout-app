import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHoldRepeat } from './holdRepeat'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createHoldRepeat', () => {
  it('押した瞬間に1回、400ms 後から 100ms ごとに呼ぶ', () => {
    const step = vi.fn()
    const h = createHoldRepeat(step)
    h.start()
    expect(step).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(399)
    expect(step).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    vi.advanceTimersByTime(100)
    expect(step).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(300)
    expect(step).toHaveBeenCalledTimes(5)
  })

  it('400ms より前に離せば連続しない', () => {
    const step = vi.fn()
    const h = createHoldRepeat(step)
    h.start()
    vi.advanceTimersByTime(300)
    h.stop()
    vi.advanceTimersByTime(2000)
    expect(step).toHaveBeenCalledTimes(1)
    expect(h.running).toBe(false)
  })

  it('stop のあとは止まり、もう一度 start できる', () => {
    const step = vi.fn()
    const h = createHoldRepeat(step)
    h.start()
    vi.advanceTimersByTime(700)
    h.stop()
    const n = step.mock.calls.length
    vi.advanceTimersByTime(1000)
    expect(step).toHaveBeenCalledTimes(n)
    h.start()
    expect(step).toHaveBeenCalledTimes(n + 1)
    h.stop()
  })

  it('step が false を返したら止まる（下限・上限）', () => {
    let n = 0
    const step = vi.fn(() => ++n < 3)
    const h = createHoldRepeat(step)
    h.start()
    vi.advanceTimersByTime(2000)
    expect(step).toHaveBeenCalledTimes(3)
    expect(h.running).toBe(false)
  })

  it('start を重ねてもタイマーが二重にならない', () => {
    const step = vi.fn()
    const h = createHoldRepeat(step)
    h.start()
    h.start()
    expect(step).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(500)
    expect(step).toHaveBeenCalledTimes(3)
    h.stop()
  })
})
