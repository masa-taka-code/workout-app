import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Exercise } from '../types'
import type { FormExerciseKey, ViewKind } from '../form/types'
import { localToday } from '../logic'
import {
  FRAME_STEP_SEC, addAnswerKey, angleFromPoints, angleJoints, bottomWord, evaluate, loadAnswerKeys, nearestFrame, summarizeKeys,
} from '../form/answerKey'
import type { AnswerKeyRecord, AnswerTotals, AppRep, TraceFrame } from '../form/answerKey'
import './AnswerCheck.css'

/** 答え合わせ（B2 の最小版）。動画は保存しない。保存するのは正解のラベルと数値だけ（form/answerKey.ts） */
export interface AnswerCheckProps {
  ex: Exercise
  formKey: FormExerciseKey
  /** 解析した動画の URL（object URL。生きている間だけ使える） */
  videoUrl: string
  /** 動画の縦横比（幅÷高さ） */
  aspect: number
  appReps: AppRep[]
  trace: TraceFrame[]
  view: ViewKind
  phiDeg?: number
  /** この動画の答え合わせを保存済みか（二重に保存しない） */
  alreadySaved?: boolean
  /** 保存できたときに呼ぶ */
  onSaved?: () => void
  onClose: () => void
}

type Pt = { x: number; y: number }
type Decision = 'undecided' | 'ok' | 'removed'

interface Item {
  id: number
  source: 'app' | 'added'
  /** アプリの最下点（added は追加したコマ）の時刻（秒） */
  bottomT: number
  decision: Decision
  /** 正解の最下点の時刻。角度を置いたコマに合わせる。なければ bottomT */
  trueT?: number
  /** 角度を置く 3 点（0〜1）と、置いたコマの時刻 */
  pts?: Pt[]
  ptsT?: number
  /** ユーザーが 1 点でも動かしたか（動かしていない初期位置は正解にしない） */
  touched?: boolean
}

/** 角度を置くときの初期位置のずらし（アンカリング対策。設計値・暫定：画面の幅・高さの 2〜3%） */
const START_OFFSET: Pt[] = [{ x: 0.03, y: -0.02 }, { x: -0.02, y: 0.03 }, { x: 0.02, y: 0.03 }]
const DEFAULT_PTS: Pt[] = [{ x: 0.5, y: 0.35 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.65 }]
/** 0.25 倍速で再生する、最下点の前後の秒数（設計値・暫定） */
const SLOW_RATE = 0.25
const SLOW_PAD_SEC = 0.6
/** 角度を置いたコマと同じとみなす時刻の差（秒。1 コマ分。24fps でも収まる。設計値・暫定） */
const SAME_FRAME_SEC = 1 / 24
/** コマ送りで、次のコマの中に入れるための余裕（秒） */
const STEP_MARGIN_SEC = 0.002
/** コマ送りで、コマが変わらなかったときにやり直す最大回数 */
const STEP_RETRY = 3

const JOINT_LABEL: Record<string, string> = {
  shoulder: '肩', elbow: '肘', wrist: '手首', hip: '股関節', knee: '膝', ankle: '足首',
}

const sec = (v: number) => `${v.toFixed(2)}秒`
const deg = (v: number | undefined) => (v === undefined ? '—' : `${v.toFixed(1)}°`)
const signed = (v: number | undefined) => (v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`)
const pct = (v: number | undefined) => (v === undefined ? '—' : `${Math.round(v * 100)}%`)

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function AngleLines({ s }: { s: ReturnType<typeof evaluate>['angle'] }) {
  if (s.n === 0) return <p className="ak-line">角度：比べられたレップはまだありません（0 件）</p>
  return (
    <>
      <p className="ak-line">角度（アプリ − 正解）：{s.n} 件　平均の差 {signed(s.meanDiff)}　平均絶対誤差 {deg(s.mae)}</p>
      {s.sd !== undefined && s.loaLow !== undefined && s.loaHigh !== undefined ? (
        <p className="ak-line">ばらつき（SD）{deg(s.sd)}　一致の範囲 {signed(s.loaLow)} 〜 {signed(s.loaHigh)}</p>
      ) : (
        <p className="ak-line ak-muted">1 件だけなので、ばらつきと一致の範囲は出せません</p>
      )}
    </>
  )
}

function Totals({ t, name }: { t: AnswerTotals; name: string }) {
  return (
    <section className="card ak-card" aria-label={`${name}の累計`}>
      <h3 className="ak-h">{name}の累計</h3>
      <p className="ak-line">動画 {t.videos} 本　正解のレップ {t.trueReps} 回　アプリの検出 {t.appReps} 回</p>
      <p className="ak-line">
        回数が正解と同じだった動画：{t.exactVideos} / {t.videos} 本　レップ単位の一致：{t.count.matched} / {t.trueReps}（再現率 {pct(t.count.recall)}、適合率 {pct(t.count.precision)}）
      </p>
      <AngleLines s={t.angle} />
    </section>
  )
}

export default function AnswerCheck({ ex, formKey, videoUrl, aspect, appReps, trace, view, phiDeg, alreadySaved, onSaved, onClose }: AnswerCheckProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stopAtRef = useRef(Infinity)
  /** 表示中のコマの時刻（state と同じ値。コマ送りの基準） */
  const tRef = useRef(0)
  const seekToken = useRef(0)
  const stepBusy = useRef(false)
  const frameKnown = useRef(false)
  /** 1 コマの長さ（秒）。再生中に観測できれば更新する。それまでは 1/30 */
  const frameDurRef = useRef(FRAME_STEP_SEC)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [videoError, setVideoError] = useState(false)
  /** 動画の実際の縦横比（読み込み後。それまでは aspect） */
  const [vAspect, setVAspect] = useState(aspect)
  const [items, setItems] = useState<Item[]>(() =>
    appReps.map((r, i) => ({ id: i + 1, source: 'app', bottomT: r.bottomT, decision: 'undecided' })))
  const nextId = useRef(appReps.length + 1)
  const [selId, setSelId] = useState<number | undefined>(undefined)
  const [saved, setSaved] = useState<{ totals: AnswerTotals; ok: boolean } | undefined>(undefined)

  const joints = angleJoints(formKey)
  const bw = bottomWord(formKey)
  const sel = items.find(i => i.id === selId)

  const commitT = useCallback((x: number) => {
    tRef.current = x
    setT(x)
  }, [])

  /**
   * to へ移って止め、実際に表示されたコマの時刻（mediaTime。使えなければ currentTime）を返す。
   * 古い呼び出しの結果は画面に反映しない
   */
  const showAt = useCallback((to: number): Promise<number> => {
    const v = videoRef.current
    if (!v) return Promise.resolve(tRef.current)
    v.pause()
    setPlaying(false)
    const c = Math.max(0, Math.min(Number.isFinite(v.duration) ? v.duration : to, to))
    const token = ++seekToken.current
    commitT(c)
    return new Promise<number>(resolve => {
      let done = false
      let timer = 0
      const finish = (x: number) => {
        if (done) return
        done = true
        window.clearTimeout(timer)
        if (token === seekToken.current) commitT(x)
        resolve(x)
      }
      // コマが変わらない（同じコマに止まる）ときのために、時間切れでも返す
      timer = window.setTimeout(() => finish(v.currentTime), 400)
      if (typeof v.requestVideoFrameCallback === 'function') {
        v.requestVideoFrameCallback((_n, meta) => finish(meta.mediaTime))
      } else {
        v.addEventListener('seeked', () => finish(v.currentTime), { once: true })
      }
      v.currentTime = c
    })
  }, [commitT])

  const seek = useCallback((to: number) => { void showAt(to) }, [showAt])

  /** 1 コマ進む・戻る。表示中のコマの時刻から 1 コマ分＋少しへ移り、コマが変わらなければもう 1 コマ分ずつ進める（最大 STEP_RETRY 回） */
  const stepFrame = async (dir: 1 | -1) => {
    if (stepBusy.current) return
    stepBusy.current = true
    try {
      const base = tRef.current
      for (let n = 1; n <= STEP_RETRY; n++) {
        const shown = await showAt(base + dir * frameDurRef.current * n + STEP_MARGIN_SEC)
        if (Math.abs(shown - base) > 1e-4) break
      }
    } finally {
      stepBusy.current = false
    }
  }

  // 0.25 倍速の再生中：表示したコマの時刻を追い、最下点の少し後で止める
  useEffect(() => {
    const v = videoRef.current
    if (!playing || !v) return
    let raf = 0
    let vfc = 0
    let lastMT: number | undefined
    const tick = (_n?: number, meta?: VideoFrameCallbackMetadata) => {
      // 表示したコマの時刻（mediaTime）を使う。コマの間隔も観測する（最小の差を 1 コマの長さとみなす）
      const mt = meta?.mediaTime ?? v.currentTime
      if (meta && lastMT !== undefined) {
        const d = mt - lastMT
        if (d > 0.004 && d < 0.2 && (!frameKnown.current || d < frameDurRef.current)) {
          frameDurRef.current = d
          frameKnown.current = true
        }
      }
      if (meta) lastMT = mt
      commitT(mt)
      if (v.currentTime >= stopAtRef.current || v.ended) {
        v.pause()
        setPlaying(false)
        return
      }
      if (typeof v.requestVideoFrameCallback === 'function') vfc = v.requestVideoFrameCallback(tick)
      else raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
      if (vfc && typeof v.cancelVideoFrameCallback === 'function') v.cancelVideoFrameCallback(vfc)
    }
  }, [playing, commitT])

  useEffect(() => () => { videoRef.current?.pause() }, [])

  const patch = (id: number, p: Partial<Item>) => setItems(list => list.map(i => (i.id === id ? { ...i, ...p } : i)))

  const select = (it: Item) => {
    setSelId(it.id)
    seek(it.trueT ?? it.bottomT)
  }

  const playSlow = (it: Item) => {
    const v = videoRef.current
    if (!v) return
    const b = it.trueT ?? it.bottomT
    v.currentTime = Math.max(0, b - SLOW_PAD_SEC)
    v.playbackRate = SLOW_RATE
    stopAtRef.current = b + SLOW_PAD_SEC
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  const stopPlay = () => {
    videoRef.current?.pause()
    setPlaying(false)
  }

  const addHere = () => {
    const id = nextId.current++
    setItems(list => [...list, { id, source: 'added', bottomT: t, decision: 'ok' }])
    setSelId(id)
  }

  const removeAdded = (id: number) => {
    setItems(list => list.filter(i => i.id !== id))
    if (selId === id) setSelId(undefined)
  }

  /** 今のコマで角度を置く（初期位置はアプリの推定位置から少しずらす）。このコマを正解の位置にする */
  const startAngle = (it: Item) => {
    const f = nearestFrame(trace, t, 0.2)
    const base = f?.pts && f.pts.length === 3 ? f.pts : DEFAULT_PTS
    const pts = base.map((p, i) => ({ x: clamp01(p.x + START_OFFSET[i].x), y: clamp01(p.y + START_OFFSET[i].y) }))
    patch(it.id, { pts, ptsT: t, trueT: t, touched: false })
  }

  const clearAngle = (it: Item) => patch(it.id, { pts: undefined, ptsT: undefined, touched: false })

  const dragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const dragMove = (e: ReactPointerEvent<HTMLDivElement>, it: Item, idx: number) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const r = stageRef.current?.getBoundingClientRect()
    if (!r || r.width === 0 || r.height === 0 || !it.pts) return
    const p = { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
    patch(it.id, { pts: it.pts.map((q, i) => (i === idx ? p : q)), touched: true })
  }

  const angleOf = (it: Item): number | undefined =>
    it.pts && it.touched ? angleFromPoints(it.pts, vAspect) : undefined

  const allDecided = items.every(i => i.decision !== 'undecided')
  const result = useMemo(() => evaluate(
    appReps,
    items.filter(i => i.decision === 'ok').map(i => ({ bottomT: i.trueT ?? i.bottomT, angle: i.pts && i.touched ? angleFromPoints(i.pts, vAspect) : undefined })),
  ), [appReps, items, vAspect])

  const save = () => {
    const rec: AnswerKeyRecord = {
      id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      date: localToday(),
      exerciseKey: formKey,
      view,
      ...(phiDeg !== undefined ? { phiDeg } : {}),
      appReps: result.count.appReps,
      trueReps: result.count.trueReps,
      reps: result.rows,
    }
    if (alreadySaved || saved) return
    const next = addAnswerKey(rec)
    const list = next ?? [rec, ...loadAnswerKeys()]
    setSaved({ totals: summarizeKeys(list, formKey), ok: !!next })
    if (next) onSaved?.()
  }

  const isSaved = !!saved || !!alreadySaved
  const showHandles = !!sel && !!sel.pts && sel.ptsT !== undefined && Math.abs(t - sel.ptsT) < SAME_FRAME_SEC
  const selAngle = sel ? angleOf(sel) : undefined
  const selAppAngle = sel?.source === 'app' ? appReps.find((_, i) => i + 1 === sel.id)?.angle : undefined

  return (
    <div className="ak" role="dialog" aria-modal="true" aria-label={`${ex.name}の答え合わせ`}>
      <header className="ak-head">
        <h2 className="ak-title">答え合わせ：{ex.name}</h2>
        <button type="button" className="btn" onClick={onClose}>閉じる</button>
      </header>
      <div className="ak-body">
        <p className="ak-note">
          アプリが数えたレップを、コマ送りで確かめます。動画は保存しません。保存するのは、正解の回数と角度の数値だけです。
        </p>

        <div
          ref={stageRef}
          className="ak-stage"
          // 枠の縦横比を動画に合わせる（点とドラッグは枠基準、角度は動画の縦横比で計算するため）。高さは 55vh まで
          style={{ aspectRatio: String(vAspect), width: `min(100%, calc(55vh * ${vAspect}))` }}
        >
          <video
            ref={videoRef}
            className="ak-video"
            src={videoUrl}
            playsInline
            muted
            preload="auto"
            onLoadedMetadata={e => {
              setDur(e.currentTarget.duration)
              if (e.currentTarget.videoWidth > 0 && e.currentTarget.videoHeight > 0) setVAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight)
            }}
                        onError={() => setVideoError(true)}
          />
          {showHandles && sel?.pts?.map((p, i) => (
            <div
              key={i}
              className="ak-handle"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              role="slider"
              aria-label={`${JOINT_LABEL[(joints ?? [])[i]] ?? '関節'}の位置`}
              aria-valuenow={Math.round(p.x * 100)}
              onPointerDown={dragStart}
              onPointerMove={e => dragMove(e, sel, i)}
            >
              <span className="ak-dot" />
              <span className="ak-handle-label">{JOINT_LABEL[(joints ?? [])[i]] ?? ''}</span>
            </div>
          ))}
          {showHandles && sel?.pts && (
            <svg className="ak-lines" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
              <polyline points={sel.pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
        </div>
        {videoError && <p className="ak-error" role="alert">動画を読み込めませんでした。いったん閉じて、もう一度お試しください。</p>}

        <div className="ak-time" aria-live="off">
          <span>{sec(t)} / {sec(dur)}</span>
        </div>

        <div className="ak-timeline" aria-label="レップの位置">
          {dur > 0 && appReps.map((r, i) => (
            r.startT !== undefined && r.endT !== undefined && (
              <span
                key={`seg${i}`}
                className="ak-seg"
                style={{ left: `${(r.startT / dur) * 100}%`, width: `${Math.max(0, ((r.endT - r.startT) / dur) * 100)}%` }}
              />
            )
          ))}
          {dur > 0 && <span className="ak-cursor" style={{ left: `${(t / dur) * 100}%` }} />}
          {dur > 0 && items.map(it => (
            <button
              key={it.id}
              type="button"
              className={`ak-mark ak-mark-${it.decision}${it.id === selId ? ' ak-mark-sel' : ''}${it.source === 'added' ? ' ak-mark-added' : ''}`}
              style={{ left: `${(Math.min(dur, it.trueT ?? it.bottomT) / dur) * 100}%` }}
              aria-label={`${it.source === 'added' ? '追加' : 'アプリ'}のレップ（${bw}） ${sec(it.trueT ?? it.bottomT)}`}
              onClick={() => select(it)}
            >
              <span className="ak-mark-dot" />
            </button>
          ))}
        </div>
        <p className="ak-legend ak-muted">帯＝アプリが数えたレップの範囲　●＝{bw}（二重の枠＝追加、薄い＝削除）</p>

        <div className="ak-step">
          <button type="button" className="btn" onClick={() => void stepFrame(-1)}>◀ 前のコマ</button>
          <button type="button" className="btn" onClick={() => void stepFrame(1)}>次のコマ ▶</button>
        </div>
        <button type="button" className="btn ak-wide" onClick={addHere}>ここにレップを追加（今のコマを「{bw}」にする）</button>

        <h3 className="ak-h">レップ（{items.length} 件）</h3>
        {items.length === 0 && <p className="ak-muted">アプリが検出したレップはありません。見逃しは「ここにレップを追加」で入れてください。</p>}
        <ul className="ak-list">
          {items.map((it, n) => {
            const isSel = it.id === selId
            const label = it.source === 'added' ? '追加' : `レップ ${n + 1}`
            return (
              <li key={it.id} className={`card ak-item${isSel ? ' ak-item-sel' : ''}`}>
                <div className="ak-item-head">
                  <button type="button" className="btn ak-item-go" onClick={() => select(it)} aria-pressed={isSel}>
                    {label}　{bw} {sec(it.trueT ?? it.bottomT)}
                  </button>
                </div>
                <div className="ak-item-actions">
                  {it.source === 'app' ? (
                    <>
                      <button type="button" className="btn" aria-pressed={it.decision === 'ok'} onClick={() => patch(it.id, { decision: 'ok' })}>正しい</button>
                      <button type="button" className="btn" aria-pressed={it.decision === 'removed'} onClick={() => patch(it.id, { decision: 'removed' })}>削除（誤検出）</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-danger" onClick={() => removeAdded(it.id)}>この追加を取り消す</button>
                  )}
                </div>
                {it.source === 'app' && it.decision === 'undecided' && <p className="ak-muted ak-small">「正しい」か「削除」を選んでください</p>}
                {isSel && it.decision !== 'removed' && (
                  <div className="ak-sub">
                    <button type="button" className="btn" onClick={() => (playing ? stopPlay() : playSlow(it))}>
                      {playing ? '止める' : `0.25 倍速で再生（${bw}の前後）`}
                    </button>
                    {joints ? (
                      <>
                        {it.pts === undefined ? (
                          <button type="button" className="btn" onClick={() => startAngle(it)}>
                            今のコマで角度を測る（{joints.map(j => JOINT_LABEL[j]).join('・')}）
                          </button>
                        ) : (
                          <>
                            {!showHandles && (
                              <button type="button" className="btn" onClick={() => it.ptsT !== undefined && seek(it.ptsT)}>角度を置いたコマに戻る</button>
                            )}
                            <p className="ak-line">
                              {it.touched
                                ? `あなたの角度 ${deg(selAngle)}`
                                : '点を関節に合わせてドラッグしてください（動かすまで角度は記録されません）'}
                              {selAppAngle !== undefined && `　アプリ ${deg(selAppAngle)}`}
                            </p>
                            <button type="button" className="btn" onClick={() => clearAngle(it)}>角度を消す（回数だけにする）</button>
                          </>
                        )}
                      </>
                    ) : (
                      <p className="ak-muted ak-small">この種目は角度を置けません（回数だけの答え合わせです）</p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <section className="card ak-card" aria-label="この動画の結果">
          <h3 className="ak-h">この動画の結果</h3>
          {!allDecided ? (
            <p className="ak-muted">判定していないレップがあります。すべて選ぶと結果が出ます。</p>
          ) : (
            <>
              <p className="ak-line">
                正解 {result.count.trueReps} 回／アプリ {result.count.appReps} 回（差 {result.count.diff >= 0 ? '+' : ''}{result.count.diff}）
              </p>
              <p className="ak-line">
                一致 {result.count.matched}　誤検出 {result.count.falsePositives}　見逃し {result.count.misses}
              </p>
              <p className="ak-line">適合率 {pct(result.count.precision)}　再現率 {pct(result.count.recall)}　F1 {pct(result.count.f1)}</p>
              <AngleLines s={result.angle} />
              <p className="ak-note">一致＝「{bw}」の時刻の差が 0.5 秒以内。この比較で分かるのは、画面上（2D）での推定誤差です。</p>
              <button type="button" className="btn btn-primary ak-wide" onClick={save} disabled={isSaved}>
                {!isSaved ? 'この結果を保存して累計を見る' : saved && !saved.ok ? '保存できませんでした' : '保存済み'}
              </button>
            </>
          )}
        </section>

        {saved && (
          <>
            {!saved.ok && <p className="ak-error" role="alert">保存できませんでした。累計には今回の分を含めて表示しています（次回は残りません）</p>}
            <Totals t={saved.totals} name={ex.name} />
          </>
        )}
        <button type="button" className="btn ak-wide ak-close" onClick={onClose}>閉じる</button>
      </div>
    </div>
  )
}
