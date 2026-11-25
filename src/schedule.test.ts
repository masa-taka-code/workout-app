import { describe, expect, it } from 'vitest'
import { nextScheduled, plannedThisWeek, toIcs } from './schedule'

const NOW = new Date(Date.UTC(2026, 10, 25, 3, 4, 5))
const sch = { days: [1, 3, 5], time: '19:00' }

describe('toIcs', () => {
  it('必須行を含み CRLF で区切る', () => {
    const ics = toIcs(sch, '2026-11-25', NOW)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).not.toMatch(/[^\r]\n/)
    const lines = ics.split('\r\n')
    for (const l of [
      'VERSION:2.0', 'BEGIN:VEVENT', 'END:VEVENT', 'SUMMARY:筋トレ（筋トレログ）', 'DURATION:PT1H',
      'BEGIN:VALARM', 'TRIGGER:-PT0M', 'ACTION:DISPLAY', 'END:VALARM', 'DTSTAMP:20261125T030405Z',
      'UID:2026-11-25-135@workout-log',
    ]) expect(lines).toContain(l)
    expect(lines.some(l => l.startsWith('PRODID:'))).toBe(true)
    expect(lines.some(l => l.startsWith('DESCRIPTION:'))).toBe(true)
  })

  it('BYDAY は 0=SU…6=SA で変換し昇順', () => {
    expect(toIcs({ days: [0, 6, 2], time: '07:30' }, '2026-11-25', NOW)).toContain('RRULE:FREQ=WEEKLY;BYDAY=SU,TU,SA')
    expect(toIcs(sch, '2026-11-25', NOW)).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR')
  })

  it('DTSTART は開始日以降で最初の予定曜日（浮動時刻）', () => {
    // 2026-11-25 は水曜
    expect(toIcs(sch, '2026-11-25', NOW)).toContain('DTSTART:20261125T190000\r\n')
    expect(toIcs(sch, '2026-11-26', NOW)).toContain('DTSTART:20261127T190000\r\n')
    expect(toIcs(sch, '2026-11-28', NOW)).toContain('DTSTART:20261130T190000\r\n')
  })

  it('days が空なら空文字', () => {
    expect(toIcs({ days: [], time: '19:00' }, '2026-11-25', NOW)).toBe('')
  })
})

describe('nextScheduled', () => {
  it('今日が予定日なら今日', () => {
    expect(nextScheduled(sch, '2026-11-25')).toBe('2026-11-25')
  })
  it('週をまたぐ', () => {
    expect(nextScheduled({ days: [1], time: '19:00' }, '2026-11-25')).toBe('2026-11-30')
    expect(nextScheduled({ days: [3], time: '19:00' }, '2026-11-26')).toBe('2026-12-02')
  })
  it('未設定・空は undefined', () => {
    expect(nextScheduled(undefined, '2026-11-25')).toBeUndefined()
    expect(nextScheduled({ days: [], time: '19:00' }, '2026-11-25')).toBeUndefined()
  })
})

describe('plannedThisWeek', () => {
  it('days の数', () => {
    expect(plannedThisWeek(sch, '2026-11-25')).toBe(3)
    expect(plannedThisWeek(undefined, '2026-11-25')).toBe(0)
  })
})
