/**
 * トレーニング予定（純粋関数）。カレンダー登録用の .ics を作る。
 */
import { addDays } from './logic'
import type { Schedule } from './types'

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

const p2 = (n: number) => String(n).padStart(2, '0')

const dayOf = (date: string) => new Date(`${date}T00:00:00`).getDay()

/** today 以降で最初の予定日 (YYYY-MM-DD) */
export function nextScheduled(schedule: Schedule | undefined, today: string): string | undefined {
  if (!schedule || schedule.days.length === 0) return undefined
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i)
    if (schedule.days.includes(dayOf(d))) return d
  }
  return undefined
}

/** 今週（月〜日）の予定回数 */
export function plannedThisWeek(schedule: Schedule | undefined, _today: string): number {
  return schedule ? new Set(schedule.days).size : 0
}

const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`

/** 繰り返し予定1件の iCalendar (RFC 5545)。days が空なら空文字 */
export function toIcs(schedule: Schedule, startDate: string, now: Date): string {
  const days = [...new Set(schedule.days)].sort((a, b) => a - b)
  if (days.length === 0) return ''
  const first = nextScheduled({ days, time: schedule.time }, startDate)
  if (!first) return ''
  const [hh, mm] = schedule.time.split(':')
  const start = `${first.replace(/-/g, '')}T${p2(Number(hh) || 0)}${p2(Number(mm) || 0)}00`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//workout-log//schedule//JA',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${startDate}-${days.join('')}@workout-log`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${start}`,
    'DURATION:PT1H',
    `RRULE:FREQ=WEEKLY;BYDAY=${days.map(d => DAY_CODES[d]).join(',')}`,
    'SUMMARY:筋トレ（筋トレログ）',
    'BEGIN:VALARM',
    'TRIGGER:-PT0M',
    'ACTION:DISPLAY',
    'DESCRIPTION:筋トレの時間です',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n') + '\r\n'
}
