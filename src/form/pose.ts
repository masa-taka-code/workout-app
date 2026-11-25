/**
 * MediaPipe Pose Landmarker の読み込みと推定。
 * 初期バンドルに含めないよう、ライブラリは動的 import で読み込む。
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Pose } from './types'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
/** 解析モデル。既定は精度の高い full。推定が遅い端末では lite に切り替える */
export type PoseModel = 'full' | 'lite'
const MODEL_URLS: Record<PoseModel, string> = {
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
}
/** 直近この数フレームの推定時間の平均が SLOW_MS を超えたら lite に切り替える（切替は1回だけ） */
const SLOW_WINDOW = 30
const SLOW_MS = 40

let model: PoseModel = 'full'
let switched = false
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

/** いま使っている解析モデル */
export function currentPoseModel(): PoseModel {
  return model
}

async function create(): Promise<PoseLandmarker> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URLS[model], delegate },
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
let lastWorld: Pose | undefined
const recentMs: number[] = []

/**
 * 直近の推定時間を記録し、遅ければ lite に切り替える（切り替えは1回だけ）。
 * 切り替えるときはキャッシュを捨てるので、次の loadPoseLandmarker() が lite を読み込む。
 * 画面側は currentPoseModel() が変わったら読み込み直す。
 */
function recordDuration(ms: number): void {
  recentMs.push(ms)
  if (recentMs.length > SLOW_WINDOW) recentMs.shift()
  if (!switched && model === 'full' && recentMs.length >= SLOW_WINDOW) {
    const avg = recentMs.reduce((s, v) => s + v, 0) / recentMs.length
    if (avg > SLOW_MS) {
      switched = true
      model = 'lite'
      cached = undefined
    }
  }
}

/** 1フレーム推定して、画像座標の姿勢と world（メートル）の姿勢を返す。映像が進んでいなければ前回の結果を返す */
export function detectWithWorld(
  landmarker: PoseLandmarker, video: HTMLVideoElement, timeMs: number,
): { pose: Pose | undefined; world: Pose | undefined } {
  if (video.readyState < 2 || video.videoWidth === 0) return { pose: undefined, world: undefined }
  if (video.currentTime === lastVideoTime) return { pose: lastPose, world: lastWorld }
  lastVideoTime = video.currentTime
  const t0 = performance.now()
  try {
    const res = landmarker.detectForVideo(video, timeMs)
    lastPose = res.landmarks[0] as Pose | undefined
    lastWorld = res.worldLandmarks?.[0] as Pose | undefined
  } catch {
    lastPose = undefined
    lastWorld = undefined
  }
  recordDuration(performance.now() - t0)
  return { pose: lastPose, world: lastWorld }
}

/** 1フレーム推定する（画像座標のみ）。映像が進んでいなければ前回の結果を返す */
export function detect(landmarker: PoseLandmarker, video: HTMLVideoElement, timeMs: number): Pose | undefined {
  return detectWithWorld(landmarker, video, timeMs).pose
}
