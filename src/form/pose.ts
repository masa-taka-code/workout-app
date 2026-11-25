/**
 * MediaPipe Pose Landmarker の読み込みと推定。
 * 初期バンドルに含めないよう、ライブラリは動的 import で読み込む。
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Pose } from './types'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

let cached: Promise<PoseLandmarker> | undefined

/** 1回だけ作って使い回す。失敗したら次回また試せるようにキャッシュを捨てる */
export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  if (!cached) {
    cached = create().catch(e => {
      cached = undefined
      throw e
    })
  }
  return cached
}

/** キャッシュを捨てて、次回の読み込みをやり直せるようにする */
export function resetPoseLandmarker(): void {
  cached = undefined
}

async function create(): Promise<PoseLandmarker> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    })
  try {
    return await make('GPU')
  } catch {
    return await make('CPU')
  }
}

let lastVideoTime = -1
let lastPose: Pose | undefined

/** 1フレーム推定する。映像が進んでいなければ前回の結果を返す */
export function detect(landmarker: PoseLandmarker, video: HTMLVideoElement, timeMs: number): Pose | undefined {
  if (video.readyState < 2 || video.videoWidth === 0) return undefined
  if (video.currentTime === lastVideoTime) return lastPose
  lastVideoTime = video.currentTime
  try {
    const res = landmarker.detectForVideo(video, timeMs)
    lastPose = res.landmarks[0] as Pose | undefined
  } catch {
    lastPose = undefined
  }
  return lastPose
}
