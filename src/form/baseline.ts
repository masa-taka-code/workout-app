/**
 * 自分の基準（B4）：条件の良い複数レップの中央値から作る基準と、その使い方（純粋関数）。
 *
 * 1 レップだけの基準は、そのレップの誤差（姿勢推定・撮影角度）をそのまま「自分の基準」にしてしまうので、
 * 条件の良い 3〜5 レップの中央値とばらつき（MAD）で作る。撮影条件（向き・φ・側・体節長）が基準のときと違うときは、
 * 基準を使わず一般のしきい値で判定する（baselineCompat）。
 *
 * 以下の数値はすべて「設計値・暫定」。論文の値ではない。実際の撮影データで見直す。
 */
import type { Baseline, BaselineConditions, BaselineMetric, BaselineStat, FormExerciseKey, PersonalBaseline, RepResult, StandingSnapshot, ViewKind } from './types'
import { generalFaultCodes } from './analysis'
import { median } from './measure'
import { SEG_RATIO_MAX, SEG_RATIO_MIN } from './placement'

/** 設計値・暫定：基準に使うレップ数の下限（これ未満は作らない）と上限（先頭から数える） */
export const BASELINE_MIN_REPS = 3
export const BASELINE_MAX_REPS = 5
/** 設計値・暫定：基準に使うレップの信頼度の下限（通常の分析の 0.6 より厳しくする） */
export const BASELINE_MIN_CONFIDENCE = 0.8
/** 設計値・暫定：MAD を標準偏差の相当値にする係数（正規分布の場合） */
const MAD_SCALE = 1.4826
/** 設計値・暫定：基準と今の φ の差がこれを超えたら、基準を使わない（度） */
export const BASELINE_PHI_DIFF_DEG = 15
/** 設計値・暫定：判定の余裕の最低値。角度は 8°、かかとの浮きは 0.02（脚の長さに対する比）。ばらつきが大きければ 2×MAD */
export const MARGIN_MIN_ANGLE = 8
export const MARGIN_MIN_HEEL = 0.02
/** 設計値・暫定：基準の更新をすすめる日数と、重量の差の割合 */
export const BASELINE_STALE_DAYS = 56
export const BASELINE_WEIGHT_DIFF = 0.2

/** 値が 3 つ以上あれば中央値と 1.4826×MAD。3 未満は mad=0。空なら undefined */
export function statOf(values: number[]): BaselineStat | undefined {
  const med = median(values)
  if (med === undefined) return undefined
  if (values.length < BASELINE_MIN_REPS) return { med, mad: 0 }
  const mad = median(values.map(v => Math.abs(v - med))) as number
  return { med, mad: mad * MAD_SCALE }
}

/** 設計値・暫定：推定のコマ（見えなかった関節を補ったコマ）の割合がこれ以上のレップは、基準づくりに使わない（仕様 3.7） */
export const BASELINE_MAX_ESTIMATED = 0.2

/**
 * 基準に使えるレップか：計測値があり、信頼度 0.8 以上、向きが ok、撮影条件が不良でない。
 * 見えなかった関節の補正が入ったレップ（推定の割合 0.2 以上、奥側で代用、最下点が推定）は使わない（推定した値を「自分の基準」にしない）。
 */
export function isBaselineRep(r: RepResult): boolean {
  const m = r.metrics
  return !!m && m.confidence >= BASELINE_MIN_CONFIDENCE && m.viewOk === 'ok' && m.placementOk !== false
    && (m.estimatedRatio ?? 0) < BASELINE_MAX_ESTIMATED && !m.mirrored && !m.bottomEstimated
}

/** レップから取る指標の値 */
function metricValue(r: RepResult, metric: BaselineMetric): number | undefined {
  if (metric === 'minAngle') return r.minAngle
  if (metric === 'maxAngle') return r.maxAngle
  if (metric === 'romDeg') return r.romDeg
  return r.metrics?.[metric]
}

const METRICS: BaselineMetric[] = [
  'minAngle', 'maxAngle', 'romDeg', 'kneeFlexionBottom', 'trunkLeanMax',
  'hipFlexionBottom', 'elbowFlexionBottom', 'elbowExtensionTop', 'heelLift',
]

/** 最頻値（同数なら先に出たもの） */
function modeOf<T>(xs: T[]): T | undefined {
  const count = new Map<T, number>()
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1)
  let best: T | undefined
  let bc = 0
  for (const [x, c] of count) if (c > bc) { best = x; bc = c }
  return best
}

/**
 * 今のセットの撮影条件。standing（ライブ撮影の立位）があればその値、無い（動画）ときはレップの値から。
 * view はレップの最頻値、φ は standing に無ければレップの中央値。
 */
export function conditionsOf(reps: RepResult[], standing?: StandingSnapshot): BaselineConditions {
  const ms = reps.map(r => r.metrics).filter((m): m is NonNullable<typeof m> => !!m)
  const view: ViewKind = modeOf(ms.map(m => m.view)) ?? 'unknown'
  const phiDeg = standing?.phiDeg ?? median(ms.map(m => m.phiDeg).filter((v): v is number => v !== undefined))
  const c: BaselineConditions = { source: standing ? 'live' : 'file', view }
  if (phiDeg !== undefined) c.phiDeg = phiDeg
  if (standing?.tiltDeg !== undefined) c.tiltDeg = standing.tiltDeg
  if (standing?.side !== undefined) c.side = standing.side
  if (standing) c.segLen = standing.segA + standing.segB
  return c
}

export interface BuildOptions {
  /** 基準を取るセットの重量（kg、分からなければ 0） */
  weight: number
  /** 開始前の立位（ライブ撮影のとき） */
  standing?: StandingSnapshot
  /** 保存日（YYYY-MM-DD） */
  date: string
}

/**
 * セットのレップから自分の基準を作る。使うレップは、条件の良いもの（isBaselineRep）の先頭から最大 5 つ。
 * 3 つに満たなければ too-few。
 */
export function buildBaseline(
  key: FormExerciseKey, reps: RepResult[], opts: BuildOptions,
): { baseline: PersonalBaseline } | { error: 'too-few' } {
  const used = reps.filter(isBaselineRep).slice(0, BASELINE_MAX_REPS)
  if (used.length < BASELINE_MIN_REPS) return { error: 'too-few' }

  const stats: PersonalBaseline['stats'] = {}
  for (const metric of METRICS) {
    const values = used.map(r => metricValue(r, metric)).filter((v): v is number => v !== undefined && Number.isFinite(v))
    if (values.length < BASELINE_MIN_REPS) continue
    const st = statOf(values)
    if (st) stats[metric] = st
  }

  // 基準に使ったレップの半数以上で、一般のしきい値の崩れが出た code
  const count = new Map<string, number>()
  for (const r of used) for (const code of new Set(generalFaultCodes(r, key))) count.set(code, (count.get(code) ?? 0) + 1)
  const belowGeneral = [...count].filter(([, n]) => n * 2 >= used.length).map(([code]) => code)

  return {
    baseline: {
      version: 2, key, savedAt: opts.date, weight: opts.weight, repCount: used.length,
      stats, conditions: conditionsOf(used, opts.standing), belowGeneral,
    },
  }
}

/**
 * 基準を今の撮影で使えるか。向き・φ・側・体節長が違うと、角度や深さの意味が変わるので使わない。
 * どちらかの値が不明な項目は判定に使わない。傾きの差は、傾き補正を常にかけるので判定に使わない。
 * 旧形式（legacy）は撮影条件が分からないので、使える（ok）とする。
 */
export function baselineCompat(b: PersonalBaseline, now: BaselineConditions): { ok: boolean; reason?: string } {
  if (b.legacy) return { ok: true }
  const c = b.conditions
  if (c.view !== 'unknown' && now.view !== 'unknown' && c.view !== now.view) return { ok: false, reason: '撮影の向きが基準のときと違います' }
  if (c.phiDeg !== undefined && now.phiDeg !== undefined && Math.abs(c.phiDeg - now.phiDeg) > BASELINE_PHI_DIFF_DEG) {
    return { ok: false, reason: 'カメラに対する体の向きが基準のときと違います' }
  }
  if (c.side !== undefined && now.side !== undefined && c.side !== now.side) return { ok: false, reason: '撮影している体の側が基準のときと違います' }
  if (c.segLen !== undefined && now.segLen !== undefined && c.segLen > 0 && now.segLen > 0) {
    const ratio = now.segLen / c.segLen
    if (ratio < SEG_RATIO_MIN || ratio > SEG_RATIO_MAX) return { ok: false, reason: 'カメラとの距離が基準のときと違います' }
  }
  return { ok: true }
}

/** 基準と撮影条件が合わないときの、レポートの注記 */
export const BASELINE_INCOMPAT_NOTE = '基準と撮影条件が違うため一般の目安で判定しました'

/** 判定の余裕 = max(最低の余裕, 2×MAD)。最低の余裕は角度 8°、かかとの浮き 0.02 */
export function marginOf(metric: BaselineMetric, stat: BaselineStat): number {
  const min = metric === 'heelLift' ? MARGIN_MIN_HEEL : MARGIN_MIN_ANGLE
  return Math.max(min, 2 * stat.mad)
}

const DAY_MS = 24 * 60 * 60 * 1000
const dayOf = (ymd: string): number | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : undefined
}

/**
 * 基準の更新をすすめる理由（1 つ。すすめる必要がなければ undefined）。
 * 旧形式（1 レップ）・保存から 56 日以上・今の重量と基準の重量が 2 割以上違う（どちらも 0 より大きいとき）。
 */
export function baselineAdvice(b: PersonalBaseline, today: string, weight: number): string | undefined {
  if (b.legacy) return '今の基準は 1 レップから作った古い形式です。条件の良いセットで作り直すと、判定が安定します。'
  const d0 = dayOf(b.savedAt)
  const d1 = dayOf(today)
  if (d0 !== undefined && d1 !== undefined && d1 - d0 >= BASELINE_STALE_DAYS) {
    return `基準の保存から ${Math.floor(d1 - d0)} 日たっています。今のフォームで作り直しませんか。`
  }
  if (b.weight > 0 && weight > 0 && Math.abs(weight / b.weight - 1) >= BASELINE_WEIGHT_DIFF - 1e-9) {
    return `基準を作ったときの重量（${b.weight}kg）と今の重量（${weight}kg）が違います。作り直すと、今の重量に合います。`
  }
  return undefined
}

/**
 * RepTracker（可動域の短さの判定）に渡す基準。可動域・最小・最大・体幹の前傾の中央値。
 * 互換が ok でないときは呼び出し側が undefined を渡す（RepTracker の判定は今のまま）。
 * 可動域・最小・最大のどれかが無ければ undefined。
 */
export function toEngineBaseline(pb: PersonalBaseline | undefined): Baseline | undefined {
  const s = pb?.stats
  if (!s?.romDeg || !s.minAngle || !s.maxAngle) return undefined
  const b: Baseline = { romDeg: s.romDeg.med, minAngle: s.minAngle.med, maxAngle: s.maxAngle.med }
  if (s.trunkLeanMax) b.trunkLeanMax = s.trunkLeanMax.med
  return b
}
