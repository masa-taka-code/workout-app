import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHoldRepeat } from './holdRepeat'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createHoldRepeat', () => {
  it('start だけでは動かない。取り消し（スクロール）では値が変わらない', () => {
    const step = vi.fn()
    const h = createHoldRepeat(step)
    h.start()
    expect(step).toHaveBeenCalledTimes(0)
    vi.advanceTimersByTime(300)
    h.stop()
    vi.advanceTimersByTime(2000)
    expect(step).toHaveBeenCalledTimes(0)
    expect(h.running).toBe(false)
  })

  it('短いタップ（400ms 未満で離す）は1回だけ動く', () => {
    const step = vi.fn()
    const h = createHoldRepeat(step)
    h.start()
    vi.advanceTimersByTime(200)
    h.release()
    expect(step).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    expect(step).toHaveBeenCalledTimes(1)
    expect(h.running).toBe(false)
  })

  it('長押しは 400ms で動き始め、以後 100ms ごと。離しても追加の1回はない', () => {
    const step = vi.fn()
    const h = createHoldRepeat(step)
    h.start()
    vi.advanceTimersByTime(399)
    expect(step).toHaveBeenCalledTimes(0)
    vi.advanceTimersByTime(1)
    expect(step).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300)
    expect(step).toHaveBeenCalledTimes(4)
    h.release()
    expect(step).toHaveBeenCalledTimes(4)
  })

  it('離すと止まり、もう一度 start できる', () => {
    const step = vi.fn()
    const h = createHoldRepeat(step)
    h.start()
    vi.advanceTimersByTime(700)
    h.release()
    const n = step.mock.calls.length
    vi.advanceTimersByTime(1000)
    expect(step).toHaveBeenCalledTimes(n)
    h.start()
    h.release()
    expect(step).toHaveBeenCalledTimes(n + 1)
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
    vi.advanceTimersByTime(450)
    expect(step).toHaveBeenCalledTimes(1)
    h.stop()
  })
})
