import { weekStart } from '../logic'

export const WEIGHT_ALERT_DISMISS_KEY = 'workout-app:weight-alert-dismissed'

/** 閉じた状態を覚える値。その週（月曜の日付）だけ有効で、翌週になれば自然に出し直す */
export const dismissToken = (today: string): string => weekStart(today)

export const isDismissed = (stored: string | null | undefined, today: string): boolean => stored === dismissToken(today)

export function readDismissed(today: string): boolean {
  try {
    return isDismissed(localStorage.getItem(WEIGHT_ALERT_DISMISS_KEY), today)
  } catch {
    return false
  }
}

export function writeDismissed(today: string): void {
  try {
    localStorage.setItem(WEIGHT_ALERT_DISMISS_KEY, dismissToken(today))
  } catch {
    // 保存できなくても、今の画面では閉じたままにする
  }
}
