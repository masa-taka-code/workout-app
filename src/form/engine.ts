/**
 * フォーム採点の計算（純粋なロジック。React・MediaPipe に依存しない）。
 * 画面側が使うのは formKeyFor / setupGuide / RepTracker / summarizeSet / baselineFrom だけ。
 */
import type { Exercise } from '../types'
import type {
  Baseline, FormExerciseKey, FrameResult, Issue, JointSource, Landmark, Phase, Pose, RepResult, SetSummary,
} from './types'
import { CONFIG, MAIN_JOINTS, MIN_VISIBILITY, SIDE_INDEX, computeAngles, computeMainAngle, formIssues, isLegKey, makeIssue } from './rules'
import type { Joint, RepStats, Side } from './rules'
import { LM } from './types'
import { isAngleOutOfRange, isOutlierLength, refineRep, SPIKE_RATIO } from './fill'
import { makeFrame, measureRep, median } from './measure'
import type { MeasureFrame, SetStats } from './measure'
import type { PlacementLevel } from './placement'
import { correctTilt, needsTiltCorrection } from './tilt'
import { judgeWorldTrust } from './world'

/** 外れ値対策の中央値フィルタの窓（直近のフレーム数）。MediaPipe が内部で平滑化するので、それ以上はかけない */
const MEDIAN_WINDOW = 3
const SIDE_SWITCH_MARGIN = 0.1
const START_DROP = 10
/**
 * 設計値・暫定：下ろす/上げる時間の計測の起点・終点を決める「伸びきり」の許容角度（度）。
 * レップの開始・終了は、そのレップ直前の伸びきりの最大角度（topPeak）からこの角度以内に戻った最後/最初のフレームとする。
 * 論文の値ではない。3° は角度推定のノイズ（中央値フィルタ後で 1〜2° 程度）より少し大きい値として仮置きした。
 */
const TOP_TOLERANCE = 3
/** 時間計測の起点をさかのぼるための角度の履歴の長さ（ミリ秒）。設計値・暫定 */
const HISTORY_MS = 3000
/** 上の位置（top）を超えてから、伸びきりに戻るのを待つ最長時間（ミリ秒）。設計値・暫定 */
const POST_WAIT_MS = 1000
const MIN_MOTION = 30
const MAX_REP_MS = 8000
const CUE_MS = 2000
const SHORT_ROM_RATIO = 0.9
const ROM_DROP_RATIO = 0.85
const FAST_DOWN_SEC = 1.0
const LEAN_CUE = '胸を起こして'
/** bss：左右の足首の前後の差がこれ未満なら前脚を決めない（正規化座標） */
const FRONT_LEG_MARGIN = 0.05
/**
 * 設計値・暫定：1コマだけの飛び（外れ値）の判定。直前に受け入れた位置から、骨の長さの SPIKE_RATIO 倍（欠けたコマ数だけ余裕を足す）を超えて動いたら飛びとみなす。
 * 連続してこの回数、飛びと判定されたら、本当に動いたとみなして受け入れる（見失った後の取り直し）。論文の値ではない。
 */
const SPIKE_RESYNC = 4
/** 設計値・暫定：コマの間隔の目安（ミリ秒、30fps）。飛びの余裕を、欠けたコマ数で広げるのに使う */
const NOMINAL_FRAME_MS = 1000 / 30
/** 設計値・暫定：骨の長さの基準を出すのに必要な、実測のコマ数の下限（立位の長さ setRefLengths が無いときだけ。それまでの最初の数コマは外れ値を判定しない）と、先頭から取るコマ数（0.5 秒＝15 コマ。仕様 3.2）と、基準を出し直す間隔 */
const REF_MIN_FRAMES = 5
const REF_INITIAL_FRAMES = 15
const REF_UPDATE_EVERY = 15
/**
 * 設計値・暫定：外れ値と判定されたコマがこの回数続いたら、基準（骨の長さ・直前の位置）が合わなくなったとみなして取り直す
 * （最初のコマが飛んでいた・人が大きく動いた・立位の長さが合わなくなったとき、全部のコマを捨て続けないため）
 */
const OUTLIER_STREAK_RESET = 8
/** 設計値・暫定：world の履歴の最大コマ数（超えたら古い方から捨てる）。judgeWorldTrust に使う */
const WORLD_BUF_MAX = 2400

/**
 * 最下点が推定のレップで減点しない v1 の崩れ（深さ・伸びきり）。analysis.ts の BASELINE_DEPTH_CODES（v2 の code）と対応する。
 * 設計値・暫定（仕様 3.7：最下点が推定のとき、浅さは確信度の上限を low にして減点しない）
 */
const DEPTH_ISSUES: readonly string[] = ['shallow', 'partial-bottom', 'partial-top']

/** 補正後のコマから、最小角度（同値なら最後のコマ）・主関節以外の角度の範囲・最下点の股関節と膝の y を出す */
function statsOf(frames: MeasureFrame[], main: string, fallbackT: number) {
  let minAngle = Infinity
  let minT = fallbackT
  let hipY: number | undefined
  let kneeY: number | undefined
  const ranges: Record<string, { min: number; max: number }> = {}
  for (const f of frames) {
    if (!f.visible || f.angle === undefined) continue
    if (f.angle <= minAngle) {
      minAngle = f.angle
      minT = f.t
      hipY = f.pts?.hip?.y
      kneeY = f.pts?.knee?.y
    }
    for (const name of Object.keys(f.angles ?? {})) {
      if (name === main) continue
      const v = (f.angles as Record<string, number>)[name]
      const r = ranges[name]
      if (!r) ranges[name] = { min: v, max: v }
      else {
        r.min = Math.min(r.min, v)
        r.max = Math.max(r.max, v)
      }
    }
  }
  return { minAngle, minT, hipY, kneeY, ranges }
}

/** 種目名から採点対応の種目キーを決める。対応していなければ undefined */
export function formKeyFor(ex: Exercise): FormExerciseKey | undefined {
  const n = ex.name
  if (n.includes('スクワット') && !n.includes('ブルガリアン') && !n.includes('スプリット')) return 'squat'
  if (n.includes('ベンチプレス') && !n.includes('ダンベル') && !n.includes('インクライン')) return 'bench'
  if (n.includes('カール') && !n.includes('レッグ')) return 'curl'
  if (n.includes('ルーマニアン') || n.includes('スティッフ')) return 'rdl'
  if (n.includes('ショルダープレス')) return 'ohp'
  if (n.includes('サイドレイズ') || n.includes('ラテラルレイズ')) return 'lateral'
  if (n.includes('ラットプルダウン')) return 'pulldown'
  if (n.includes('オーバーヘッドエクステンション')) return 'ohext'
  if (n.includes('ブルガリアン')) return 'bss'
  return undefined
}

/** 撮影のしかた（画面に出す説明） */
export function setupGuide(key: FormExerciseKey): string {
  switch (key) {
    case 'squat':
      return '真横から、頭から足先まで全身が入るように撮影してください。スマホは腰の高さに置くと正確です。'
    case 'bench':
      return 'ベンチの真横から、肩・肘・手首が入るように撮影してください。'
    case 'curl':
      return '真横から、肩・肘・手首・腰が入るように撮影してください。'
    case 'rdl':
      return '真横から、肩・腰・膝・足首が入るように撮影してください。上の位置（立った姿勢）から始めてください。'
    case 'ohp':
      return '真横から、肩・肘・手首・腰が入るように撮影してください。上の位置（腕を伸ばした姿勢）から始めてください。'
    case 'lateral':
      return '正面から、両肩・両腕・腰が入るように撮影してください。腕を下ろした姿勢から始めてください。'
    case 'pulldown':
      return '真横から、肩・肘・手首・腰が入るように撮影してください。上の位置（腕を伸ばした姿勢）から始めてください。'
    case 'ohext':
      return '真横から、肩・肘・手首が入るように撮影してください。上の位置（腕を伸ばした姿勢）から始めてください。'
    case 'bss':
      return '真横から、肩・腰・前脚の膝と足首が入るように撮影してください。カメラに近い側に前脚を置き、上の位置（立った姿勢）から始めてください。'
  }
}

interface ActiveRep {
  startT: number
  minAngle: number
  minT: number
  /** 開始前に伸びていた最大角度 */
  startMax: number
  ranges: Record<string, { min: number; max: number }>
  hipY?: number
  kneeY?: number
  /** レップ開始からのフレーム（見えなかったものも含む）。計測用 */
  frames: MeasureFrame[]
  /** 開始前に最も伸びていたフレーム */
  lead?: MeasureFrame
  /** 上の位置（top）を超えたあと、伸びきりに戻るのを待っている間の状態 */
  post?: { crossT: number; peak: number; peakT: number; peakFrame: MeasureFrame }
}

const round = (v: number, digits: number): number => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

/** push の追加の入力（撮影条件の判定と、スマホの傾き） */
export interface PushOptions {
  /** このフレームの撮影条件の判定（placement.ts。直近 1 秒の中央値）。無ければ判定しない */
  placement?: PlacementLevel
  /**
   * 補正に使うスマホの傾き（度、画像上の向き。tilt.ts）。計測を始めた時点の値をセットのあいだ固定して渡す。
   * 分かっていれば常に、座標を −傾き 分回してから計測する。不明なら undefined（補正しない）。
   */
  tiltDeg?: number
}

/** 1セット分のフレームを順に受け取り、レップを数えて採点する */
export class RepTracker {
  readonly key: FormExerciseKey
  /** 可動域の基準（short-rom の判定用）。撮影条件が分かった時点で setBaseline で差し替える */
  baseline?: Baseline

  /** 角度ごとの直近フレームの生の値（中央値フィルタ用） */
  private recent: Record<string, number[]> = {}
  private side?: Side
  private armed = false
  private topPeak = 0
  private rep?: ActiveRep
  private prevAngle?: number
  private phase: Phase = 'idle'
  private reps: RepResult[] = []
  private firstRom?: number
  private lastCue?: { text: string; t: number }
  /** 伸びた状態（top）でいちばん角度が大きかったフレーム */
  private leadFrame?: MeasureFrame
  /** 直近 HISTORY_MS 分の（時刻, 主角度）。レップ開始の時刻をさかのぼって決めるのに使う */
  private history: { t: number; a: number }[] = []
  private stats: SetStats = { segA: [], segB: [], worldLen: [], firstVelocities: [] }
  /** 関節ごとに、直前に受け入れた位置（飛びの判定用）と、飛びと判定した連続回数 */
  private last: Partial<Record<Joint, { x: number; y: number; t: number }>> = {}
  private rejects: Partial<Record<Joint, number>> = {}
  /** 直前のコマが受け入れられなかった（主関節が欠けた）か。欠けのあとは中央値の窓を捨てる */
  private gap = false
  /** セットのこれまでの world（worldTrust の判定用） */
  private worldBuf: Pose[] = []
  /** 立位の骨の長さ（画面上。setRefLengths で渡す。無ければ最初の 0.5 秒の中央値） */
  private standingLens?: { a: number; b: number }
  private refCache?: { a: number; b: number }
  /** 試験的な 3D 角度（lift3d.ts）を記録するか。既定オフ。記録だけで採点には使わない */
  private lift3dOn = false
  /** 3D 角度に使う立位の骨の長さ（setRefLengths の値。外れ値の基準の取り直しでは消さない） */
  private lift3dLens?: { a: number; b: number }
  private refCacheN = 0
  /** 骨の長さの基準を出すための、実測のコマの体節長（画面上）。基準を取り直すときに捨てる（measure に渡す stats とは別） */
  private refSamples: { a: number[]; b: number[] } = { a: [], b: [] }
  /** 外れ値と判定されたコマが続いている数 */
  private flagStreak = 0

  constructor(key: FormExerciseKey, baseline?: Baseline) {
    this.key = key
    this.baseline = baseline
  }

  /**
   * 立位の骨の長さ（画面上。StandingSnapshot の segA・segB）を渡す。外れ値（骨より長すぎる・飛び）の判定の基準になる。
   * 渡さない（動画ファイルなど）ときは、最初の 0.5 秒の実測の中央値を使う。セットをまたいで残る（reset では消えない）
   */
  setRefLengths(segA?: number, segB?: number): void {
    this.standingLens = segA && segB ? { a: segA, b: segB } : undefined
    this.lift3dLens = this.standingLens
    this.refCache = undefined
  }

  /** 試験的な 3D 角度を RepMetrics.angle3dBottom に記録するか（設定 AppData.form3d。既定オフ。オフなら計算しない） */
  setLift3d(on: boolean): void {
    this.lift3dOn = on
  }

  /** 基準を差し替える（待機中の立位から撮影条件が分かり、基準と合うか決まったあとに呼ぶ） */
  setBaseline(baseline?: Baseline): void {
    this.baseline = baseline
  }

  /**
   * timeMs は単調増加するミリ秒（performance.now() など）。
   * world は worldLandmarks（メートル。あれば撮影角度と速度の換算に使う。無くても動く）。
   */
  push(rawPose: Pose | undefined, timeMs: number, world?: Pose, opts: PushOptions = {}): FrameResult {
    const cfg = CONFIG[this.key]
    const joints = cfg.joints
    // 傾きが分かっていれば、鉛直を基準にする計測（体幹・すねの前傾など）の前に座標を補正する（角度・長さは変わらない）
    const pose = rawPose && needsTiltCorrection(opts.tiltDeg) ? correctTilt(rawPose, opts.tiltDeg) : rawPose
    if (!pose) {
      const src: Partial<Record<Joint, JointSource>> = {}
      for (const j of joints) src[j] = 'missing'
      this.gap = true
      this.rep?.frames.push({ t: timeMs, visible: false, src })
      this.confirmPostOnTimeout(timeMs)
      return this.result(false, {}, timeMs)
    }
    if (world) {
      this.worldBuf.push(world)
      if (this.worldBuf.length > WORLD_BUF_MAX) this.worldBuf.splice(0, WORLD_BUF_MAX / 4)
    }
    // 関節ごとに「見えている（measured）」かを決める。1点が見えないだけでコマ全体は捨てない（短い欠けはレップの終わりに補う。fill.ts）
    const side = this.chooseSide(pose, joints)
    const pts: Partial<Record<Joint, Landmark>> = {}
    const src: Partial<Record<Joint, JointSource>> = {}
    for (const j of joints) {
      const lm = pose[SIDE_INDEX[side][j]]
      if (lm && (lm.visibility ?? 0) >= MIN_VISIBILITY) {
        pts[j] = lm
        src[j] = 'measured'
      } else src[j] = 'missing'
    }
    if (this.flagOutliers(pts, src, timeMs)) {
      if (++this.flagStreak >= OUTLIER_STREAK_RESET) this.resetRef()
    } else this.flagStreak = 0
    // 回数を数えるのは、主関節の 3 点が揃っているコマだけ（それ以外のコマは、レップの終わりの補正のために残す）
    if (!MAIN_JOINTS[this.key].every(j => src[j] === 'measured')) {
      this.gap = true
      this.rep?.frames.push({ t: timeMs, visible: false, side, pose, world, pts, src, placement: opts.placement })
      this.confirmPostOnTimeout(timeMs)
      return this.result(false, {}, timeMs)
    }
    const prevSide = this.side
    this.side = side
    // 使う側が変わったら別の関節の角度なので、中央値の窓を捨てる。欠けのあとも、古い値が混ざらないよう捨てる
    if ((prevSide && prevSide !== side) || this.gap) this.recent = {}
    this.gap = false

    const full = joints.every(j => src[j] === 'measured')
    const raw = full
      ? computeAngles(this.key, pts as Record<Joint, Landmark>, pose)
      : { [cfg.main]: computeMainAngle(this.key, pts) as number }
    const angles: Record<string, number> = {}
    for (const name of Object.keys(raw)) {
      const win = [...(this.recent[name] ?? []), raw[name]].slice(-MEDIAN_WINDOW)
      this.recent[name] = win
      angles[name] = median(win) as number
    }

    const a = angles[cfg.main]
    const frame = makeFrame(this.key, { t: timeMs, side, pts, pose, world, angle: a, angles, placement: opts.placement, src })
    if (frame.segA !== undefined && frame.segB !== undefined) {
      this.stats.segA.push(frame.segA)
      this.stats.segB.push(frame.segB)
      this.refSamples.a.push(frame.segA)
      this.refSamples.b.push(frame.segB)
    }
    if (frame.worldLen !== undefined) this.stats.worldLen.push(frame.worldLen)
    let liveCue: string | undefined

    this.history.push({ t: timeMs, a })
    while (this.history.length > 1 && timeMs - this.history[0].t > HISTORY_MS) this.history.shift()

    if (!this.rep) {
      if (a > cfg.top) {
        if (!this.armed || a > this.topPeak) this.leadFrame = frame
        this.topPeak = this.armed ? Math.max(this.topPeak, a) : a
        this.armed = true
        this.phase = 'top'
      } else if (this.armed && a < cfg.top - START_DROP) {
        // 時間の計測は、伸びきり（topPeak − TOP_TOLERANCE 以上）だった最後のフレームから始める
        this.rep = {
          startT: this.lookbackStart(this.topPeak - TOP_TOLERANCE, timeMs), minAngle: Infinity, minT: timeMs, startMax: this.topPeak, ranges: {},
          frames: [], lead: this.leadFrame,
        }
        this.prevAngle = a
        this.updateRep(this.rep, angles, a, timeMs, pts, frame)
        this.phase = 'down'
      } else {
        this.phase = this.armed ? 'top' : 'idle'
      }
    } else {
      const rep = this.rep
      if (timeMs - rep.startT >= MAX_REP_MS) {
        // 8秒以上戻らない：レップにしない
        this.rep = undefined
        this.armed = false
        this.phase = 'idle'
      } else {
        this.updateRep(rep, angles, a, timeMs, pts, frame)
        if (rep.post) {
          if (a > rep.post.peak) rep.post = { ...rep.post, peak: a, peakT: timeMs, peakFrame: frame }
        } else if (a > cfg.top) {
          rep.post = { crossT: timeMs, peak: a, peakT: timeMs, peakFrame: frame }
        }
        const post = rep.post
        if (post) {
          // 伸びきり（topPeak − TOP_TOLERANCE）に戻った時点を終点にする。戻らないまま
          // 折り返す・時間切れのときは、最も伸びた時点を終点にする
          const reached = a >= rep.startMax - TOP_TOLERANCE
          const turned = a < post.peak - TOP_TOLERANCE
          const timeout = timeMs - post.crossT >= POST_WAIT_MS
          if (reached || turned || timeout) {
            this.completeRep(rep, reached ? timeMs : post.peakT, timeMs)
          } else {
            this.phase = 'top'
          }
        } else {
          const prev = this.prevAngle ?? a
          if (a > rep.minAngle + 3) this.phase = 'up'
          else if (prev - a > 0.5) this.phase = 'down'
          else this.phase = 'bottom'
        }
      }
      this.prevAngle = a
    }

    if (this.key === 'squat' && this.rep && (angles.torso ?? 0) > 55) liveCue = LEAN_CUE
    return this.result(true, angles, timeMs, liveCue)
  }

  /**
   * 計測を終えるときに呼ぶ。伸びきりに戻るのを待っている最中のレップがあれば、最も伸びた時点を終点に確定する。
   * 返す値は push と同じ形（直近の状態）。
   */
  flush(): RepResult[] {
    const rep = this.rep
    if (rep?.post) this.completeRep(rep, rep.post.peakT, rep.post.peakT)
    return [...this.reps]
  }

  /** 伸びきり待ちのまま、見えないコマ（姿勢なし・主関節が欠け）が続いても、時間切れで最も伸びた時点を終点に確定する */
  private confirmPostOnTimeout(timeMs: number) {
    const rep = this.rep
    if (rep?.post && timeMs - rep.post.crossT >= POST_WAIT_MS) this.completeRep(rep, rep.post.peakT, timeMs)
  }

  /** 上の位置を超えたレップを確定する。endT は時間計測の終点、nowT は確定した時刻（cue の表示開始） */
  private completeRep(rep: ActiveRep, endT: number, nowT: number) {
    const post = rep.post
    if (!post) return
    this.finishRep(rep, post.peak, endT, nowT)
    this.rep = undefined
    this.topPeak = post.peak
    this.leadFrame = post.peakFrame
    this.phase = 'top'
  }

  /** 履歴をさかのぼり、角度が target 以上だった最後のフレームの時刻を返す。無ければ履歴の最古の時刻 */
  private lookbackStart(target: number, fallbackT: number): number {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].a >= target) return this.history[i].t
    }
    return this.history[0]?.t ?? fallbackT
  }

  reset(): void {
    this.history = []
    this.recent = {}
    this.side = undefined
    this.armed = false
    this.topPeak = 0
    this.rep = undefined
    this.prevAngle = undefined
    this.phase = 'idle'
    this.reps = []
    this.firstRom = undefined
    this.lastCue = undefined
    this.leadFrame = undefined
    this.stats = { segA: [], segB: [], worldLen: [], firstVelocities: [] }
    this.last = {}
    this.rejects = {}
    this.gap = false
    this.worldBuf = []
    this.refCache = undefined
    this.refCacheN = 0
    this.refSamples = { a: [], b: [] }
    this.flagStreak = 0
  }

  /** 左右のうち見えている側（visibility の平均が高い方。直前の側と近いときは直前の側）を選ぶ。bss は前脚を優先する */
  private chooseSide(pose: Pose, joints: Joint[]): Side {
    if (this.key === 'bss') {
      const front = this.pickFrontLeg(pose, joints)
      if (front) return front
    }
    const meanVis = (side: Side) => {
      let sum = 0
      for (const j of joints) sum += pose[SIDE_INDEX[side][j]]?.visibility ?? 0
      return sum / joints.length
    }
    const l = meanVis('left')
    const r = meanVis('right')
    if (this.side && Math.abs(l - r) < SIDE_SWITCH_MARGIN) return this.side
    return r > l ? 'right' : 'left'
  }

  /**
   * 骨の長さの基準（画面上の太もも／上腕、すね／前腕）。立位の長さ（setRefLengths）か最初の 0.5 秒の実測の中央値と、
   * セットのこれまでの実測の中央値の大きい方（撮影の向きで短く見えても、立位の長さを下回らないようにするため）。
   * 実測のコマが REF_MIN_FRAMES 未満で立位の長さも無ければ undefined（外れ値の判定をしない）。
   */
  private refLens(): { a: number; b: number } | undefined {
    const n = this.refSamples.a.length
    if (!this.standingLens && n < REF_MIN_FRAMES) return undefined
    // 最初の 15 コマのあいだは毎コマ出し直す（先頭が飛んでいても、早く直る）。そのあとは 15 コマごと
    if (!this.refCache || n < REF_INITIAL_FRAMES || n - this.refCacheN >= REF_UPDATE_EVERY) {
      const initial = this.standingLens ?? {
        a: median(this.refSamples.a.slice(0, REF_INITIAL_FRAMES)) as number,
        b: median(this.refSamples.b.slice(0, REF_INITIAL_FRAMES)) as number,
      }
      this.refCache = {
        a: Math.max(initial.a, median(this.refSamples.a) ?? 0),
        b: Math.max(initial.b, median(this.refSamples.b) ?? 0),
      }
      this.refCacheN = n
    }
    return this.refCache
  }

  /** 外れ値の判定の基準（直前の位置・骨の長さ・立位の長さ）を捨てて、次のコマから取り直す */
  private resetRef() {
    this.last = {}
    this.rejects = {}
    this.refCache = undefined
    this.refCacheN = 0
    this.refSamples = { a: [], b: [] }
    this.standingLens = undefined
    this.flagStreak = 0
  }

  /**
   * 外れ値（あり得ない位置）の関節を欠け（missing）にする。設計値・暫定（論文の値ではない。仕様 3.2）。
   * 1. 飛び：直前に受け入れた位置から骨の長さの SPIKE_RATIO 倍を超えて動いた（欠けたコマ数だけ余裕を足す）。連続 SPIKE_RESYNC 回で受け入れ直す。
   * 2. 骨が長すぎる：画面上の骨の長さが基準の 1.15 倍を超える（投影は骨の長さを超えない）。両端のうち visibility が低い方、同じなら他の長すぎる骨と共有する関節、それも無ければ両端。
   * 3. 可動域の外：主関節の角度が膝 25° 未満・肘 20° 未満。どの点が原因か分からないので主関節の 3 点すべて。
   * 骨の長さの基準が無い間は 1・2 をしない。受け入れた関節の位置を this.last に残す。
   */
  private flagOutliers(pts: Partial<Record<Joint, Landmark>>, src: Partial<Record<Joint, JointSource>>, t: number): boolean {
    const cfg = CONFIG[this.key]
    let flagged = false
    const drop = (j: Joint) => {
      delete pts[j]
      src[j] = 'missing'
      flagged = true
    }
    const ref = this.refLens()
    if (ref) {
      const lim = SPIKE_RATIO * Math.min(ref.a, ref.b)
      for (const j of cfg.joints) {
        const p = pts[j]
        const last = this.last[j]
        if (!p || !last) continue
        const frames = Math.max(1, (t - last.t) / NOMINAL_FRAME_MS)
        if (Math.hypot(p.x - last.x, p.y - last.y) > lim * frames) {
          const n = (this.rejects[j] ?? 0) + 1
          if (n < SPIKE_RESYNC) { this.rejects[j] = n; drop(j) } else this.rejects[j] = 0
        } else this.rejects[j] = 0
      }
      // 骨が長すぎる
      const bones: [Joint, Joint, number][] = isLegKey(this.key)
        ? [['hip', 'knee', ref.a], ['knee', 'ankle', ref.b]]
        : [['shoulder', 'elbow', ref.a], ['elbow', 'wrist', ref.b]]
      const flagged = bones.filter(([u, v, L]) => {
        const pu = pts[u]
        const pv = pts[v]
        return cfg.joints.includes(u) && cfg.joints.includes(v) && !!pu && !!pv && isOutlierLength(Math.hypot(pu.x - pv.x, pu.y - pv.y), L)
      })
      const shared = (j: Joint) => flagged.filter(([u, v]) => u === j || v === j).length > 1
      for (const [u, v] of flagged) {
        const vu = pts[u]?.visibility ?? 0
        const vv = pts[v]?.visibility ?? 0
        if (Math.abs(vu - vv) >= 0.05) drop(vu < vv ? u : v)
        else if (shared(u)) drop(u)
        else if (shared(v)) drop(v)
        else { drop(u); drop(v) }
      }
    }
    // 可動域の外
    const main = MAIN_JOINTS[this.key]
    if ((cfg.main === 'knee' || cfg.main === 'elbow') && main.every(j => src[j] === 'measured')) {
      const ang = computeMainAngle(this.key, pts)
      if (ang !== undefined && isAngleOutOfRange(cfg.main, ang)) for (const j of main) drop(j)
    }
    for (const j of cfg.joints) {
      const p = pts[j]
      if (p) this.last[j] = { x: p.x, y: p.y, t }
    }
    return flagged
  }

  /**
   * bss：足首が前にある方の脚を前脚とする（体の向きは鼻と両肩の中点の位置関係）。
   * 向きが分からない、または片側しか見えていないときは undefined（通常の visibility の高い方に任せる）。
   */
  private pickFrontLeg(pose: Pose, joints: Joint[]): Side | undefined {
    const seen = (side: Side) =>
      joints.every(j => (pose[SIDE_INDEX[side][j]]?.visibility ?? 0) >= MIN_VISIBILITY)
    if (!seen('left') || !seen('right')) return undefined
    const nose = pose[LM.nose]
    const ls = pose[LM.leftShoulder]
    const rs = pose[LM.rightShoulder]
    if (!nose || (nose.visibility ?? 0) < MIN_VISIBILITY || !ls || !rs) return undefined
    const dx = nose.x - (ls.x + rs.x) / 2
    if (Math.abs(dx) < 1e-6) return undefined
    const facing = dx > 0 ? 1 : -1
    const la = pose[SIDE_INDEX.left.ankle].x * facing
    const ra = pose[SIDE_INDEX.right.ankle].x * facing
    if (Math.abs(la - ra) < FRONT_LEG_MARGIN) return undefined
    return la > ra ? 'left' : 'right'
  }

  private updateRep(
    rep: ActiveRep, angles: Record<string, number>, a: number, t: number, pts: Partial<Record<Joint, Landmark>>, frame: MeasureFrame,
  ) {
    rep.frames.push(frame)
    // 同じ値が続くとき（底で止まったとき）は最後のフレームを最下点にする（止まっている間を「上げる動作」に数えない）
    if (a <= rep.minAngle) {
      rep.minAngle = a
      rep.minT = t
      rep.hipY = pts.hip?.y
      rep.kneeY = pts.knee?.y
    }
    for (const name of Object.keys(angles)) {
      if (name === CONFIG[this.key].main) continue
      const v = angles[name]
      const r = rep.ranges[name]
      if (!r) rep.ranges[name] = { min: v, max: v }
      else {
        r.min = Math.min(r.min, v)
        r.max = Math.max(r.max, v)
      }
    }
  }

  /** endAngle は伸びきり側の最大角度、endT は時間計測の終点、t は確定した時刻 */
  private finishRep(rep: ActiveRep, endAngle: number, endT: number, t: number) {
    const cfg = CONFIG[this.key]
    // 見えなかった関節の補正（短い欠けの補間・奥側での代用。fill.ts）。レップが終わってから計測するので、前後のコマが使える
    const frames = refineRep(this.key, rep.frames, { lens: this.refLens() })
    // 最小角度・可動域外の角度の範囲・最下点の位置は、補正後のコマから出し直す（欠けが最下点にかかると、捨てたままでは浅く出る）
    const fin = statsOf(frames, cfg.main, rep.minT)
    if (fin.minAngle > cfg.top - MIN_MOTION) return // ほとんど動いていない

    const maxAngle = Math.max(rep.startMax, endAngle)
    const romDeg = maxAngle - fin.minAngle
    const first = (fin.minT - rep.startT) / 1000
    // 時間は、伸びきり（topPeak − TOP_TOLERANCE）から最下点まで、最下点から伸びきりまで
    const second = (endT - fin.minT) / 1000
    const eccentricSec = round(cfg.eccentricFirst ? first : second, 2)
    const concentricSec = round(cfg.eccentricFirst ? second : first, 2)

    // 計測を先にする：撮影条件が悪いレップ（placementOk=false）は、減点・崩れの判定・基準づくりから外す
    // world は、セットのこれまでの履歴から信用できるかを判定する（信用できなければ φ は 2D の比、速度はメートルに換算しない）
    const worldTrust = this.worldBuf.length > 0
      ? judgeWorldTrust(this.key, this.worldBuf.map(w => ({ world: w })), { side: this.side }).trust
      : undefined
    const meas = measureRep(
      this.key, frames, { startT: rep.startT, minT: fin.minT, endT }, this.stats, rep.lead,
      { worldTrust, lift3d: this.lift3dOn ? this.lift3dLens : undefined },
    )
    const excluded = meas.metrics.placementOk === false
    // 最下点が推定（欠けを補った・代用した・埋められなかった）のレップは、深さを断定できないので、深さ・可動域に関わる減点をしない
    const bottomEstimated = meas.metrics.bottomEstimated === true

    const stats: RepStats = {
      minAngle: fin.minAngle, maxAngle, ranges: fin.ranges, hipY: fin.hipY, kneeY: fin.kneeY,
    }
    const issues: Issue[] = excluded ? [] : formIssues(this.key, stats).filter(i => !(bottomEstimated && DEPTH_ISSUES.includes(i.code)))

    let romPct: number | undefined
    if (!excluded && !bottomEstimated && this.baseline && this.baseline.romDeg > 0) {
      romPct = round(romDeg / this.baseline.romDeg, 2)
      if (romPct < SHORT_ROM_RATIO) {
        const n = Math.round((1 - romPct) * 100)
        issues.push(makeIssue('short-rom', `いつもより可動域が${n}%狭い`, '基準動画と同じ深さ・伸びまで動かしましょう', 20))
      }
    }
    if (!excluded) {
      if (!bottomEstimated) {
        if (this.firstRom === undefined) this.firstRom = romDeg
        else if (romDeg < this.firstRom * ROM_DROP_RATIO) {
          issues.push(makeIssue('rom-drop', '疲れて可動域が狭くなっています', '可動域を保てる回数で止めるか、重量を下げましょう', 10))
        }
      }
      // 最下点が推定のレップは、下ろす時間も断定できないのでテンポの減点をしない
      if (!bottomEstimated && eccentricSec < FAST_DOWN_SEC) {
        issues.push(makeIssue('fast-down', '下ろす動作が速すぎます', '1〜3秒かけてコントロールして下ろしましょう', 10))
      }
    }

    const penalty = issues.reduce((s, i) => s + i.penalty, 0)
    const result: RepResult = {
      index: this.reps.length + 1,
      score: Math.max(0, Math.round(100 - penalty)),
      romDeg: round(romDeg, 1),
      romPct,
      eccentricSec,
      concentricSec,
      minAngle: round(fin.minAngle, 1),
      maxAngle: round(maxAngle, 1),
      issues,
    }
    result.metrics = meas.metrics
    // 速度低下の基準は最初の2レップ。バー軌道の基準は1レップ目（撮影条件が悪いレップは基準にしない）
    if (!excluded && meas.velocityNorm !== undefined && this.stats.firstVelocities.length < 2) {
      this.stats.firstVelocities.push(meas.velocityNorm)
    }
    // 1レップ目（撮影条件が悪い回は数えない）の軌道を基準にする
    const isFirstGood = this.reps.every(r => r.metrics?.placementOk === false)
    if (!excluded && isFirstGood && meas.path) this.stats.firstPath = meas.path
    this.reps.push(result)

    const worst = issues.reduce<Issue | undefined>((w, i) => (!w || i.penalty > w.penalty ? i : w), undefined)
    this.lastCue = worst ? { text: worst.message, t } : undefined
  }

  private result(visible: boolean, angles: Record<string, number>, timeMs: number, liveCue?: string): FrameResult {
    let cue = liveCue
    if (!cue && this.lastCue && timeMs - this.lastCue.t < CUE_MS) cue = this.lastCue.text
    return { visible, angles, phase: this.phase, reps: [...this.reps], cue }
  }
}

/**
 * セットの要約。key を渡すと、基準がないときの「伸びた位置まで動かせたか」を種目に合わせて判定する。
 * 省略時は shallow と partial-bottom の両方が無いことで判定する。
 */
export function summarizeSet(reps: RepResult[], key?: FormExerciseKey): SetSummary {
  if (reps.length === 0) return { reps: 0, avgScore: 0, mainIssues: [], lengthenedOk: false }

  // 撮影条件が悪かったレップ（placementOk=false）は回数には数えるが、平均点・崩れ・可動域の判定からは外す
  const total = reps.length
  const judged = reps.filter((r) => r.metrics?.placementOk !== false)
  if (judged.length === 0) return { reps: total, avgScore: 0, mainIssues: [], lengthenedOk: false }
  reps = judged
  const avgScore = Math.round(reps.reduce((s, r) => s + r.score, 0) / reps.length)

  const groups = new Map<string, { issue: Issue; count: number }>()
  for (const r of reps) {
    for (const i of r.issues) {
      const g = groups.get(i.code)
      if (g) g.count++
      else groups.set(i.code, { issue: i, count: 1 })
    }
  }
  const mainIssues = [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((g) => g.issue)

  let lengthenedOk: boolean
  if (reps.some((r) => r.romPct !== undefined)) {
    lengthenedOk = reps.every((r) => (r.romPct ?? 0) >= SHORT_ROM_RATIO)
  } else {
    const bad = (code: string) => reps.some((r) => r.issues.some((i) => i.code === code))
    if (key === 'squat' || key === 'bench') lengthenedOk = !bad('shallow')
    else if (key === 'curl') lengthenedOk = !bad('partial-bottom')
    else lengthenedOk = !bad('shallow') && !bad('partial-bottom')
  }
  return { reps: total, avgScore, mainIssues, lengthenedOk }
}

/**
 * 良いフォームの 1 レップから基準を作る。
 * @deprecated 自分の基準は baseline.ts の buildBaseline（条件の良い複数レップの中央値）で作る。旧形式の読み替えと互換のためだけに残している。
 */
export function baselineFrom(rep: RepResult): Baseline {
  const b: Baseline = { romDeg: rep.romDeg, minAngle: rep.minAngle, maxAngle: rep.maxAngle }
  if (rep.metrics?.trunkLeanMax !== undefined) b.trunkLeanMax = rep.metrics.trunkLeanMax
  return b
}

