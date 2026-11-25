import { registerSW } from 'virtual:pwa-register'

// Service Worker を登録する（失敗してもアプリは動かす）
export function setupServiceWorker(): void {
  try {
    registerSW({ immediate: true })
  } catch {
    // 登録できない環境では何もしない
  }
}

// 端末にデータを消されにくくする永続ストレージを、起動時に1回だけ要求する
export async function requestPersistentStorage(): Promise<void> {
  try {
    const storage = navigator.storage
    if (!storage?.persist) return
    if (storage.persisted && (await storage.persisted())) return
    await storage.persist()
  } catch {
    // 対応していない・拒否された場合は何もしない
  }
}
