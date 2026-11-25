import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Exercise } from '../types'
import type {
  Baseline, FormContext, FormExerciseKey, FormReport, FormSessionSummary, RepResult,
} from '../form/types'
import { RepTracker, baselineFrom, setupGuide } from '../form/engine'
import { analyzeSet, emphasisTargets } from '../form/analysis'
import { currentPoseModel, detectWithWorld, loadPoseLandmarker, resetPoseLandmarker } from '../form/pose'
import { drawSkeleton } from '../form/draw'
import { toAspectCorrected } from '../form/geometry'
import { PLACEMENT_VOICE, createVoice } from '../form/voice'
import type { FormVoice } from '../form/voice'
import {
  initialAutoEnd, formatClock, judgePlacement, pickLiveCue, stepAutoEnd, stepAutoStart,
} from '../form/capture'
import type { AutoEndState, AutoStartState, Placement } from '../form/capture'
import FormReportView from './FormReportView'
import './FormCheck.css'

export type Facing = 'environment' | 'user'

/** 反映時に FormCheckButton へ渡す、保存用の材料 */
export interface FormCheckSaved {
  report: FormReport
  reps: RepResult[]
  ctx: FormContext
}

export interface FormCheckProps {
  ex: Exercise
  formKey: FormExerciseKey
  baseline?: Baseline
  /** 過去のフォーム要約（新しい順） */
  history: FormSessionSummary[]
  /** 反映先セットの重量（kg、分からなければ 0） */
  weight: number
  recentBestWeight?: number
  /** 最後に選んだ「効かせたい部位」 */
  targetId?: string
  /** 撮影中の音声（未設定はオン） */
  voiceOn: boolean
  /** 最後に使ったカメラ（未設定は内カメラ） */
  initialFacing: Facing
  onTargetChange: (id: string) => void
  onFacingChange: (facing: Facing) => void
  /** endedAt はライブ撮影のときだけ（動画ファイルは渡さない） */
  onApply: (result: { reps: number; formScore: number; endedAt?: number }, saved: FormCheckSaved) => void
  onSaveBaseline: (key: string, baseline: Baseline) => void
  onClose: () => void
}

type ErrorKind = 'permission' | 'model' | 'unsupported'
type Phase = 'idle' | 'armed' | 'measuring' | 'analyzing' | 'pick' | 'result'

const ERROR_TEXT: Record<ErrorKind, string> = {
  permission: 'カメラの使用が許可されていません。ブラウザの設定で許可してください',
  model: '解析の準備ができませんでした。Wi-Fi などにつないで、もう一度お試しください',
  unsupported: 'この端末・ブラウザでは利用できません',
}

const FILE_ERROR_TEXT = 'この動画は読み込めませんでした。カメラで撮った MP4・MOV をお試しください'
const FILE_TIP = 'スローモーション・ズームは使わず、真横から、2分以内で'

/** 待機中の置き直しの表示（色だけに頼らず、記号と語を添える） */
const PLACEMENT_VIEW: Record<Placement, { word: string; cls: string; chip: string }> = {
  ok: { word: 'OK', cls: 'ok', chip: '良い' },
  caution: { word: '△ 斜め', cls: 'caution', chip: 'ふつう' },
  ng: { word: '× 正面', cls: 'ng', chip: 'よくない' },
  hidden: { word: '× 映っていない', cls: 'ng', chip: '映っていません' },
}

/** 表示を切り替えるまでに、同じ状態が続くべき時間（ちらつき防止） */
const PLACEMENT_HOLD_MS = 500
/** 声かけを画面に出す時間 */
const CUE_SHOW_MS = 2000

interface FileSet {
  reps: RepResult[]
  startMs: number
  endMs: number
}

function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
}

function cssColor(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

export default function FormCheck({
  ex, formKey, baseline, history, weight, recentBestWeight, targetId: savedTargetId, voiceOn, initialFacing,
  onTargetChange, onFacingChange, onApply, onSaveBaseline, onClose,
}: FormCheckProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const loadedModelRef = useRef<string>('')
  const swappingRef = useRef(false)

  const [attempt, setAttempt] = useState(0)
  const [facing, setFacing] = useState<Facing>(initialFacing)
  const [modelReady, setModelReady] = useState(false)
  const [mediaReady, setMediaReady] = useState(false)
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(() =>
    cameraSupported() ? null : 'unsupported',
  )
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileError, setFileError] = useState(false)
  const [aspect, setAspect] = useState(3 / 4)
  const [phase, setPhase] = useState<Phase>('idle')
  const [placement, setPlacement] = useState<Placement>('hidden')
  const [repCount, setRepCount] = useState(0)
  const [cueText, setCueText] = useState<string>()
  const [finished, setFinished] = useState<RepResult[] | null>(null)
  const [fileSets, setFileSets] = useState<FileSet[]>([])
  const [fromFile, setFromFile] = useState(false)
  const [progress, setProgress] = useState({ ratio: 0, remainSec: 0 })
  const [targetId, setTargetId] = useState<string | undefined>(savedTargetId)

  // 基準は開いた時点のものを使う（セット中に差し替えない）
  const [tracker] = useState(() => new RepTracker(formKey, baseline))
  const voice = useMemo<FormVoice>(() => createVoice(voiceOn), [voiceOn])
  const guide = useMemo(() => setupGuide(formKey), [formKey])
  const targets = useMemo(() => emphasisTargets(formKey), [formKey])

  // 毎フレームの処理で使う値（再描画を起こさずに更新する）
  const phaseRef = useRef<Phase>('idle')
  const fileModeRef = useRef(false)
  const startStateRef = useRef<AutoStartState>({})
  const endStateRef = useRef<AutoEndState>(initialAutoEnd)
  const repsRef = useRef<RepResult[]>([])
  const cuedRef = useRef(false)
  const cueTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const placementRef = useRef<{ shown: Placement; cand: Placement; since: number }>({ shown: 'hidden', cand: 'hidden', since: 0 })
  const lastFileTimeRef = useRef(-1)
  const fileSetsRef = useRef<FileSet[]>([])
  const fileSetStartRef = useRef<number | undefined>(undefined)
  const endedAtRef = useRef<number | undefined>(undefined)

  const changePhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }, [])

  const showCue = useCallback((text: string) => {
    setCueText(text)
    if (cueTimerRef.current) clearTimeout(cueTimerRef.current)
    cueTimerRef.current = setTimeout(() => setCueText(undefined), CUE_SHOW_MS)
  }, [])

  // 解析モデルの読み込み
  useEffect(() => {
    let cancelled = false
    loadPoseLandmarker()
      .then(lm => {
        if (cancelled) return
        landmarkerRef.current = lm
        loadedModelRef.current = currentPoseModel()
        setModelReady(true)
      })
      .catch(() => {
        if (!cancelled) setErrorKind(prev => prev ?? 'model')
      })
    return () => { cancelled = true }
  }, [attempt])

  // カメラの起動（向きが変わるたびに作り直す）。動画ファイルを解析するあいだは止める
  useEffect(() => {
    if (!cameraSupported() || fileUrl) return
    const video = videoRef.current
    let cancelled = false
    let stream: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing }, audio: false })
      .then(async s => {
        if (cancelled) {
          s.getTracks().forEach(t => t.stop())
          return
        }
        stream = s
        if (!video) {
          s.getTracks().forEach(t => t.stop())
          return
        }
        video.srcObject = s
        try { await video.play() } catch { /* autoPlay に任せる */ }
        if (cancelled) return
        if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight)
        setMediaReady(true)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const name = e instanceof DOMException ? e.name : ''
        setErrorKind(name === 'NotAllowedError' || name === 'SecurityError' ? 'permission' : 'unsupported')
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach(t => t.stop())
      if (video) video.srcObject = null
    }
  }, [facing, attempt, fileUrl])

  // 画面を閉じたら読み上げと予約中のタイマーを止める
  useEffect(() => () => {
    voice.cancel()
    if (cueTimerRef.current) clearTimeout(cueTimerRef.current)
  }, [voice])

  // 動画ファイルの読み込み
  useEffect(() => {
    const video = videoRef.current
    if (!fileUrl || !video) return
    video.srcObject = null
    video.src = fileUrl
    video.loop = false
    video.muted = true
    const onMeta = () => {
      if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight)
      setMediaReady(true)
      void video.play().catch(() => failFile())
    }
    const onEnded = () => finishFile()
    const onError = () => failFile()
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)
    return () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(fileUrl)
    }
    // finishFile / failFile は ref と set 関数だけを使うので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl])

  /** 動画のセットを 1 つ確定する */
  const pushFileSet = (reps: RepResult[], endMs: number) => {
    if (reps.length === 0) return
    const startMs = fileSetStartRef.current ?? 0
    fileSetsRef.current = [...fileSetsRef.current, { reps, startMs, endMs: Math.max(endMs, startMs) }]
  }

  /** 動画の最後まで解析し終えた */
  function finishFile() {
    if (phaseRef.current !== 'analyzing') return
    const video = videoRef.current
    pushFileSet(repsRef.current, (video?.currentTime ?? 0) * 1000)
    const sets = fileSetsRef.current
    setFileSets(sets)
    if (sets.length === 1) {
      setFinished(sets[0].reps)
      changePhase('result')
    } else if (sets.length === 0) {
      setFinished([])
      changePhase('result')
    } else {
      changePhase('pick')
    }
  }

  /** 動画を読み込めなかった */
  function failFile() {
    fileModeRef.current = false
    setFileUrl(null)
    setMediaReady(false)
    setFileError(true)
    changePhase('idle')
  }

  // 推定ループ
  useEffect(() => {
    if (!modelReady || !mediaReady) return
    let raf = 0
    const root = rootRef.current
    const accent = root ? cssColor(root, '--accent', '#2563eb') : '#2563eb'
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const phaseNow = phaseRef.current
      if (phaseNow !== 'armed' && phaseNow !== 'measuring' && phaseNow !== 'analyzing') return
      const video = videoRef.current
      const canvas = canvasRef.current
      const lm = landmarkerRef.current
      if (!video || !canvas || !lm || video.readyState < 2 || swappingRef.current) return
      const isFile = fileModeRef.current
      // 動画は新しいフレームだけ処理する（同じ時刻を2回入れない）
      if (isFile && video.currentTime === lastFileTimeRef.current) return
      if (isFile) lastFileTimeRef.current = video.currentTime
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        setAspect(video.videoWidth / video.videoHeight)
      }
      const perf = performance.now()
      const { pose, world } = detectWithWorld(lm, video, perf)
      // 推定が遅い端末では pose.ts が lite に切り替える。読み込み直して差し替える（その間はフレーム処理を止める）
      if (currentPoseModel() !== loadedModelRef.current) {
        swappingRef.current = true
        loadPoseLandmarker()
          .then(next => {
            landmarkerRef.current = next
            loadedModelRef.current = currentPoseModel()
          })
          .catch(() => { /* 古い landmarker のまま続ける */ loadedModelRef.current = currentPoseModel() })
          .finally(() => { swappingRef.current = false })
      }
      // 角度は縦横比をそろえた座標で計算する（描画は元の正規化座標のまま）
      const corrected = pose && toAspectCorrected(pose, video.videoWidth / video.videoHeight)
      // 計測の時刻：ライブは performance.now()、動画は再生位置（ミリ秒）
      const t = isFile ? video.currentTime * 1000 : perf

      if (phaseNow === 'armed') {
        stepArmed(judgePlacement(formKey, corrected, world), t)
        drawSkeleton(canvas, pose, accent, {}, facing === 'user')
        return
      }
      // 撮影中・解析中は人体図を出さない
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      const frame = tracker.push(corrected, t, world)
      stepMeasuring(frame.reps, frame.visible, t, isFile)
      if (!isFile) stepChip(judgePlacement(formKey, corrected, world), t)
      if (isFile && video.duration > 0) {
        const ratio = Math.min(1, video.currentTime / video.duration)
        setProgress(prev => (Math.abs(prev.ratio - ratio) < 0.01 ? prev : { ratio, remainSec: Math.max(0, video.duration - video.currentTime) }))
      }
    }

    /** 待機中：置き場所の表示・声・自動開始 */
    const stepArmed = (raw: Placement, t: number) => {
      const shown = stablePlacement(raw, t)
      if (shown !== placementRef.current.shown) {
        placementRef.current.shown = shown
        setPlacement(shown)
      }
      if (shown !== 'ok') {
        const text = shown === 'hidden' ? PLACEMENT_VOICE.hidden : shown === 'caution' ? PLACEMENT_VOICE.caution : PLACEMENT_VOICE.ng
        voice.placement(text)
      }
      const r = stepAutoStart(startStateRef.current, raw, t)
      startStateRef.current = r.state
      if (r.start) {
        voice.say('スタート')
        voice.startChime()
        beginMeasuring(false)
      }
    }

    /** 撮影条件のチップ（計測中。声では注意しない） */
    const stepChip = (raw: Placement, t: number) => {
      const shown = stablePlacement(raw, t)
      if (shown !== placementRef.current.shown) {
        placementRef.current.shown = shown
        setPlacement(shown)
      }
    }

    const stablePlacement = (raw: Placement, t: number): Placement => {
      const p = placementRef.current
      if (raw !== p.cand) {
        p.cand = raw
        p.since = t
      }
      return t - p.since >= PLACEMENT_HOLD_MS ? p.cand : p.shown
    }

    /** 計測中：回数・声かけ・自動終了 */
    const stepMeasuring = (reps: RepResult[], visible: boolean, t: number, isFile: boolean) => {
      repsRef.current = reps
      if (fileSetStartRef.current === undefined && visible) fileSetStartRef.current = t
      if (reps.length > endStateRef.current.repCount) {
        setRepCount(reps.length)
        if (!isFile) {
          voice.repTick()
          if (!cuedRef.current) {
            const cue = pickLiveCue(formKey, reps, history)
            if (cue) {
              cuedRef.current = true
              voice.cue(cue.voice)
              showCue(cue.screen)
            }
          }
        }
      }
      const r = stepAutoEnd(endStateRef.current, { nowMs: t, repCount: reps.length, visible })
      endStateRef.current = r.state
      if (!r.end) return
      if (isFile) {
        // 8 秒以上レップが無い区間でセットを区切り、次のセットを数え直す
        pushFileSet(reps, r.state.lastRepAt ?? t)
        resetCounting()
        fileSetStartRef.current = undefined
        return
      }
      finishLive()
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // beginMeasuring / finishLive / resetCounting は ref と set 関数だけを使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelReady, mediaReady, facing, tracker, formKey, history, voice, showCue])

  /** 数え直しの準備（新しいセットの前） */
  function resetCounting() {
    tracker.reset()
    repsRef.current = []
    cuedRef.current = false
    endStateRef.current = initialAutoEnd
    voice.resetSet()
    setRepCount(0)
    setCueText(undefined)
  }

  function beginMeasuring(file: boolean) {
    resetCounting()
    fileSetStartRef.current = undefined
    endedAtRef.current = undefined
    setFinished(null)
    changePhase(file ? 'analyzing' : 'measuring')
  }

  /** ライブ撮影のセットを終える（自動・手動とも） */
  function finishLive() {
    if (phaseRef.current !== 'measuring') return
    const reps = repsRef.current
    endedAtRef.current = Date.now()
    voice.say(reps.length > 0 ? `終了。${reps.length}回` : '終了')
    setFromFile(false)
    setFinished(reps)
    changePhase('result')
  }

  /** 「撮影を始める」：ここで音声を有効にして、置き直しの待機に入る */
  const arm = () => {
    voice.prime()
    startStateRef.current = {}
    placementRef.current = { shown: 'hidden', cand: 'hidden', since: performance.now() }
    setPlacement('hidden')
    setFileError(false)
    changePhase('armed')
  }

  const backToIdle = () => {
    voice.cancel()
    changePhase('idle')
  }

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFileError(false)
    setMediaReady(false)
    fileModeRef.current = true
    lastFileTimeRef.current = -1
    fileSetsRef.current = []
    setFileSets([])
    setFromFile(true)
    setProgress({ ratio: 0, remainSec: 0 })
    setFileUrl(URL.createObjectURL(file))
    beginMeasuring(true)
  }

  /** 解析を中止する／撮り直す：カメラの映像に戻る */
  const toCamera = () => {
    voice.cancel()
    fileModeRef.current = false
    setFileUrl(null)
    setMediaReady(false)
    setFinished(null)
    setFileSets([])
    setFromFile(false)
    setRepCount(0)
    changePhase('idle')
  }

  const switchCamera = () => {
    const next: Facing = facing === 'user' ? 'environment' : 'user'
    setMediaReady(false)
    setFacing(next)
    onFacingChange(next)
  }

  /** モデルとカメラをもう一度読み込む */
  const reload = () => {
    resetPoseLandmarker()
    setErrorKind(cameraSupported() ? null : 'unsupported')
    setModelReady(false)
    setMediaReady(false)
    setAttempt(n => n + 1)
  }

  const ctx = useMemo<FormContext>(() => ({
    key: formKey, exerciseId: ex.id, weight, recentBestWeight, history, baseline, targetId,
  }), [formKey, ex.id, weight, recentBestWeight, history, baseline, targetId])

  const report = useMemo(() => (finished && finished.length > 0 ? analyzeSet(finished, ctx) : null), [finished, ctx])

  const hasUnapplied = phase === 'pick' || (phase === 'result' && !!finished && finished.length > 0)
  const requestClose = () => {
    if (hasUnapplied && !window.confirm('反映していない結果があります。閉じますか？')) return
    onClose()
  }

  const handleApply = (repsCount: number) => {
    if (!report || !finished) return
    onApply(
      { reps: repsCount, formScore: report.overallScore, ...(fromFile ? {} : { endedAt: endedAtRef.current }) },
      { report, reps: finished, ctx },
    )
    onClose()
  }

  const ready = !errorKind && modelReady && mediaReady
  const loadingText = !modelReady && !mediaReady
    ? 'モデルを読み込み中／カメラの許可待ち…'
    : !modelReady ? '解析モデルを読み込み中…' : 'カメラの許可待ち…'
  const showStage = phase !== 'result' && phase !== 'pick'
  const pv = PLACEMENT_VIEW[placement]
  const compact = phase === 'measuring' || phase === 'analyzing'

  return (
    <div className="fc" ref={rootRef} role="dialog" aria-modal="true" aria-label={`${ex.name}のフォーム撮影`}>
      <header className="fc-head">
        <div className="fc-head-row">
          <h2 className="fc-title">{ex.name}</h2>
          <button type="button" className="btn" onClick={requestClose}>閉じる</button>
        </div>
        {!compact && guide && <p className="fc-guide">{guide}</p>}
        {phase === 'idle' && (
          <p className="fc-note">
            映像は端末の外に送信しません。初回のみ解析モデル（数MB）をダウンロードします。
            ジムでは声が聞こえにくいので、イヤホンの使用をおすすめします。
          </p>
        )}
      </header>

      <div className={phase === 'result' || phase === 'pick' ? 'fc-body fc-body-result' : 'fc-body'}>
        {errorKind ? (
          <div className="fc-error" role="alert">
            <p>{ERROR_TEXT[errorKind]}</p>
            <div className="fc-error-actions">
              <button type="button" className="btn btn-primary" onClick={reload}>再読み込み</button>
              <button type="button" className="btn" onClick={onClose}>閉じる</button>
            </div>
          </div>
        ) : (
          <>
            <div className={!showStage ? 'fc-stage fc-hidden' : compact ? 'fc-stage fc-stage-live' : 'fc-stage'} style={{ aspectRatio: String(aspect) }}>
              <video
                ref={videoRef}
                className={facing === 'user' && !fileUrl ? 'fc-video fc-mirror' : 'fc-video'}
                playsInline
                muted
                autoPlay
              />
              <canvas ref={canvasRef} className="fc-canvas" />
              {!ready && showStage && <div className="fc-overlay">{loadingText}</div>}

              {ready && phase === 'armed' && (
                <div className={`fc-frame fc-frame-${pv.cls}`} role="status" aria-live="polite">
                  <span className={`fc-frame-word fc-frame-word-${pv.cls}`}>{pv.word}</span>
                </div>
              )}

              {ready && phase === 'measuring' && (
                <>
                  <span className={`fc-chip-cond fc-chip-cond-${pv.cls}`}>撮影条件：{pv.chip}</span>
                  <div className="fc-count" aria-label={`${repCount}回`}>
                    <span className="fc-count-num">{repCount}</span>
                    <span className="fc-count-unit">回</span>
                  </div>
                  {cueText && <p className="fc-cue" role="status">{cueText}</p>}
                </>
              )}
            </div>

            {phase === 'idle' && (
              <>
                {fileError && <p className="fc-file-error" role="alert">{FILE_ERROR_TEXT}</p>}
                <button type="button" className="btn btn-primary fc-big-btn" disabled={!ready} onClick={arm}>
                  撮影を始める
                </button>
                <div className="fc-sub-controls">
                  <button type="button" className="btn" onClick={switchCamera}>
                    カメラ：{facing === 'user' ? '内' : '外'}に切替
                  </button>
                  <button type="button" className="btn" disabled={!modelReady} onClick={() => fileInputRef.current?.click()}>
                    動画を選んで解析
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept="video/*" className="fc-file-input" onChange={pickFile} aria-label="解析する動画ファイル" />
                <p className="fc-note">{FILE_TIP}</p>
              </>
            )}

            {phase === 'armed' && (
              <>
                <p className="fc-armed-help">スマホを体の真横に置いてください。映りが良いと、自動で始まります。</p>
                <button type="button" className="btn btn-primary fc-big-btn" onClick={() => { voice.say('スタート'); voice.startChime(); beginMeasuring(false) }}>
                  今すぐ開始
                </button>
                <button type="button" className="btn fc-mid-btn" onClick={backToIdle}>やめる</button>
              </>
            )}

            {phase === 'measuring' && (
              <button type="button" className="btn btn-primary fc-big-btn fc-end-btn" onClick={finishLive}>終了</button>
            )}

            {phase === 'analyzing' && (
              <section className="fc-progress" aria-live="polite">
                <p className="fc-progress-text">
                  解析中 {Math.round(progress.ratio * 100)}%・残り {formatClock(progress.remainSec)}
                </p>
                <div className="fc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}>
                  <div className="fc-bar-fill" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
                </div>
                <p className="fc-note">この画面のままお待ちください。映像は端末の外に送信しません。</p>
                <button type="button" className="btn fc-mid-btn" onClick={toCamera}>中止</button>
              </section>
            )}

            {phase === 'pick' && (
              <section className="fc-pick">
                <h3 className="fc-pick-title">セットを選んでください（{fileSets.length}セット）</h3>
                <div className="fc-pick-list">
                  {fileSets.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className="btn fc-pick-item"
                      onClick={() => { setFinished(s.reps); changePhase('result') }}
                    >
                      セット{i + 1}　{formatClock(s.startMs / 1000)}〜{formatClock(s.endMs / 1000)}　{s.reps.length}回
                    </button>
                  ))}
                </div>
                <button type="button" className="btn fc-mid-btn" onClick={toCamera}>カメラに戻る</button>
              </section>
            )}

            {phase === 'result' && (
              report && finished ? (
                <>
                  {fromFile && <span className="fc-from-file">動画から</span>}
                  <FormReportView
                    ex={ex}
                    reps={finished}
                    report={report}
                    targets={targets}
                    targetId={targetId ?? report.emphasis.target?.id}
                    onTargetChange={id => { setTargetId(id); onTargetChange(id) }}
                    onApply={handleApply}
                    onRetake={() => {
                      // 反映していない結果を捨てるので確認する
                      if (confirm('この結果を記録に反映せずに撮り直しますか？')) toCamera()
                    }}
                    onSaveBaseline={rep => onSaveBaseline(formKey, baselineFrom(rep))}
                  />
                </>
              ) : (
                <section className="fc-empty" role="status">
                  <p>回数を数えられませんでした。体が全身映るように、真横から撮り直してください。</p>
                  <button type="button" className="btn btn-primary fc-big-btn" onClick={toCamera}>撮り直す</button>
                </section>
              )
            )}
          </>
        )}
        {phase === 'idle' && !errorKind && (
          <button type="button" className="btn fc-close-bottom" onClick={onClose}>閉じる</button>
        )}
      </div>
    </div>
  )
}
