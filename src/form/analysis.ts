/**
 * フォーム解析 v2 の分析（純粋関数）。
 * RepResult（と RepMetrics）と文脈から、ストレッチ・効き具合・崩れと原因・キュー・前回比較をまとめた FormReport を作る。
 * 推定であることを前提にし、研究で確かめられていない値では警告しない。重み・しきい値は「根拠のない仮の値」（暫定）。
 */
import { adviceFor, SAFETY_CODES } from './advice'
import { inferCauses } from './causes'
import type {
  EmphasisShare, EmphasisTarget, FaultFinding, FormContext, FormExerciseKey, FormReport, FormSessionSummary,
  RepResult, ViewKind, ViewOk,
} from './types'

/** 信頼度がこれ未満のレップは、減点・原因判定・効き具合の計算に使わない */
const MIN_CONFIDENCE = 0.6

// ---- ストレッチ（B-1） ----
/** squat：膝屈曲の基準（Kubo 2019 のハーフ 90° / フル 140°） */
const SQUAT_SHALLOW_DEG = 90
const SQUAT_DEEP_DEG = 140
/** curl：伸張域の入口の肘の内角 112°（屈曲 68°：Pedrosa 2023）から 170° まで */
const CURL_STRETCH_START_DEG = 112
const CURL_STRETCH_END_DEG = 170
/** 到達度がこれ以上なら「届いた」レップ（一貫性の数え方） */
const REACH_OK = 0.9
/** ストレッチスコアの重み（根拠のない仮の値）：到達度 0.5・一貫性 0.3・滞在率 0.2 */
const W_REACH = 0.5
const W_CONSISTENCY = 0.3
const W_TIME = 0.2

// ---- 効き具合（B-2） ----
/** 効き具合スコアの重み（根拠のない仮の値）：限界への近さ 0.6・ストレッチ 0.4 */
const W_PROXIMITY = 0.6
const W_STRETCH = 0.4
/** 限界への近さ：速度低下がこの値（%）で 1（Pareja-Blanco 2017） */
const PROXIMITY_FULL_LOSS = 40
/** Barrack 2021：すね前傾 − 体幹前傾 がこの値（度）以上なら膝寄りの負荷 */
const BARRACK_DIFF_DEG = 8
/** curl：肩の角度の注記を出す境界（度、暫定） */
const SHOULDER_NOTE_DEG = 10

// ---- 崩れの検出しきい値（すべて暫定。研究で確かめられた値ではない） ----
const TH = {
  /** 上体の前傾（度）。本人基準の +15° は Baseline に体幹の値が無いため未対応 */
  trunkLean: 60,
  trunkLeanOverBaseline: 15,
  heelLift: 0.03,
  kneeValgus: 10,
  hipRise: 0.05,
  barDrift: 0.25,
  torsoSwing: 15,
  upperArmSwing: 25,
}

/** 前回との比較で「変化あり」とみなすストレッチ点の差（暫定） */
const TREND_STRETCH_DIFF = 3

const DISCLAIMER =
  '筋電図や筋の長さを直接測っていない推定値です。撮影角度・体格・骨格推定の誤差で変わります。自分の過去の記録と比べる目安にしてください。痛みやしびれがあれば中止し、医師・理学療法士に相談してください。'

const TARGETS: Record<FormExerciseKey, EmphasisTarget[]> = {
  squat: [
    { id: 'quads', label: '太もも前' },
    { id: 'hips', label: 'お尻・内もも' },
  ],
  bench: [
    { id: 'chest', label: '胸' },
    { id: 'triceps', label: '腕の裏' },
  ],
  curl: [
    { id: 'long', label: '力こぶの肩側' },
    { id: 'distal', label: '力こぶの肘側' },
  ],
}

/** 狙いの部位ごとのコツ（根拠つき） */
const TIPS: Record<string, string[]> = {
  quads: ['上体をより起こし、膝を前に出す（かかと台も有効。すねが体幹より前傾すると膝寄りの負荷：Barrack 2021）', '深さを保つ'],
  hips: [
    '股関節から折りたたむ（お尻を後ろへ）',
    '足幅を広めに（Paoli 2009）',
    '深くしゃがむほど臀筋・内転筋の肥大が大きい（Kubo 2019）',
  ],
  chest: ['胸に触れるまで下ろす（フル可動域で大胸筋の肥大が大きい：Mendonça 2021）', '握りを広めにする'],
  triceps: ['握りを狭め、肘を体に近づける（研究により結果は一貫しません）'],
  long: ['インクラインベンチで上腕を体の後ろに（長頭が伸びやすい：Nunes 2025）'],
  distal: ['下で伸ばしきる（Pedrosa 2023）', 'プリーチャーカール（肘側が伸びやすい：Nunes 2025）'],
}

/** 種目ごとの「効かせたい部位」の選択肢 */
export function emphasisTargets(key: FormExerciseKey): EmphasisTarget[] {
  return TARGETS[key].map(t => ({ ...t }))
}

/** 直近3回で0回なら、その崩れはリアルタイムの声かけをしない（レポートには出す）。history は新しい順 */
export function shouldCueLive(code: string, history: FormSessionSummary[]): boolean {
  const last3 = history.slice(0, 3)
  if (last3.length < 3) return true
  return last3.some(h => (h.faultCounts[code] ?? 0) > 0)
}

// ---------------------------------------------------------------------------

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const round2 = (v: number) => Math.round(v * 100) / 100

/** 信頼度が足りるレップか。metrics が無い古い形式は、v1 の結果をそのまま使う */
function isUsable(r: RepResult): boolean {
  return r.metrics === undefined || r.metrics.confidence >= MIN_CONFIDENCE
}

/** 1レップの到達度 D（0〜1）。出せなければ undefined */
function reachOf(r: RepResult, ctx: FormContext): number | undefined {
  const b = ctx.baseline
  if (b && b.romDeg > 0) {
    const rom = ctx.key === 'bench' ? r.maxAngle - r.minAngle : r.romDeg
    return clamp01(rom / b.romDeg)
  }
  if (ctx.key === 'squat') {
    const f = r.metrics?.kneeFlexionBottom
    return f === undefined ? undefined : clamp01((f - SQUAT_SHALLOW_DEG) / (SQUAT_DEEP_DEG - SQUAT_SHALLOW_DEG))
  }
  if (ctx.key === 'curl') {
    return clamp01((r.maxAngle - CURL_STRETCH_START_DEG) / (CURL_STRETCH_END_DEG - CURL_STRETCH_START_DEG))
  }
  return undefined // bench は基準動画が無いと判定できない
}

function stretchOf(usable: RepResult[], ctx: FormContext): FormReport['stretch'] {
  const ds: number[] = []
  const ts: number[] = []
  for (const r of usable) {
    const d = reachOf(r, ctx)
    if (d === undefined) continue
    ds.push(d)
    const t = r.metrics?.timeInStretch
    if (t !== undefined) ts.push(t)
  }
  if (ds.length === 0) return undefined
  const reach = mean(ds)
  const consistency = ds.filter(d => d >= REACH_OK - 1e-9).length / ds.length
  const time = ts.length ? mean(ts) : undefined
  // 滞在率が無いときは 0 とせず、その項を除いて残りの重みで再配分する
  const raw = time === undefined
    ? (W_REACH * reach + W_CONSISTENCY * consistency) / (W_REACH + W_CONSISTENCY)
    : W_REACH * reach + W_CONSISTENCY * consistency + W_TIME * time
  const reference = ctx.baseline && ctx.baseline.romDeg > 0
    ? 'あなたの基準動画'
    : ctx.key === 'squat' ? '論文の基準（膝屈曲 90〜140°）' : '論文の基準（肘の伸張域 112〜170°）'
  return { score: Math.round(100 * raw), reach, consistency, timeInStretch: time, reference }
}

function modeOf<T extends string>(xs: T[], worstFirst: T[]): T {
  const count = new Map<T, number>()
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1)
  let best = xs[0]
  for (const x of xs) {
    const c = count.get(x) ?? 0
    const bc = count.get(best) ?? 0
    if (c > bc || (c === bc && worstFirst.indexOf(x) < worstFirst.indexOf(best))) best = x
  }
  return best
}

// ---- 崩れの検出 ----

interface Flag { code: string; magnitude: number }

/** 1レップの崩れ。magnitude はしきい値からの相対的な超過（重大さの比較に使う） */
function detectFaults(r: RepResult, ctx: FormContext): Flag[] {
  const m = r.metrics
  const v1 = new Set(r.issues.map(i => i.code))
  const out: Flag[] = []
  const add = (code: string, magnitude = 0) => out.push({ code, magnitude: Math.max(0, magnitude) })
  const baselineD = ctx.baseline && ctx.baseline.romDeg > 0 ? reachOf(r, ctx) : undefined

  if (ctx.key === 'squat') {
    const lean = m?.trunkLeanMax
    // 本人の基準動画があれば「基準 +15°」、無ければ 60° 超（どちらも暫定）
    const leanLimit = ctx.baseline?.trunkLeanMax !== undefined ? ctx.baseline.trunkLeanMax + TH.trunkLeanOverBaseline : TH.trunkLean
    if (lean !== undefined) { if (lean > leanLimit) add('forward-lean', (lean - leanLimit) / leanLimit) }
    else if (v1.has('lean')) add('forward-lean')

    if (m?.heelLift !== undefined && m.heelLift > TH.heelLift) add('heel-lift', (m.heelLift - TH.heelLift) / TH.heelLift)

    const flex = m?.kneeFlexionBottom
    if (baselineD !== undefined) { if (baselineD < REACH_OK) add('shallow', REACH_OK - baselineD) }
    else if (flex !== undefined) { if (flex < SQUAT_SHALLOW_DEG) add('shallow', (SQUAT_SHALLOW_DEG - flex) / SQUAT_SHALLOW_DEG) }
    else if (v1.has('shallow')) add('shallow')

    if (m?.view === 'front' && m.kneeValgusDeg !== undefined && m.kneeValgusDeg > TH.kneeValgus) {
      add('knee-valgus', (m.kneeValgusDeg - TH.kneeValgus) / TH.kneeValgus)
    }
  } else if (ctx.key === 'bench') {
    if (baselineD !== undefined) { if (baselineD < REACH_OK) add('shallow', REACH_OK - baselineD) }
    else if (v1.has('shallow')) add('shallow')
    if (m?.hipRise !== undefined && m.hipRise > TH.hipRise) add('hip-rise', (m.hipRise - TH.hipRise) / TH.hipRise)
    if (m?.barPathDrift !== undefined && m.barPathDrift > TH.barDrift) add('bar-drift', (m.barPathDrift - TH.barDrift) / TH.barDrift)
  } else {
    if (v1.has('partial-bottom')) add('partial-bottom')
    if (v1.has('partial-top')) add('partial-top')
    const torso = m?.torsoRange
    if (torso !== undefined) { if (torso > TH.torsoSwing) add('swing', (torso - TH.torsoSwing) / TH.torsoSwing) }
    else if (v1.has('body-english')) add('swing')
    const arm = m?.upperArmRange
    if (arm !== undefined) { if (arm > TH.upperArmSwing) add('elbow-forward', (arm - TH.upperArmSwing) / TH.upperArmSwing) }
    else if (v1.has('swing')) add('elbow-forward')
    if (v1.has('short-rom')) add('short-rom')
  }
  if (v1.has('fast-down')) add('fast-down')
  if (v1.has('rom-drop')) add('rom-drop')
  return out
}

interface Detected { code: string; reps: number[]; severity: number }

function detectAll(usable: RepResult[], ctx: FormContext): Detected[] {
  const by = new Map<string, { reps: number[]; mags: number[] }>()
  for (const r of usable) {
    for (const f of detectFaults(r, ctx)) {
      const e = by.get(f.code) ?? { reps: [], mags: [] }
      e.reps.push(r.index)
      e.mags.push(f.magnitude)
      by.set(f.code, e)
    }
  }
  const n = usable.length
  // 重大さ（暫定）：崩れたレップの割合 ×（1 + しきい値からの平均超過、上限 2）
  return [...by].map(([code, e]) => ({
    code, reps: e.reps, severity: (e.reps.length / n) * (1 + Math.min(2, mean(e.mags))),
  })).sort((a, b) => b.severity - a.severity)
}

// ---- 効き具合 ----

function emphasisOf(usable: RepResult[], ctx: FormContext): { distribution: EmphasisShare[]; note: string; hip?: number } {
  const avg = (pick: (r: RepResult) => number | undefined): number | undefined => {
    const xs = usable.map(pick).filter((v): v is number => v !== undefined)
    return xs.length ? mean(xs) : undefined
  }
  if (ctx.key === 'squat') {
    const h = avg(r => r.metrics?.hipMomentShare)
    const hc = h === undefined ? undefined : clamp01(h)
    const dist: EmphasisShare[] = [
      { label: '股関節まわり（臀筋・内転筋）', muscles: ['臀筋'], share: hc },
      { label: '太もも前（大腿四頭筋）', muscles: ['大腿四頭筋'], share: hc === undefined ? undefined : 1 - hc },
    ]
    let note = '姿勢から推定した負荷の割合です（筋電図ではありません）。'
    const shin = avg(r => r.metrics?.shinLeanBottom)
    const trunk = avg(r => r.metrics?.trunkLeanMax)
    if (shin !== undefined && trunk !== undefined && shin - trunk >= BARRACK_DIFF_DEG) {
      note += '膝寄りの負荷（すねが体幹より前傾）の可能性があります（Barrack 2021）。'
    }
    return { distribution: dist, note, hip: hc }
  }
  if (ctx.key === 'bench') {
    return {
      distribution: [
        { label: '主に働く：胸（大胸筋）', muscles: ['胸'] },
        { label: '補助：腕の裏・肩の前', muscles: ['上腕三頭筋', '肩前部'] },
      ],
      note: '割合は出せません。主に働く筋肉と補助の向きだけ示します。',
    }
  }
  let note = '力こぶの中の割合は出せません。'
  const sh = avg(r => r.metrics?.shoulderAngleAtBottom)
  if (sh !== undefined && sh < -SHOULDER_NOTE_DEG) {
    note += '肩が伸びた位置（インクライン）：二頭筋の長頭・肩側が伸びやすい姿勢です（Nunes 2025）。'
  } else if (sh !== undefined && sh > SHOULDER_NOTE_DEG) {
    note += '肩が曲がった位置（プリーチャー）：肘側が伸びやすい姿勢です（Nunes 2025）。'
  }
  return { distribution: [{ label: '力こぶ（上腕二頭筋）', muscles: ['上腕二頭筋'] }], note }
}

function targetShare(id: string, hip: number | undefined): number | undefined {
  if (hip === undefined) return undefined
  if (id === 'hips') return hip
  if (id === 'quads') return 1 - hip
  return undefined
}

// ---- 前回との比較 ----

function trendOf(report: Pick<FormReport, 'stretch' | 'faults'>, ctx: FormContext): string | undefined {
  const prev = ctx.history.find(h => h.exerciseId === ctx.exerciseId)
  if (!prev) return undefined
  const parts: string[] = []
  if (report.stretch && prev.stretchScore !== undefined) {
    const diff = report.stretch.score - prev.stretchScore
    if (Math.abs(diff) >= TREND_STRETCH_DIFF) parts.push(`ストレッチ ${diff > 0 ? '+' : '−'}${Math.abs(diff)} 点`)
  }
  const now: Record<string, number> = {}
  for (const f of report.faults) now[f.code] = f.reps.length
  let best: { code: string; from: number; to: number } | undefined
  for (const code of new Set([...Object.keys(prev.faultCounts), ...Object.keys(now)])) {
    const from = prev.faultCounts[code] ?? 0
    const to = now[code] ?? 0
    if (from !== to && (!best || Math.abs(to - from) > Math.abs(best.to - best.from))) best = { code, from, to }
  }
  if (best) parts.push(`${adviceFor(ctx.key, best.code).label}：${best.from}回→${best.to}回`)
  return parts.length ? `前回との比較：${parts.join('、')}。` : '前回とほぼ同じです。'
}

// ---------------------------------------------------------------------------

/** 1セット分のレップから詳細レポートを作る */
export function analyzeSet(reps: RepResult[], ctx: FormContext): FormReport {
  const measured = reps.filter(r => r.metrics)
  const usable = reps.filter(isUsable)
  const scored = usable.length ? usable : reps
  const overallScore = scored.length ? Math.round(mean(scored.map(r => r.score))) : 0
  const confidence = measured.length ? round2(mean(measured.map(r => r.metrics!.confidence))) : 0

  const ms = (usable.length ? usable : measured).map(r => r.metrics).filter((m): m is NonNullable<typeof m> => !!m)
  const view: ViewKind = ms.length ? modeOf(ms.map(m => m.view), ['unknown', 'oblique', 'front', 'side']) : 'unknown'
  const viewOk: ViewOk = ms.length ? modeOf(ms.map(m => m.viewOk), ['ng', 'caution', 'ok']) : 'caution'

  // 全レップが低信頼度：撮り直しをすすめ、ストレッチ・効き具合・原因は出さない
  if (reps.length > 0 && usable.length === 0) {
    const reason = viewOk === 'ng'
      ? '撮影角度が真横からずれている、または体が見えにくいため、信頼できる計測になりませんでした。真横から全身が映るように撮り直してください。'
      : '体の一部が隠れたり暗かったりして、信頼できる計測になりませんでした。全身が映る明るい場所で撮り直してください。'
    return {
      overallScore, confidence, view, viewOk, retakeReason: reason,
      emphasis: { distribution: [], note: '信頼できるレップがないため、効き具合は出せません。' },
      effort: { source: 'none' },
      faults: [],
      disclaimer: DISCLAIMER,
    }
  }

  const stretch = stretchOf(usable, ctx)

  // 効き具合
  const emp = emphasisOf(usable, ctx)
  const losses = usable.map(r => r.metrics?.velocityLossPct).filter((v): v is number => v !== undefined)
  const effort: FormReport['effort'] = losses.length
    ? {
        velocityLossPct: Math.max(...losses),
        proximity: clamp01(Math.max(...losses) / PROXIMITY_FULL_LOSS),
        source: 'velocity',
      }
    : { source: 'none' }

  let target: FormReport['emphasis']['target']
  const t = TARGETS[ctx.key].find(x => x.id === ctx.targetId)
  if (t) {
    const share = targetShare(t.id, emp.hip)
    const P = effort.proximity
    const L = stretch ? stretch.score / 100 : undefined
    let score: number | undefined
    // squat は配分が出せないとき S を 1 とみなすと過大評価になるので、スコアを出さない
    const shareMissing = ctx.key === 'squat' && share === undefined
    if (!shareMissing && (P !== undefined || L !== undefined)) {
      const S = share ?? 1
      const base = P !== undefined && L !== undefined ? W_PROXIMITY * P + W_STRETCH * L : (P ?? L!)
      score = Math.round(100 * S * base)
    }
    target = { id: t.id, label: t.label, share, score, tips: [...(TIPS[t.id] ?? [])] }
  }

  // 崩れと原因
  const detected = detectAll(usable, ctx)
  const codes = detected.map(d => d.code)
  const usableInfo = usable.map(r => ({ index: r.index, velocityLossPct: r.metrics?.velocityLossPct }))
  const faults: FaultFinding[] = detected.map(d => {
    const a = adviceFor(ctx.key, d.code)
    return {
      code: d.code,
      label: a.label,
      reps: d.reps,
      causes: inferCauses(d.code, d.reps, usableInfo, ctx, codes.filter(c => c !== d.code)),
      cue: a.cue,
      drills: [...a.drills],
      selfCheck: a.selfCheck,
      muscleHint: a.muscleHint,
      evidence: a.evidence,
    }
  })

  // 1セットに1つのキュー：安全 ＞ 重大さが最大のもの（detected は重大さの降順）
  const primary = detected.find(d => SAFETY_CODES.includes(d.code)) ?? detected[0]
  const primaryCue = primary ? adviceFor(ctx.key, primary.code).cue || undefined : undefined

  const report: FormReport = {
    overallScore, confidence, view, viewOk,
    stretch,
    emphasis: { distribution: emp.distribution, target, note: emp.note },
    effort,
    faults,
    primaryCue,
    disclaimer: DISCLAIMER,
  }
  report.trend = trendOf(report, ctx)
  return report
}

/** 保存用の要約を作る */
export function toSessionSummary(report: FormReport, reps: RepResult[], ctx: FormContext, date: string): FormSessionSummary {
  const faultCounts: Record<string, number> = {}
  for (const f of report.faults) faultCounts[f.code] = f.reps.length
  return {
    date, exerciseId: ctx.exerciseId, key: ctx.key, weight: ctx.weight, reps: reps.length,
    avgScore: report.overallScore, stretchScore: report.stretch?.score, faultCounts, confidence: report.confidence,
  }
}

/**
 * 計測中のレップの issues（v1 の code）を、レポート・履歴で使う v2 の code にそろえる。
 * 声かけのフェーディング（shouldCueLive）と履歴の faultCounts の名前を一致させるため。
 */
export function toReportCode(key: FormExerciseKey, code: string): string {
  if (code === 'lean') return 'forward-lean'
  if (key === 'curl' && code === 'swing') return 'elbow-forward'
  if (key === 'curl' && code === 'body-english') return 'swing'
  return code
}
