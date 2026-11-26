import { localToday } from '../logic'

const DATA_KEY = 'workout-app:data'

export const backupFileName = (today: string): string => `workout-log-backup-${today}.json`

/** 保存データの生の文字列を読む。読めない・空なら undefined */
export function readRawData(): string | undefined {
  try {
    return localStorage.getItem(DATA_KEY) ?? undefined
  } catch {
    return undefined
  }
}

/** 保存データをそのままファイルとしてダウンロードする。成功したら true */
export function downloadRawBackup(): boolean {
  const raw = readRawData()
  if (!raw) return false
  try {
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = backupFileName(localToday())
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    return true
  } catch {
    return false
  }
}
