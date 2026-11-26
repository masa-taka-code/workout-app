/**
 * ライブ撮影で「新しいコマ」だけを計算に入れるための部品（純粋なロジック。ブラウザ API に依存しない）。
 * 画面の更新（120Hz など）がカメラ（30fps など）より速いと、同じコマを何度も処理してしまうため、
 * 同じ時刻のコマは2回目以降を捨てる。
 */

/** requestVideoFrameCallback の metadata のうち使うもの */
export interface VideoFrameMeta {
  /** 映像のコマの時刻（秒） */
  mediaTime?: number
  /** カメラがコマを撮った時刻（ミリ秒。performance.now() と同じ時間軸） */
  captureTime?: number
}

/**
 * 計測に使う時刻（ミリ秒）。mediaTime（秒）があればそれ、なければ captureTime、
 * どちらも無ければ fallbackMs（今までどおり performance.now()）。
 */
export function frameTimeMs(meta: VideoFrameMeta | undefined, fallbackMs: number): number {
  if (meta && typeof meta.mediaTime === 'number' && Number.isFinite(meta.mediaTime)) return meta.mediaTime * 1000
  if (meta && typeof meta.captureTime === 'number' && Number.isFinite(meta.captureTime)) return meta.captureTime
  return fallbackMs
}

/** 直前に通した時刻より新しいコマだけを通す。時刻が進んでいなければ捨てる */
export class FrameGate {
  private last = -Infinity

  /** 新しいコマなら true（その時刻を覚える）。同じ時刻・過去の時刻なら false */
  accept(timeMs: number): boolean {
    if (!Number.isFinite(timeMs) || timeMs <= this.last) return false
    this.last = timeMs
    return true
  }

  reset(): void {
    this.last = -Infinity
  }
}
