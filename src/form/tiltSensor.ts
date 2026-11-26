/**
 * スマホの傾きセンサー（DeviceOrientationEvent）の読み取り。外部通信なし。
 * 非対応・拒否・動画ファイルのときは傾き「不明」（current() が undefined）。
 */
import { tiltFromOrientation } from './tilt'

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

/** 画面の向き（度）。縦持ちは 0 */
function screenAngle(): number {
  try {
    if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle
    const legacy = (window as unknown as { orientation?: number }).orientation
    if (typeof legacy === 'number') return legacy
  } catch { /* 取れなければ縦持ちとみなす */ }
  return 0
}

/**
 * iOS は許可の確認が必要で、タップ操作の中で呼ぶ必要がある（「撮影を始める」の中で呼ぶ）。
 * 許可済み・許可が要らない環境は true。非対応・拒否は false。
 */
export async function requestTiltPermission(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return false
    const ctor = DeviceOrientationEvent as OrientationCtor
    if (typeof ctor.requestPermission === 'function') return (await ctor.requestPermission()) === 'granted'
    return true
  } catch {
    return false
  }
}

export interface TiltSensor {
  /** 直近の傾き（度）。まだ値が来ていない・非対応なら undefined */
  current(): number | undefined
  stop(): void
}

/** 傾きの購読を始める。値が来るまで current() は undefined */
export function startTiltSensor(): TiltSensor {
  let value: number | undefined
  const onEvent = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null || e.beta === undefined || e.gamma === undefined) return
    value = tiltFromOrientation(e.beta, e.gamma, screenAngle())
  }
  let active = false
  try {
    if (typeof window !== 'undefined') {
      window.addEventListener('deviceorientation', onEvent)
      active = true
    }
  } catch { /* 非対応 */ }
  return {
    current: () => value,
    stop: () => {
      if (!active) return
      try { window.removeEventListener('deviceorientation', onEvent) } catch { /* 何もしない */ }
      active = false
      value = undefined
    },
  }
}
