/**
 * フォーム解析 v2 の分析（純粋関数）。
 * RepResult（と RepMetrics）と文脈から、ストレッチ・効き具合・崩れと原因・キュー・前回比較をまとめた FormReport を作る。
 * 推定であることを前提にし、研究で確かめられていない値では警告しない。重み・しきい値は「根拠のない仮の値」（暫定）。
 */
import { adviceFor, SAFETY_CODES } from './advice'
import { inferCauses } from './causes'
import { BASELINE_INCOMPAT_NOTE, baselineCompat, conditionsOf, marginOf, toEngineBaseline } from './baseline'
import type {
  BaselineMetric, Confidence, EmphasisShare, EmphasisTarget, FaultFinding, FormContext, FormExerciseKey, FormReport,
  FormSessionSummary, PersonalBaseline, RepResult, ViewKind, ViewOk,
} from './types'

/** 信頼度がこれ未満のレップは、減点・原因判定・効き具合の計算に使わない */
const MIN_CONFIDENCE = 0.6
/**
 * 設計値・暫定：推定のコマ（見えなかった関節を補間・代用したコマ）の割合がこれ以上のレップでは、安全に関わる崩れ（SAFETY_CODES）を出さない。
 * 推定した値だけを根拠に、ケガに関わる注意を断定しない（仕様 3.7）。論文の値ではない
 */
export const SAFETY_MAX_ESTIMATED = 0.2
/** 設計値・暫定：推定のコマの割合がこれ以上のレップを、画面の注記（補った回）に出す */
export const ESTIMATE_NOTE_MIN = 0.05

// ---- ストレッチ（B-1） ----
/** squat：膝屈曲の基準（Kubo 2019 のハーフ 90° / フル 140°） */
const SQUAT_SHALLOW_DEG = 90
/** 基準動画が無いときの「浅い」：90° から姿勢推定の角度誤差（約12°、Leuthold 2025）を引いた値。深い屈曲は小さめに出やすい */
const SQUAT_SHALLOW_NO_BASELINE_DEG = 78
const SQUAT_DEEP_DEG = 140
/** curl：伸張域の入口の肘の内角 112°（屈曲 68°：Pedrosa 2023）から 170° まで */
const CURL_STRETCH_START_DEG = 112
const CURL_STRETCH_END_DEG = 170
/** ohext：肘を曲げる目安（Maeo 2023 の可動域：肘 90° まで曲げる。単一研究・抄録のみ確認） */
const OHEXT_FLEXION_DEG = 90
/** 到達度がこれ以上なら「届いた」レップ（一貫性の数え方） */
const REACH_OK = 0.9
/** ストレッチスコアの重み（根拠のない仮の値）：到達度 0.5・一貫性 0.3・滞在率 0.2 */
const W_REACH = 0.5
const W_CONSISTENCY = 0.3
const W_TIME = 0.2

// ---- 効き具合（B-2） ----
/** 効き具合スコアの重み（根拠のない仮の値）：筋肥大向けの速度低下への到達 0.6・ストレッチ 0.4 */
const W_PROXIMITY = 0.6
const W_STRETCH = 0.4
/**
 * 筋肥大向けの目安の速度低下（%）。これ以上で proximity = 1。
 * 根拠：Hickmott 2022（系統的レビュー）で、速度低下 >25% のほうが ≤25% より筋肥大が大きかった。
 * 「限界への近さ」ではない（Pareja-Blanco 2017 の 40% も限界という意味ではない）。squat と bench だけに使う。
 */
const HYPERTROPHY_LOSS_TARGET = 25
/**
 * スクワットの負荷配分（股関節 / 膝）：HKR = h / (1 − h)（h = hipMomentShare）。
 * Straub, Barrack ら 2025 の4つの型の平均 HKR（0.3 / 0.9 / 1.5 / 2.2）の中間点（0.6 / 1.2 / 1.85）で区切った暫定値。
 * 論文は3D・しゃがむ局面全体の平均で、アプリは2D・最下点の近似なので、段階の名前だけを出す。
 */
const HKR_CUTS = [0.6, 1.2, 1.85]
const HKR_REPRESENTATIVE = [0.3, 0.9, 1.5, 2.2]
export const HIP_KNEE_LEVELS = ['膝優位', 'やや膝寄り', 'やや股関節寄り', '股関節優位'] as const
/** Straub, Barrack ら 2025：体幹の前傾がすねの前傾をこの値（度）以上上回ると股関節寄り（最大膝屈曲時） */
const STRAUB_DIFF_DEG = 2.2
/** curl：肩の角度の注記を出す境界（度、暫定） */
const SHOULDER_NOTE_DEG = 10

// ---- 崩れの検出しきい値（すべて暫定。研究で確かめられた値ではない） ----
const TH = {
  /** 基準動画が無いときの上体の前傾：60° に姿勢推定の角度誤差（約12°、Leuthold 2025）の余裕を足した値 */
  trunkLeanNoBaseline: 72,
  trunkLeanOverBaseline: 15,
  /** 自分の基準があるときの上体の前傾の上限の天井（度）。基準が大きくても 80° を超えて許さない */
  trunkLeanBaselineCap: 80,
  heelLift: 0.03,
  kneeValgus: 10,
  hipRise: 0.05,
  barDrift: 0.25,
  torsoSwing: 15,
  upperArmSwing: 25,
  // --- 追加6種目（すべて暫定。研究で確かめられた値ではない） ---
  /** rdl：最下点の膝の内角がこれ未満だと「膝を曲げすぎ（スクワットに近い）」 */
  rdlKneeAngle: 130,
  /** ohp：体幹の後傾がレップ開始時より増えた量（度） */
  ohpLeanBackIncrease: 15,
  /** ohp：基準動画が無いときの「浅い」＝最下点の肘屈曲がこれ未満 */
  ohpElbowFlexion: 70,
  /** lateral：体幹の振れ（度）。左右差の参考表示のしきい値も同じ値 */
  lateralTorsoSwing: 15,
  lateralAsymmetry: 15,
  /** pulldown：体幹の振れ（度） */
  pulldownTorsoSwing: 20,
  /** pulldown：上で伸ばしきった肘の内角の下限（基準動画が無いとき）／基準の最大角からの許容（あるとき） */
  pulldownElbowTop: 150,
  pulldownElbowTopMargin: 15,
  /** ohext：上腕の前後の振れ（度） */
  ohextUpperArmSwing: 25,
  /** bss：基準動画が無いときの「浅い」＝前脚の膝屈曲（squat と同じ 90° − 誤差 12°） */
  bssKneeFlexion: 78,
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
  rdl: [
    { id: 'hams', label: 'もも裏' },
    { id: 'glutes', label: 'お尻' },
  ],
  ohp: [],
  lateral: [],
  pulldown: [],
  ohext: [{ id: 'long', label: '腕の裏の長頭' }],
  bss: [
    { id: 'quads', label: '太もも前' },
    { id: 'glutes', label: 'お尻' },
  ],
}

/** 狙いの部位ごとのコツ（根拠つき） */
const TIPS: Record<string, string[]> = {
  quads: ['上体をより起こし、膝を前に出す（かかと台も有効。すねの前傾が体幹より大きいと膝寄りの姿勢：Straub, Barrack ら 2025）', '深さを保つ'],
  hips: [
    '股関節から折りたたむ（お尻を後ろへ）',
    '足幅を広めに（大臀筋の筋電が高かった研究：Paoli 2009。筋肥大は未検証）',
    '深くしゃがむほど臀筋・内転筋の肥大が大きい（Kubo 2019）',
  ],
  chest: ['胸に軽く触れるまで下ろし、毎回同じ深さにそろえる（深さをそろえると記録を比べやすい。可動域の違いによる長期の効果は研究で一貫しない）', '握りを広めにする'],
  triceps: ['握りを狭め、肘を体に近づける（研究により結果は一貫しません）'],
  long: ['インクラインベンチで上腕を体の後ろに（肩側の筋厚の増加が大きかった：Kassiano ら 2025、女性63人・8週）'],
  distal: [
    '下で伸ばしきる（座位のプリーチャーカールで、伸ばしきる側の可動域のとき肘側の筋厚が大きく増えた研究：Pedrosa 2023）',
    'プリーチャーカール（肘側の筋厚の増加が大きかった：Kassiano ら 2025、女性63人・8週）',
  ],
}

/** 種目ごとに内容が違う狙い（キーは「種目:id」。こちらが TIPS より優先）。いずれも筋電の研究で、筋肥大は未検証 */
const TIPS_BY_KEY: Record<string, string[]> = {
  'rdl:hams': ['膝を軽く曲げたまま、お尻を後ろへ引いて股関節を深く曲げる（半腱様筋の筋電が大きい：Coratella 2022）。筋電の研究で、筋肥大は未検証'],
  'rdl:glutes': ['膝を伸ばし気味にする（臀筋の筋電が大きい：Coratella 2022）。筋電の研究で、筋肥大は未検証'],
  'ohext:long': [
    '腕を頭上に上げたまま行う（頭上の方が体の横より長頭の筋量が大きく増えた：+28.5% 対 +19.6%、Maeo 2023）',
    '扱える重量は軽くなるが問題ない（頭上側は34〜39% 軽かった：Maeo 2023）',
  ],
  'bss:quads': ['上体を立て、前脚の膝を前に出す。筋電の研究で、筋肥大は未検証'],
  'bss:glutes': ['上体を少し前に倒し、足幅をやや広めにする（臀筋の筋電が増える：Aygun-Polat 2025）。筋電の研究で、筋肥大は未検証'],
}

function tipsFor(key: FormExerciseKey, id: string): string[] {
  return TIPS_BY_KEY[`${key}:${id}`] ?? TIPS[id] ?? []
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
  return r.metrics === undefined || (r.metrics.confidence >= MIN_CONFIDENCE && r.metrics.placementOk !== false)
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
  if (ctx.key === 'ohext') {
    const f = r.metrics?.elbowFlexionBottom
    return f === undefined ? undefined : clamp01(f / OHEXT_FLEXION_DEG)
  }
  return undefined // bench・rdl・ohp・lateral・pulldown・bss は基準動画が無いと判定できない
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
  const hasBaseline = !!ctx.baseline && ctx.baseline.romDeg > 0
  let reference: string
  if (hasBaseline) {
    reference = ctx.key === 'rdl'
      ? 'あなたの基準動画（股関節を深く曲げてハムストリングを伸ばす方向が有利：Maeo 2021、座位レッグカールの研究からの類推）'
      : 'あなたの基準動画'
  } else if (ctx.key === 'ohext') reference = '研究の可動域（肘を 90° まで曲げる：Maeo 2023）'
  else reference = ctx.key === 'squat' ? '論文の基準（膝屈曲 90〜140°）' : '論文の基準（肘の伸張域 112〜170°）'
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

/** cap：その崩れの原因の確信度の上限（自分の基準で判定したときだけ。基準のばらつき・誤差が入るため） */
interface Flag { code: string; magnitude: number; cap?: Confidence }

/** 一般のしきい値（rules.ts の formIssues と同じ値）：bench の最下点の肘がこれより大きいと浅い／curl の伸ばしきりがこれ未満だと不足 */
const BENCH_SHALLOW_GENERAL_DEG = 100
const CURL_BOTTOM_GENERAL_DEG = 150

/** 自分の基準で「浅さ・伸びきらない」を判定する崩れ。確信度は mid まで（暫定） */
const BASELINE_DEPTH_CODES: readonly string[] = ['shallow', 'shallow-hinge', 'partial-bottom', 'partial-top']
/** v1 の（テンポ・可動域の低下）崩れ。基準の良し悪しを見る belowGeneral には入れない */
const TEMPO_CODES: readonly string[] = ['fast-down', 'rom-drop', 'short-rom']

/**
 * 1レップの崩れ。magnitude はしきい値からの相対的な超過（重大さの比較に使う）。
 * personal は撮影条件が合う自分の基準（無ければ一般のしきい値。ctx.baseline の旧形式の基準は personal が無いときだけ使う）。
 * 安全に関わる崩れ（SAFETY_CODES）とかかとの浮きは、基準で緩めも厳しくもせず、常に一般のしきい値で判定する。
 */
function detectFaults(r: RepResult, ctx: FormContext, personal?: PersonalBaseline, allowEstimatedSafety = false): Flag[] {
  const m = r.metrics
  const v1 = new Set(r.issues.map(i => i.code))
  const out: Flag[] = []
  const below = (code: string) => !!personal?.belowGeneral.includes(code)
  /** 基準を使った判定の確信度の上限：一般のしきい値でも出ていた基準なら low、浅さの判定は mid */
  const capFor = (code: string): Confidence | undefined => (below(code) ? 'low' : BASELINE_DEPTH_CODES.includes(code) ? 'mid' : undefined)
  // 推定の多いレップ（見えなかった関節を補った割合が大きい）では、安全に関わる崩れを出さない。
  // 最下点が推定のレップでは、浅さ・伸びきりの崩れの確信度を low にする（深さを断定できないため）
  const estimatedHeavy = (m?.estimatedRatio ?? 0) >= SAFETY_MAX_ESTIMATED
  const add = (code: string, magnitude = 0, cap?: Confidence) => {
    if (!allowEstimatedSafety && estimatedHeavy && SAFETY_CODES.includes(code)) return
    const c = m?.bottomEstimated && BASELINE_DEPTH_CODES.includes(code) ? 'low' : cap
    out.push({ code, magnitude: Math.max(0, magnitude), cap: c })
  }
  const stat = (metric: BaselineMetric) => personal?.stats[metric]
  /** 基準の中央値 − 余裕（これを下回ったら浅い）。基準が無ければ undefined */
  const lowerLimit = (metric: BaselineMetric): number | undefined => {
    const st = stat(metric)
    return st ? st.med - marginOf(metric, st) : undefined
  }
  /** 一般の下限を下回らない（基準が浅いとき、一般の目安より緩くしない） */
  const withFloor = (code: string, lim: number, floor: number) => (below(code) ? Math.max(floor, lim) : lim)
  /** 一般の上限を超えて緩めない（bench のように、値が大きいほど浅い指標用） */
  const withCeil = (code: string, lim: number, ceil: number) => (below(code) ? Math.min(ceil, lim) : lim)
  const baselineD = !personal && ctx.baseline && ctx.baseline.romDeg > 0 ? reachOf(r, ctx) : undefined
  const oldBase = personal ? undefined : ctx.baseline

  if (ctx.key === 'squat') {
    const lean = m?.trunkLeanMax
    // 本人の基準があれば「基準 +15°（上限 80°）」、無ければ 72° 超（誤差の余裕を含む。どちらも暫定）
    const leanBase = stat('trunkLeanMax')?.med ?? oldBase?.trunkLeanMax
    const leanLimit = leanBase !== undefined ? Math.min(leanBase + TH.trunkLeanOverBaseline, TH.trunkLeanBaselineCap) : TH.trunkLeanNoBaseline
    const leanCap = leanBase !== undefined && personal ? capFor('forward-lean') : undefined
    if (lean !== undefined) { if (lean > leanLimit) add('forward-lean', (lean - leanLimit) / leanLimit, leanCap) }
    else if (v1.has('lean')) add('forward-lean')

    if (m?.heelLift !== undefined && m.heelLift > TH.heelLift) add('heel-lift', (m.heelLift - TH.heelLift) / TH.heelLift)

    const flex = m?.kneeFlexionBottom
    const lim = lowerLimit('kneeFlexionBottom')
    if (lim !== undefined && flex !== undefined) {
      const l = withFloor('shallow', lim, SQUAT_SHALLOW_NO_BASELINE_DEG)
      if (flex < l) add('shallow', (l - flex) / l, capFor('shallow'))
    }
    else if (baselineD !== undefined) { if (baselineD < REACH_OK) add('shallow', REACH_OK - baselineD) }
    else if (flex !== undefined) {
      if (flex < SQUAT_SHALLOW_NO_BASELINE_DEG) add('shallow', (SQUAT_SHALLOW_NO_BASELINE_DEG - flex) / SQUAT_SHALLOW_NO_BASELINE_DEG)
    }
    else if (v1.has('shallow')) add('shallow')

    // 正面で撮れているときだけ（向きが15°ずれると結果が逆になりうる）。2D の見かけの値で 3D の外反ではない
    if (m?.view === 'front' && m.viewOk === 'ok' && m.kneeValgusDeg !== undefined && m.kneeValgusDeg > TH.kneeValgus) {
      add('knee-valgus', (m.kneeValgusDeg - TH.kneeValgus) / TH.kneeValgus)
    }
  } else if (ctx.key === 'bench') {
    const ma = stat('minAngle')
    if (ma) {
      // 浅い＝最下点の肘の角度が、基準より余裕以上に大きい（下ろしきれていない）
      // 一般の 100° より緩くしない（belowGeneral のとき）
      const lim = withCeil('shallow', ma.med + marginOf('minAngle', ma), BENCH_SHALLOW_GENERAL_DEG)
      if (r.minAngle > lim) add('shallow', (r.minAngle - lim) / lim, capFor('shallow'))
    }
    else if (baselineD !== undefined) { if (baselineD < REACH_OK) add('shallow', REACH_OK - baselineD) }
    else if (v1.has('shallow')) add('shallow')
    if (m?.hipRise !== undefined && m.hipRise > TH.hipRise) add('hip-rise', (m.hipRise - TH.hipRise) / TH.hipRise)
    if (m?.barPathDrift !== undefined && m.barPathDrift > TH.barDrift) add('bar-drift', (m.barPathDrift - TH.barDrift) / TH.barDrift)
  } else if (ctx.key === 'rdl') {
    const knee = m?.kneeAngleBottom
    if (knee !== undefined && knee < TH.rdlKneeAngle) add('knee-bend', (TH.rdlKneeAngle - knee) / TH.rdlKneeAngle)
    // 背中の丸まりは測れないので検出しない（report の note で案内）
    const hip = m?.hipFlexionBottom
    const lim = lowerLimit('hipFlexionBottom')
    if (lim !== undefined && hip !== undefined) { if (hip < lim) add('shallow-hinge', (lim - hip) / lim, capFor('shallow-hinge')) }
    else if (baselineD !== undefined && baselineD < REACH_OK) add('shallow-hinge', REACH_OK - baselineD)
  } else if (ctx.key === 'ohp') {
    // 反りの増加：レップ開始時の後傾との差。どちらかが無ければ判定しない
    const back = m?.trunkLeanBack
    const start = m?.trunkLeanBackBaseline
    if (back !== undefined && start !== undefined && back - start > TH.ohpLeanBackIncrease) {
      add('lean-back', (back - start - TH.ohpLeanBackIncrease) / TH.ohpLeanBackIncrease)
    }
    const flex = m?.elbowFlexionBottom
    const lim = lowerLimit('elbowFlexionBottom')
    if (lim !== undefined && flex !== undefined) {
      const l = withFloor('shallow', lim, TH.ohpElbowFlexion)
      if (flex < l) add('shallow', (l - flex) / l, capFor('shallow'))
    }
    else if (baselineD !== undefined) { if (baselineD < REACH_OK) add('shallow', REACH_OK - baselineD) }
    else if (flex !== undefined && flex < TH.ohpElbowFlexion) {
      add('shallow', (TH.ohpElbowFlexion - flex) / TH.ohpElbowFlexion)
    }
  } else if (ctx.key === 'lateral') {
    // 左右差（abductionAsymmetry）は崩れに入れず、emphasis の note で参考表示する
    const torso = m?.torsoRange
    if (torso !== undefined && torso > TH.lateralTorsoSwing) add('swing', (torso - TH.lateralTorsoSwing) / TH.lateralTorsoSwing)
  } else if (ctx.key === 'pulldown') {
    const torso = m?.torsoRange
    if (torso !== undefined && torso > TH.pulldownTorsoSwing) add('swing', (torso - TH.pulldownTorsoSwing) / TH.pulldownTorsoSwing)
    const top = m?.elbowExtensionTop
    if (top !== undefined) {
      const et = stat('elbowExtensionTop')
      if (et) {
        // 基準の伸ばしきりより、max(15°, 2×MAD) 以上届いていない
        // 一般の 150° より緩くしない（belowGeneral のとき）
        const limit = withFloor('partial-top', et.med - Math.max(TH.pulldownElbowTopMargin, 2 * et.mad), TH.pulldownElbowTop)
        if (top < limit) add('partial-top', (limit - top) / limit, capFor('partial-top'))
      } else {
        const limit = oldBase ? oldBase.maxAngle - TH.pulldownElbowTopMargin : TH.pulldownElbowTop
        if (top < limit) add('partial-top', (limit - top) / limit)
      }
    }
  } else if (ctx.key === 'ohext') {
    const flex = m?.elbowFlexionBottom
    const lim = lowerLimit('elbowFlexionBottom')
    if (lim !== undefined && flex !== undefined) {
      const l = withFloor('shallow', lim, OHEXT_FLEXION_DEG)
      if (flex < l) add('shallow', (l - flex) / l, capFor('shallow'))
    }
    else if (baselineD !== undefined) { if (baselineD < REACH_OK) add('shallow', REACH_OK - baselineD) }
    else if (flex !== undefined && flex < OHEXT_FLEXION_DEG) {
      add('shallow', (OHEXT_FLEXION_DEG - flex) / OHEXT_FLEXION_DEG)
    }
    const arm = m?.upperArmRange
    if (arm !== undefined && arm > TH.ohextUpperArmSwing) add('elbow-drift', (arm - TH.ohextUpperArmSwing) / TH.ohextUpperArmSwing)
  } else if (ctx.key === 'bss') {
    const flex = m?.kneeFlexionBottom
    const lim = lowerLimit('kneeFlexionBottom')
    if (lim !== undefined && flex !== undefined) {
      const l = withFloor('shallow', lim, TH.bssKneeFlexion)
      if (flex < l) add('shallow', (l - flex) / l, capFor('shallow'))
    }
    else if (baselineD !== undefined) { if (baselineD < REACH_OK) add('shallow', REACH_OK - baselineD) }
    else if (flex !== undefined && flex < TH.bssKneeFlexion) add('shallow', (TH.bssKneeFlexion - flex) / TH.bssKneeFlexion)
    // 前傾は崩れにしない（note に記す）
  } else {
    // curl：伸ばしきれていない＝最下点の肘の角度（maxAngle）が、基準より余裕以上に小さい
    const ma = stat('maxAngle')
    if (ma) {
      // 一般の 150° より緩くしない（belowGeneral のとき）
      const lim = withFloor('partial-bottom', ma.med - marginOf('maxAngle', ma), CURL_BOTTOM_GENERAL_DEG)
      if (r.maxAngle < lim) add('partial-bottom', (lim - r.maxAngle) / lim, capFor('partial-bottom'))
    } else if (v1.has('partial-bottom')) add('partial-bottom')
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

/**
 * 一般のしきい値だけで見た 1 レップの崩れの code（自分の基準は使わない）。
 * 基準に使うレップが一般の目安でも崩れていたか（belowGeneral）を調べるのに使う。テンポ・可動域の低下は含めない。
 */
export function generalFaultCodes(rep: RepResult, key: FormExerciseKey): string[] {
  const ctx: FormContext = { key, exerciseId: '', weight: 0, history: [] }
  return detectFaults(rep, ctx).map(f => f.code).filter(c => !TEMPO_CODES.includes(c))
}

interface Detected { code: string; reps: number[]; severity: number; cap?: Confidence }

const CONF_RANK: Record<Confidence, number> = { low: 0, mid: 1, high: 2 }

function detectAll(usable: RepResult[], ctx: FormContext, personal?: PersonalBaseline): Detected[] {
  const by = new Map<string, { reps: number[]; mags: number[]; cap?: Confidence }>()
  for (const r of usable) {
    for (const f of detectFaults(r, ctx, personal)) {
      const e = by.get(f.code) ?? { reps: [], mags: [] }
      e.reps.push(r.index)
      e.mags.push(f.magnitude)
      // 自分の基準で出たレップが 1 つでもあれば、その確信度の上限（いちばん低いもの）をこの崩れの上限にする
      if (f.cap && (!e.cap || CONF_RANK[f.cap] < CONF_RANK[e.cap])) e.cap = f.cap
      by.set(f.code, e)
    }
  }
  const n = usable.length
  // 重大さ（暫定）：崩れたレップの割合 ×（1 + しきい値からの平均超過、上限 2）
  return [...by].map(([code, e]) => ({
    code, reps: e.reps, severity: (e.reps.length / n) * (1 + Math.min(2, mean(e.mags))), cap: e.cap,
  })).sort((a, b) => b.severity - a.severity)
}

// ---- 効き具合 ----

/** hipMomentShare（h、0〜1）から負荷配分の段階を決める。share は段階の代表値（HKR → h = HKR / (1 + HKR)） */
export function hipKneeLevel(h: number): { level: string; hkr: number; share: number } {
  const hkr = h >= 1 ? Infinity : h / (1 - h)
  let i = HKR_CUTS.findIndex(c => hkr < c - 1e-9) // 境界ちょうどは上の段階（浮動小数点の誤差を吸収）
  if (i < 0) i = HKR_CUTS.length
  const rep = HKR_REPRESENTATIVE[i]
  return { level: HIP_KNEE_LEVELS[i], hkr, share: rep / (1 + rep) }
}

function emphasisOf(
  usable: RepResult[], ctx: FormContext,
): { distribution: EmphasisShare[]; note: string; hip?: number; level?: string } {
  const avg = (pick: (r: RepResult) => number | undefined): number | undefined => {
    const xs = usable.map(pick).filter((v): v is number => v !== undefined)
    return xs.length ? mean(xs) : undefined
  }
  if (ctx.key === 'squat') {
    const h = avg(r => r.metrics?.hipMomentShare)
    const lv = h === undefined ? undefined : hipKneeLevel(clamp01(h))
    const hip = lv?.share
    const dist: EmphasisShare[] = [
      { label: '股関節まわり（臀筋・内転筋）', muscles: ['臀筋'], share: hip },
      { label: '太もも前（大腿四頭筋）', muscles: ['大腿四頭筋'], share: hip === undefined ? undefined : 1 - hip },
    ]
    let note = '姿勢から推定した負荷の配分の段階です（筋電図ではありません）。'
    const shin = avg(r => r.metrics?.shinLeanBottom)
    const trunk = avg(r => r.metrics?.trunkLeanBottom)
    if (shin !== undefined && trunk !== undefined) {
      note += trunk - shin >= STRAUB_DIFF_DEG - 1e-9
        ? '最下点は股関節寄りの姿勢です（Straub, Barrack ら 2025）。'
        : '最下点は膝寄りの姿勢です。'
    }
    note += '論文は3D・しゃがむ局面全体の平均、アプリは2D・最下点の近似です。'
    return { distribution: dist, note, hip, level: lv?.level }
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
  if (ctx.key !== 'curl') return emphasisOfNew(ctx, avg)
  let note = '力こぶの中の割合は出せません。'
  const sh = avg(r => r.metrics?.shoulderAngleAtBottom)
  if (sh !== undefined && sh < -SHOULDER_NOTE_DEG) {
    note += '肩が伸びた位置（インクライン）です。女性63人・8週の研究では、インクラインで肩側（近位）の筋厚の増加が大きかった（Kassiano ら 2025）。負荷のかかり方をそろえると差がないという研究もあります（Attarieh 2025）。'
  } else if (sh !== undefined && sh > SHOULDER_NOTE_DEG) {
    note += '肩が曲がった位置（プリーチャー）です。女性63人・8週の研究では、プリーチャーで肘側（遠位）の筋厚の増加が大きかった（Kassiano ら 2025）。負荷のかかり方をそろえると差がないという研究もあります（Attarieh 2025）。'
  }
  return { distribution: [{ label: '力こぶ（上腕二頭筋）', muscles: ['上腕二頭筋'] }], note }
}

const DIRECTION_NOTE = '割合は出せません。主に働く筋肉と補助の向きだけ示します。'

/** 追加6種目：主働筋・補助筋の向きだけ（割合なし）と、種目ごとの注記 */
function emphasisOfNew(
  ctx: FormContext, avg: (pick: (r: RepResult) => number | undefined) => number | undefined,
): { distribution: EmphasisShare[]; note: string } {
  switch (ctx.key) {
    case 'rdl':
      return {
        distribution: [
          { label: '主に働く：もも裏（ハムストリング）・お尻（大臀筋）', muscles: ['ハムストリング', '臀筋'] },
          { label: '補助：背中の起立筋', muscles: ['背中'] },
        ],
        note: DIRECTION_NOTE + '背中の丸まりはこのアプリでは測れません（姿勢推定に背骨の点がないため）。鏡や動画で確認してください。',
      }
    case 'ohp':
      return {
        distribution: [
          { label: '主に働く：肩（三角筋の前部・中部）・腕の裏', muscles: ['肩前部', '肩側部', '上腕三頭筋'] },
        ],
        note: DIRECTION_NOTE + '首の後ろへ下ろすと中部三角筋の筋電が大きいという研究がありますが、安全性のデータがないためおすすめしません（Coratella 2022）。',
      }
    case 'lateral': {
      let note = DIRECTION_NOTE + 'ダンベルとケーブル、負荷のかかる位置の違いで筋肥大に差はありませんでした（Larsen 2025、Jones 2025）。'
      const asym = avg(r => r.metrics?.abductionAsymmetry)
      // 左右差は崩れに入れず、参考として知らせるだけ（暫定のしきい値）
      if (asym !== undefined && asym > TH.lateralAsymmetry) note += '左右で上がる高さが違って見えます（参考）。'
      return {
        distribution: [{ label: '主に働く：肩の横（三角筋の中部）', muscles: ['肩側部'] }],
        note,
      }
    }
    case 'pulldown':
      return {
        distribution: [
          { label: '主に働く：背中（広背筋）', muscles: ['背中'] },
          { label: '補助：力こぶ・肩の後ろ', muscles: ['上腕二頭筋', '肩後部'] },
        ],
        note: DIRECTION_NOTE + '順手の方が逆手より、体の前に引く方が広背筋の筋電が大きい（筋電の研究）。約30°の後傾は広背筋の活動を変えません（Buonsenso 2025）。',
      }
    case 'ohext':
      return {
        distribution: [{ label: '主に働く：腕の裏（上腕三頭筋）', muscles: ['上腕三頭筋'] }],
        note: DIRECTION_NOTE + '腕を頭上に上げると、長頭（肩をまたぐ部分）がより伸ばされます（Maeo 2023）。',
      }
    default: // bss
      return {
        distribution: [
          { label: '主に働く：前脚の太もも前・お尻', muscles: ['大腿四頭筋', '臀筋'] },
          { label: '補助：もも裏・内もも', muscles: ['ハムストリング'] },
        ],
        note: DIRECTION_NOTE + '上体の前傾は臀筋寄りのやり方です（Aygun-Polat 2025）。',
      }
  }
}

function targetShare(id: string, hip: number | undefined): number | undefined {
  if (hip === undefined) return undefined
  if (id === 'hips') return hip
  if (id === 'quads') return 1 - hip
  return undefined
}

// ---- 見えなかった関節の補正の注記 ----

const repList = (idx: number[]) => idx.map(i => `${i}回目`).join('、')

/**
 * 見えなかった関節を補った・判定しなかったことの注記（画面の注記欄に 1 行ずつ出す）。何もなければ空。
 * 推定した値には必ず印を付け、推定だけを根拠に安全に関わる崩れを断定しない（仕様 3.7）。
 */
function estimateNotes(reps: RepResult[], usable: RepResult[], ctx: FormContext, personal?: PersonalBaseline): string[] {
  const notes: string[] = []
  const withM = reps.filter(r => r.metrics)
  const filled = withM.filter(r => (r.metrics?.estimatedRatio ?? 0) >= ESTIMATE_NOTE_MIN && !r.metrics?.mirrored)
  if (filled.length) notes.push(`関節が一時的に見えなかった回：${repList(filled.map(r => r.index))}（前後から補いました）`)
  const mirrored = withM.filter(r => r.metrics?.mirrored)
  if (mirrored.length) notes.push(`手前の関節が長く見えず、奥側で代用した回：${repList(mirrored.map(r => r.index))}（確信度を下げています）`)
  const bottom = withM.filter(r => r.metrics?.bottomEstimated)
  if (bottom.length) notes.push(`最下点が見えなかった回：${repList(bottom.map(r => r.index))}（深さの減点はしていません）`)
  // 推定が多くて判定しなかった、安全に関わる崩れ
  const hidden = new Map<string, number[]>()
  for (const r of usable) {
    if ((r.metrics?.estimatedRatio ?? 0) < SAFETY_MAX_ESTIMATED) continue
    const shown = new Set(detectFaults(r, ctx, personal).map(f => f.code))
    for (const f of detectFaults(r, ctx, personal, true)) {
      if (SAFETY_CODES.includes(f.code) && !shown.has(f.code)) hidden.set(f.code, [...(hidden.get(f.code) ?? []), r.index])
    }
  }
  for (const [code, idx] of hidden) {
    notes.push(`見えない時間があったため「${adviceFor(ctx.key, code).label}」は判定しませんでした（${repList(idx)}）`)
  }
  if (withM.some(r => r.metrics?.worldTrust === false)) {
    notes.push('奥行きの情報が不安定だったため、撮影の向きは画面上の比から判定し、速度（m/s）は出していません')
  }
  return notes
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
export function analyzeSet(reps: RepResult[], inCtx: FormContext): FormReport {
  // 基準の種目キーが今の種目と違うときは使わない（別の種目の基準で判定しない）
  const rawCtx: FormContext = inCtx.personal && inCtx.personal.key !== inCtx.key ? { ...inCtx, personal: undefined } : inCtx
  const measured = reps.filter(r => r.metrics)
  const usable = reps.filter(isUsable)
  // 自分の基準は、撮影条件が今のセットと合うときだけ使う。合わなければ一般のしきい値で判定し、注記を出す
  const compat = rawCtx.personal ? baselineCompat(rawCtx.personal, conditionsOf(usable, rawCtx.standing)) : undefined
  const personal = rawCtx.personal && compat?.ok ? rawCtx.personal : undefined
  const baselineNote = rawCtx.personal && !compat?.ok ? BASELINE_INCOMPAT_NOTE : undefined
  // 到達度（ストレッチ）は基準の可動域の中央値。personal があるときは旧形式の ctx.baseline をそれで置き換える
  const ctx: FormContext = rawCtx.personal ? { ...rawCtx, baseline: personal ? toEngineBaseline(personal) : undefined } : rawCtx
  // 全レップが低信頼度のときは参考値として全レップの平均。撮影条件が悪かったレップ（placementOk=false）は点を付けない
  const scored = usable.length ? usable : reps.filter(r => r.metrics?.placementOk !== false)
  const overallScore = scored.length ? Math.round(mean(scored.map(r => r.score))) : 0
  const confidence = measured.length ? round2(mean(measured.map(r => r.metrics!.confidence))) : 0

  const ms = (usable.length ? usable : measured).map(r => r.metrics).filter((m): m is NonNullable<typeof m> => !!m)
  const view: ViewKind = ms.length ? modeOf(ms.map(m => m.view), ['unknown', 'oblique', 'front', 'side']) : 'unknown'
  const viewOk: ViewOk = ms.length ? modeOf(ms.map(m => m.viewOk), ['ng', 'caution', 'ok']) : 'caution'

  // 全レップが低信頼度：撮り直しをすすめ、ストレッチ・効き具合・原因は出さない
  if (reps.length > 0 && usable.length === 0) {
    const lowNotes = estimateNotes(reps, [], rawCtx)
    const allBadPlacement = reps.every(r => r.metrics?.placementOk === false)
    const reason = allBadPlacement
      ? '撮影条件（全身の枠・距離・向き・スマホの傾き・明るさ）が悪く、信頼できる計測になりませんでした。案内に従って置き直し、撮り直してください。'
      : viewOk === 'ng'
      ? '撮影角度が真横からずれている、または体が見えにくいため、信頼できる計測になりませんでした。真横から全身が映るように撮り直してください。'
      : '体の一部が隠れたり暗かったりして、信頼できる計測になりませんでした。全身が映る明るい場所で撮り直してください。'
    return {
      overallScore, confidence, view, viewOk, retakeReason: reason,
      emphasis: { distribution: [], note: '信頼できるレップがないため、効き具合は出せません。' },
      effort: { source: 'none' },
      faults: [],
      disclaimer: DISCLAIMER,
      ...(baselineNote ? { baselineNote } : {}),
      ...(lowNotes.length ? { notes: lowNotes } : {}),
    }
  }

  const stretch = stretchOf(usable, ctx)
  const notes = estimateNotes(reps, usable, ctx, personal)

  // 効き具合
  const emp = emphasisOf(usable, ctx)
  const losses = usable.map(r => r.metrics?.velocityLossPct).filter((v): v is number => v !== undefined)
  // 筋肥大向けの目安（速度低下 25% 以上、Hickmott 2022）は squat と bench だけ。他の種目は出さない
  const effort: FormReport['effort'] = losses.length && (ctx.key === 'squat' || ctx.key === 'bench')
    ? {
        velocityLossPct: Math.max(...losses),
        proximity: clamp01(Math.max(...losses) / HYPERTROPHY_LOSS_TARGET),
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
    target = { id: t.id, label: t.label, share, score, tips: [...tipsFor(ctx.key, t.id)] }
  }

  // 崩れと原因
  const detected = detectAll(usable, ctx, personal)
  const codes = detected.map(d => d.code)
  const usableInfo = usable.map(r => ({ index: r.index, velocityLossPct: r.metrics?.velocityLossPct }))
  const faults: FaultFinding[] = detected.map(d => {
    const a = adviceFor(ctx.key, d.code)
    const causes = inferCauses(d.code, d.reps, usableInfo, ctx, codes.filter(c => c !== d.code))
    return {
      code: d.code,
      label: a.label,
      reps: d.reps,
      // 自分の基準で判定した崩れは、確信度に上限をかける（基準のばらつき・誤差が入るため）
      causes: d.cap ? causes.map(c => (CONF_RANK[c.confidence] > CONF_RANK[d.cap as Confidence] ? { ...c, confidence: d.cap as Confidence } : c)) : causes,
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
    emphasis: { distribution: emp.distribution, level: emp.level, target, note: emp.note },
    effort,
    faults,
    primaryCue,
    disclaimer: DISCLAIMER,
    ...(baselineNote ? { baselineNote } : {}),
    ...(notes.length ? { notes } : {}),
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
    ...(ctx.standing ? { standing: ctx.standing } : {}),
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
