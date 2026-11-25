import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Exercise, Muscle } from '../types'
import type { Baseline, FormExerciseKey, RepResult } from '../form/types'
import { RepTracker, baselineFrom, setupGuide, summarizeSet } from '../form/engine'
import { detect, loadPoseLandmarker } from '../form/pose'
import { colorForScore, drawSkeleton } from '../form/draw'
import { exerciseHighlights } from '../bodymap'
import BodyMap from './BodyMap'
import './FormCheck.css'

export interface FormCheckProps {
  ex: Exercise
  formKey: FormExerciseKey
  baseline?: Baseline
  onApply: (result: { reps: number; formScore: number }) => void
  onSaveBaseline: (key: string, baseline: Baseline) => void
  onClose: () => void
}

type Facing = 'environment' | 'user'
type ErrorKind = 'permission' | 'model' | 'unsupported'
type Status = 'loading' | 'ready' | ErrorKind

const ERROR_TEXT: Record<ErrorKind, string> = {
  permission: 'カメラの使用が許可されていません。ブラウザの設定で許可してください',
  model: '解析モデルを読み込めませんでした。初回はインターネット接続が必要です',
  unsupported: 'この端末・ブラウザでは利用できません',
}

const SHORT_ROM_CODES = ['short-rom', 'shallow', 'partial-bottom']

interface Live {
  visible: boolean
  cue?: string
  reps: RepResult[]
}

function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
}

function cssColor(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

export default function FormCheck({ ex, formKey, baseline, onApply, onSaveBaseline, onClose }: FormCheckProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const measuringRef = useRef(false)
  const lastScoreRef = useRef<number | undefined>(undefined)
  const liveRef = useRef<Live>({ visible: true, reps: [] })

  const [facing, setFacing] = useState<Facing>('environment')
  const [modelReady, setModelReady] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(() =>
    cameraSupported() ? null : 'unsupported',
  )
  // 基準は開いた時点のものを使う（セット中に差し替えない）
  const [tracker] = useState(() => new RepTracker(formKey, baseline))
  const [aspect, setAspect] = useState(3 / 4)
  const [measuring, setMeasuring] = useState(false)
  const [live, setLive] = useState<Live>({ visible: true, reps: [] })
  const [finished, setFinished] = useState<RepResult[] | null>(null)
  const [saved, setSaved] = useState(false)

  const guide = useMemo(() => setupGuide(formKey), [formKey])

  // 解析モデルの読み込み
  useEffect(() => {
    let cancelled = false
    loadPoseLandmarker()
      .then(lm => {
        if (cancelled) return
        landmarkerRef.current = lm
        setModelReady(true)
      })
      .catch(() => {
        if (!cancelled) setErrorKind(prev => prev ?? 'model')
      })
    return () => { cancelled = true }
  }, [])

  // カメラの起動（向きが変わるたびに作り直す）
  useEffect(() => {
    if (!cameraSupported()) return
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
        if (!video) return
        const v = video
        v.srcObject = s
        try { await v.play() } catch { /* autoPlay に任せる */ }
        if (cancelled) return
        if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight)
        setCameraReady(true)
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
  }, [facing])

  // 推定ループ
  useEffect(() => {
    if (!modelReady || !cameraReady) return
    let raf = 0
    const root = rootRef.current
    const colors = {
      good: root ? cssColor(root, '--good', '#15803d') : '#15803d',
      warn: root ? cssColor(root, '--warn', '#b45309') : '#b45309',
      bad: root ? cssColor(root, '--bad', '#b91c1c') : '#b91c1c',
      neutral: root ? cssColor(root, '--accent', '#2563eb') : '#2563eb',
    }
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const video = videoRef.current
      const canvas = canvasRef.current
      const lm = landmarkerRef.current
      if (!video || !canvas || !lm || video.readyState < 2) return
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        setAspect(video.videoWidth / video.videoHeight)
      }
      const now = performance.now()
      const pose = detect(lm, video, now)
      let angles: Record<string, number> = {}
      if (measuringRef.current) {
        const frame = tracker.push(pose, now)
        angles = frame.angles
        lastScoreRef.current = frame.reps[frame.reps.length - 1]?.score
        const prev = liveRef.current
        if (prev.visible !== frame.visible || prev.cue !== frame.cue || prev.reps.length !== frame.reps.length) {
          const next = { visible: frame.visible, cue: frame.cue, reps: frame.reps }
          liveRef.current = next
          setLive(next)
        }
      }
      drawSkeleton(canvas, pose, colorForScore(lastScoreRef.current, colors), angles, facing === 'user')
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [modelReady, cameraReady, facing, tracker])

  const start = useCallback(() => {
    tracker.reset()
    lastScoreRef.current = undefined
    const fresh = { visible: true, reps: [] as RepResult[] }
    liveRef.current = fresh
    setLive(fresh)
    setFinished(null)
    setSaved(false)
    measuringRef.current = true
    setMeasuring(true)
  }, [tracker])

  const stop = useCallback(() => {
    measuringRef.current = false
    setMeasuring(false)
    setFinished(liveRef.current.reps)
  }, [])

  const again = useCallback(() => {
    setFinished(null)
    setSaved(false)
    lastScoreRef.current = undefined
    const fresh = { visible: true, reps: [] as RepResult[] }
    liveRef.current = fresh
    setLive(fresh)
  }, [])

  const status: Status = errorKind ?? (modelReady && cameraReady ? 'ready' : 'loading')
  const lastRep = live.reps[live.reps.length - 1]
  const shortRom = !!lastRep?.issues.some(i => SHORT_ROM_CODES.includes(i.code))

  const highlights = useMemo(() => {
    const base = exerciseHighlights(ex)
    if (!shortRom) return base
    const out: Partial<Record<Muscle, number>> = { ...base }
    for (const m of ex.primary) out[m] = 0.5
    return out
  }, [ex, shortRom])

  const summary = finished ? summarizeSet(finished, formKey) : null
  const bestRep = finished && finished.length > 0
    ? finished.reduce((a, b) => (b.score > a.score ? b : a))
    : undefined

  const loadingText = !modelReady && !cameraReady
    ? 'モデルを読み込み中／カメラの許可待ち…'
    : !modelReady ? '解析モデルを読み込み中…' : 'カメラの許可待ち…'

  return (
    <div className="fc" ref={rootRef} role="dialog" aria-modal="true" aria-label={`${ex.name}のフォーム撮影`}>
      <header className="fc-head">
        <div className="fc-head-row">
          <h2 className="fc-title">{ex.name}</h2>
          <button type="button" className="btn" onClick={onClose}>閉じる</button>
        </div>
        {guide && <p className="fc-guide">{guide}</p>}
        <p className="fc-note">映像は端末の外に送信しません。初回のみ解析モデル（数MB）をダウンロードします。</p>
      </header>

      <div className="fc-body">
        {errorKind ? (
          <p className="fc-error" role="alert">{ERROR_TEXT[errorKind]}</p>
        ) : (
          <>
            <div className="fc-stage" style={{ aspectRatio: String(aspect) }}>
              <video
                ref={videoRef}
                className={facing === 'user' ? 'fc-video fc-mirror' : 'fc-video'}
                playsInline
                muted
                autoPlay
              />
              <canvas ref={canvasRef} className="fc-canvas" />
              {status === 'loading' && <div className="fc-overlay">{loadingText}</div>}
              {status === 'ready' && measuring && !live.visible && (
                <div className="fc-overlay fc-overlay-warn">全身（必要な関節）が映るように離れてください</div>
              )}
            </div>

            <div className="fc-controls">
              {!measuring ? (
                <button type="button" className="btn btn-primary" disabled={status !== 'ready'} onClick={start}>セット開始</button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={stop}>セット終了</button>
              )}
              <button type="button" className="btn" disabled={measuring} onClick={() => { setCameraReady(false); setFacing(f => (f === 'user' ? 'environment' : 'user')) }}>
                カメラ切替
              </button>
            </div>

            {(measuring || (!finished && live.reps.length > 0)) && (
              <section className="fc-live" aria-live="polite">
                <div className="fc-stats">
                  <div><span className="fc-big">{live.reps.length}</span><span className="fc-unit">回</span></div>
                  <div>
                    <span className="fc-label">直近</span>
                    <span className="fc-big">{lastRep ? lastRep.score : '–'}</span>
                    <span className="fc-unit">点</span>
                  </div>
                </div>
                {live.cue && <p className="fc-cue">{live.cue}</p>}
                <BodyMap size="sm" highlights={highlights} label={`${ex.name}で効く筋肉`} />
                {shortRom && <p className="fc-lengthen">伸びた位置での負荷が不足しています</p>}
              </section>
            )}

            {summary && finished && (
              <section className="fc-result">
                <h3>セットの結果</h3>
                <p className="fc-summary">
                  {summary.reps}回・平均{summary.avgScore}点
                  <span className={summary.lengthenedOk ? 'fc-chip fc-chip-good' : 'fc-chip fc-chip-warn'}>
                    {summary.lengthenedOk ? '伸びた位置まで動かせています' : '伸びた位置の負荷が不足'}
                  </span>
                </p>

                {summary.mainIssues.length > 0 ? (
                  <>
                    <h4>フォーム解説</h4>
                    <ul className="fc-issues">
                      {summary.mainIssues.map(is => {
                        const n = finished.filter(r => r.issues.some(i => i.code === is.code)).length
                        return (
                          <li key={is.code}>
                            <strong>{is.message}（{n}回）</strong>
                            <span>→ {is.fix}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                ) : (
                  summary.reps > 0 && <p className="fc-ok">大きな減点はありませんでした。</p>
                )}

                {finished.length > 0 && (
                  <div className="fc-table-wrap">
                    <table className="fc-table">
                      <thead>
                        <tr><th>回</th><th>点数</th><th>可動域</th><th>下ろす</th></tr>
                      </thead>
                      <tbody>
                        {finished.map(r => (
                          <tr key={r.index}>
                            <td>{r.index}</td>
                            <td>{r.score}</td>
                            <td>{Math.round(r.romDeg)}°{r.romPct !== undefined ? `（${Math.round(r.romPct)}%）` : ''}</td>
                            <td>{r.eccentricSec.toFixed(1)}秒</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="fc-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={summary.reps === 0}
                    onClick={() => { onApply({ reps: summary.reps, formScore: summary.avgScore }); onClose() }}
                  >
                    記録に反映（{summary.reps}回・{summary.avgScore}点）
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!bestRep}
                    onClick={() => {
                      if (!bestRep) return
                      onSaveBaseline(formKey, baselineFrom(bestRep))
                      setSaved(true)
                    }}
                  >
                    最も良いレップを基準にする
                  </button>
                  {saved && <p className="fc-saved" role="status">基準を保存しました</p>}
                  <button type="button" className="btn" onClick={again}>もう1セット</button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
