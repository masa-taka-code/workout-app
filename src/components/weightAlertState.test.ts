import { describe, expect, it } from 'vitest'
import { dismissToken, isDismissed } from './weightAlertState'

describe('weightAlertState', () => {
  it('同じ週の中では閉じた状態が続き、翌週は出し直す', () => {
    // 2026-11-23 は月曜
    const token = dismissToken('2026-11-26')
    expect(token).toBe('2026-11-23')
    expect(isDismissed(token, '2026-11-29')).toBe(true)
    expect(isDismissed(token, '2026-11-30')).toBe(false)
  })
  it('覚えていないときは閉じていない', () => {
    expect(isDismissed(null, '2026-11-26')).toBe(false)
    expect(isDismissed(undefined, '2026-11-26')).toBe(false)
  })
})
