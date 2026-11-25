import { useEffect } from 'react'

/** active の間、画面が自動で消えないようにする（未対応ブラウザでは何もしない） */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async () => {
      try {
        if (!('wakeLock' in navigator)) return
        if (document.visibilityState !== 'visible' || sentinel) return
        const s = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void s.release().catch(() => {})
          return
        }
        sentinel = s
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null
        })
      } catch {
        /* 取得できなくても続行 */
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      const s = sentinel
      sentinel = null
      try {
        void s?.release().catch(() => {})
      } catch {
        /* 無視 */
      }
    }
  }, [active])
}
