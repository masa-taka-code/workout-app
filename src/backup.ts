import type { AppData } from './types'
import { normalizeData } from './storage'

export type BackupSummary = { sessions: number; exercises: number; from?: string; to?: string }

export type ParseResult =
  | { ok: true; data: AppData; summary: BackupSummary }
  | { ok: false; error: string }

export const exportFileName = (today: string): string => `workout-log-${today}.json`

export const serialize = (data: AppData): string => JSON.stringify(data, null, 2)

/** バックアップの文字列を読み込み、AppData と内容の概要を返す */
export function parseBackup(text: string): ParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'ファイルを読み込めませんでした（JSON形式ではありません）' }
  }
  const data = normalizeData(json)
  if (!data) return { ok: false, error: 'このアプリのバックアップではないようです' }
  const dates = data.sessions.map(s => s.date).filter((d): d is string => typeof d === 'string').sort()
  return {
    ok: true,
    data,
    summary: {
      sessions: data.sessions.length,
      exercises: data.exercises.length,
      from: dates[0],
      to: dates[dates.length - 1],
    },
  }
}
