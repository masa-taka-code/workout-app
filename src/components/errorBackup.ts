import { localToday } from '../logic'

const DATA_KEY = 'workout-app:data'
/** 読み込めなかった保存データの退避先 */
export const CORRUPT_KEY = 'workout-app:data-corrupt'

export const backupFileName = (today: string): string => `workout-log-backup-${today}.json`

/** 保存データの生の文字列を読む。読めない・空なら undefined */
export function readRawData(key: string = DATA_KEY): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

/** 保存データをそのままファイルとしてダウンロードする。成功したら true */
export function downloadRawBackup(key: string = DATA_KEY): boolean {
  const raw = readRawData(key)
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

/** 退避した壊れたデータを消す。成功したら true */
export function clearCorruptData(): boolean {
  try {
    localStorage.removeItem(CORRUPT_KEY)
    return true
  } catch {
    return false
  }
}
