/**
 * フォーム採点の計算（純粋なロジック。React・MediaPipe に依存しない）。
 * 画面側が使うのは formKeyFor / setupGuide / RepTracker / summarizeSet / baselineFrom だけ。
 */
import type { Exercise } from '../types'
import type {
  Baseline, FormExerciseKey, FrameResult, Issue, Landmark, Phase, Pose, RepResult, SetSummary,
} from './types'
import { CONFIG, MIN_VISIBILITY, SIDE_INDEX, computeAngles, formIssues, makeIssue } from './rules'
import type { Joint, RepStats, Side } from './rules'
import { makeFrame, measureRep, median } from './measure'
import type { MeasureFrame, SetStats } from './measure'

/** 外れ値対策の中央値フィルタの窓（直近のフレーム数）。MediaPipe が内部で平滑化するので、それ以上はかけない */
const MEDIAN_WINDOW = 3
const SIDE_SWITCH_MARGIN = 0.1
const START_DROP = 10
const MIN_MOTION = 30
const MAX_REP_MS = 8000
const CUE_MS = 2000
const SHORT_ROM_RATIO = 0.9
const ROM_DROP_RATIO = 0.85
const FAST_DOWN_SEC = 1.0
const LEAN_CUE = '胸を起こして'

/** 種目名から採点対応の種目キーを決める。対応していなければ undefined */
export function formKeyFor(ex: Exercise): FormExerciseKey | undefined {
  const n = ex.name
  if (n.includes('スクワット') && !n.includes('ブルガリアン') && !n.includes('スプリット')) return 'squat'
  if (n.includes('ベンチプレス') && !n.includes('ダンベル') && !n.includes('インクライン')) return 'bench'
  if (n.includes('カール') && !n.includes('レッグ')) return 'curl'
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
}

const round = (v: number, digits: number): number => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

/** 1セット分のフレームを順に受け取り、レップを数えて採点する */
export class RepTracker {
  readonly key: FormExerciseKey
  readonly baseline?: Baseline

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
  private stats: SetStats = { segA: [], segB: [], worldLen: [], firstVelocities: [] }

  constructor(key: FormExerciseKey, baseline?: Baseline) {
    this.key = key
    this.baseline = baseline
  }

  /**
   * timeMs は単調増加するミリ秒（performance.now() など）。
   * world は worldLandmarks（メートル。あれば撮影角度と速度の換算に使う。無くても動く）。
   */
  push(pose: Pose | undefined, timeMs: number, world?: Pose): FrameResult {
    const cfg = CONFIG[this.key]
    const prevSide = this.side
    const pts = pose ? this.pickSide(pose, cfg.joints) : undefined
    if (!pts || !pose || !this.side) {
      this.rep?.frames.push({ t: timeMs, visible: false })
      return this.result(false, {}, timeMs)
    }
    // 使う側が変わったら別の関節の角度なので、中央値の窓を捨てる
    if (prevSide && prevSide !== this.side) this.recent = {}

    const raw = computeAngles(this.key, pts)
    const angles: Record<string, number> = {}
    for (const name of Object.keys(raw)) {
      const win = [...(this.recent[name] ?? []), raw[name]].slice(-MEDIAN_WINDOW)
      this.recent[name] = win
      angles[name] = median(win) as number
    }

    const a = angles[cfg.main]
    const frame = makeFrame(this.key, { t: timeMs, side: this.side, pts, pose, world, angle: a, angles })
    if (frame.segA !== undefined && frame.segB !== undefined) {
      this.stats.segA.push(frame.segA)
      this.stats.segB.push(frame.segB)
    }
    if (frame.worldLen !== undefined) this.stats.worldLen.push(frame.worldLen)
    let liveCue: string | undefined

    if (!this.rep) {
      if (a > cfg.top) {
        if (!this.armed || a > this.topPeak) this.leadFrame = frame
        this.topPeak = this.armed ? Math.max(this.topPeak, a) : a
        this.armed = true
        this.phase = 'top'
      } else if (this.armed && a < cfg.top - START_DROP) {
        this.rep = {
          startT: timeMs, minAngle: Infinity, minT: timeMs, startMax: this.topPeak, ranges: {},
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
        if (a > cfg.top) {
          this.finishRep(rep, a, timeMs)
          this.rep = undefined
          this.topPeak = a
          this.leadFrame = frame
          this.phase = 'top'
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

  reset(): void {
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
  }

  /** 左右のうち見えている側を選び、必要な関節が全部見えていればその座標を返す */
  private pickSide(pose: Pose, joints: Joint[]): Record<Joint, Landmark> | undefined {
    const meanVis = (side: Side) => {
      let sum = 0
      for (const j of joints) sum += pose[SIDE_INDEX[side][j]]?.visibility ?? 0
      return sum / joints.length
    }
    const l = meanVis('left')
    const r = meanVis('right')
    let side: Side
    if (this.side && Math.abs(l - r) < SIDE_SWITCH_MARGIN) side = this.side
    else side = r > l ? 'right' : 'left'
    const pts: Partial<Record<Joint, Landmark>> = {}
    for (const j of joints) {
      const lm = pose[SIDE_INDEX[side][j]]
      if (!lm || (lm.visibility ?? 0) < MIN_VISIBILITY) return undefined
      pts[j] = lm
    }
    this.side = side
    return pts as Record<Joint, Landmark>
  }

  private updateRep(
    rep: ActiveRep, angles: Record<string, number>, a: number, t: number, pts: Record<Joint, Landmark>, frame: MeasureFrame,
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

  private finishRep(rep: ActiveRep, endAngle: number, t: number) {
    const cfg = CONFIG[this.key]
    if (rep.minAngle > cfg.top - MIN_MOTION) return // ほとんど動いていない

    const maxAngle = Math.max(rep.startMax, endAngle)
    const romDeg = maxAngle - rep.minAngle
    const first = (rep.minT - rep.startT) / 1000
    // 後半はレップ判定の top を超えた時点で打ち切られる。top より上（伸ばしきり）までの分は
    // 角度の比率で引き延ばして推定する（curl は top 130° で、伸ばしきりの 150〜170° まで測れないため）
    const measured = cfg.top - rep.minAngle
    const stretch = measured > 0 ? Math.max(1, (Math.max(rep.startMax, endAngle) - rep.minAngle) / measured) : 1
    const second = ((t - rep.minT) / 1000) * stretch
    const eccentricSec = round(cfg.eccentricFirst ? first : second, 2)
    const concentricSec = round(cfg.eccentricFirst ? second : first, 2)

    const stats: RepStats = {
      minAngle: rep.minAngle, maxAngle, ranges: rep.ranges, hipY: rep.hipY, kneeY: rep.kneeY,
    }
    const issues: Issue[] = formIssues(this.key, stats)

    let romPct: number | undefined
    if (this.baseline && this.baseline.romDeg > 0) {
      romPct = round(romDeg / this.baseline.romDeg, 2)
      if (romPct < SHORT_ROM_RATIO) {
        const n = Math.round((1 - romPct) * 100)
        issues.push(makeIssue('short-rom', `いつもより可動域が${n}%狭い`, '基準動画と同じ深さ・伸びまで動かしましょう', 20))
      }
    }
    if (this.firstRom === undefined) this.firstRom = romDeg
    else if (romDeg < this.firstRom * ROM_DROP_RATIO) {
      issues.push(makeIssue('rom-drop', '疲れて可動域が狭くなっています', '可動域を保てる回数で止めるか、重量を下げましょう', 10))
    }
    if (eccentricSec < FAST_DOWN_SEC) {
      issues.push(makeIssue('fast-down', '下ろす動作が速すぎます', '1〜3秒かけてコントロールして下ろしましょう', 10))
    }

    const penalty = issues.reduce((s, i) => s + i.penalty, 0)
    const result: RepResult = {
      index: this.reps.length + 1,
      score: Math.max(0, Math.round(100 - penalty)),
      romDeg: round(romDeg, 1),
      romPct,
      eccentricSec,
      concentricSec,
      minAngle: round(rep.minAngle, 1),
      maxAngle: round(maxAngle, 1),
      issues,
    }
    const meas = measureRep(
      this.key, rep.frames, { startT: rep.startT, minT: rep.minT, endT: t }, this.stats, rep.lead,
    )
    result.metrics = meas.metrics
    // 速度低下の基準は最初の2レップ。バー軌道の基準は1レップ目
    if (meas.velocityNorm !== undefined && this.stats.firstVelocities.length < 2) {
      this.stats.firstVelocities.push(meas.velocityNorm)
    }
    if (this.reps.length === 0 && meas.path) this.stats.firstPath = meas.path
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
  return { reps: reps.length, avgScore, mainIssues, lengthenedOk }
}

/** 良いフォームのレップから基準を作る */
export function baselineFrom(rep: RepResult): Baseline {
  return { romDeg: rep.romDeg, minAngle: rep.minAngle, maxAngle: rep.maxAngle }
}

