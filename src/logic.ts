/**
 * 筋肥大理論（概要設計書「筋肥大理論とアルゴリズム設計」）に沿った目標算出。
 *
 * 1. 種目ごと（毎回）: RIR で補正したダブルプログレッション
 * 2. 筋肉ごと（週単位）: 部分セット数（主働筋 1・補助筋 0.5）を 10〜20 に収める
 */
import { isCalibrationDue, rirBias } from './calibration'
import type { AppData, Condition, Entry, Exercise, Muscle, Session, SetLog, Target } from './types'

/** 週の部分セット数の下限の目安（Schoenfeld 2017：量に比例して増える。Pelland 2024：明確な頭打ちなし） */
export const WEEKLY_MIN = 10
/** 週の部分セット数の上限：研究上の上限ではなくアプリの目安（Pelland では 19〜29 セットは効率が低い段階） */
export const WEEKLY_MAX = 20
/**
 * 1 回のセッションで 1 つの筋肉に割り当てる部分セットの目安。
 * Remmert ら 2025（査読前）：約11部分セットを超えると上乗せが見えにくい（著者は「上限ではない」と明記）。安全側に丸めた値
 */
export const SESSION_CAP = 10
/** 週目標の自動 +1 の条件：達成率がこの値以上の週が RAMP_WEEKS 週続く（アプリの設計値・暫定） */
export const RAMP_RATE = 0.8
/** 同上の週数（アプリの設計値・暫定） */
export const RAMP_WEEKS = 3

// 停滞（2回未達）でデロードする前に、推定1RMの傾向が伸びていないか確かめる（以下はすべてアプリの設計値・暫定）
/** 傾向を見る直近の週数（アプリの設計値・暫定） */
export const TREND_WEEKS = 4
/** 傾向の判定に必要な記録の回数（アプリの設計値・暫定） */
export const TREND_MIN_SESSIONS = 6
/** 「伸びている」とみなす推定1RMの傾き（%/週）（アプリの設計値・暫定） */
export const TREND_MIN_SLOPE = 0.5
/**
 * 傾向に使うセットの reps + RIR の上限（アプリの設計値・暫定）。
 * Reynolds 2006 は線形の式を10回までとしているが、器具が異なるので12に丸めた設計値
 */
export const TREND_MAX_REPS = 12

export interface E1rmTrend { slopePctPerWeek: number; points: number }

// ---------- 基本計算 ----------

/**
 * RIR で補正した推定 1RM（Epley 式）: w × (1 + (reps + RIR) / 30)
 * 10回を超えると誤差が大きい（Reynolds 2006, 抄録）。停滞判定では TREND_MAX_REPS 以下のセットだけを使う
 */
export function e1rm(weight: number, reps: number, rir = 0): number {
  if (weight <= 0 || reps <= 0) return 0
  return weight * (1 + (reps + Math.max(0, rir)) / 30)
}

export function roundTo(weight: number, increment: number): number {
  if (increment <= 0) return Math.round(weight * 10) / 10
  return Math.round(Math.round(weight / increment) * increment * 100) / 100
}

export const doneSets = (entry: Entry): SetLog[] => entry.sets.filter(s => s.done && s.reps > 0)

const rirOf = (s: SetLog, ex: Exercise) => s.rir ?? ex.targetRir

/** セッションのその種目で最大の推定 1RM */
export function bestE1rm(entry: Entry, ex: Exercise): number {
  return Math.max(0, ...doneSets(entry).map(s => e1rm(s.weight, s.reps, rirOf(s, ex))))
}

/** 目標どおりの重量・レップを、標準セット数（目標のセット数）以上こなせたか */
export function achieved(entry: Entry): boolean | undefined {
  const t = entry.target
  if (!t || t.kind === 'first') return undefined
  const ok = doneSets(entry).filter(s => s.weight >= t.weight && s.reps >= t.reps).length
  return ok >= t.sets
}

// ---------- 日付 ----------

const toDate = (d: string) => new Date(`${d}T00:00:00`)
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 端末の現地時間での今日 (YYYY-MM-DD) */
export const localToday = (): string => fmt(new Date())

/** その日を含む週の月曜日 (YYYY-MM-DD) */
export function weekStart(date: string): string {
  const d = toDate(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return fmt(d)
}

export function addDays(date: string, days: number): string {
  const d = toDate(date)
  d.setDate(d.getDate() + days)
  return fmt(d)
}

/** 2つの日付 (YYYY-MM-DD) の日数差（b − a）。夏時間などの影響を丸めで吸収する */
const daysBetween = (a: string, b: string): number =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000)

const median = (xs: number[]): number => {
  const v = [...xs].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

// ---------- 履歴 ----------

/** 指定日より前のその種目の記録（新しい順、完了セットがあるものだけ） */
export function historyFor(exerciseId: string, sessions: Session[], before: string): Entry[] {
  return sessions
    .filter(s => s.date < before)
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap(s => s.entries.filter(e => e.exerciseId === exerciseId && doneSets(e).length > 0))
}

/**
 * 直近 TREND_WEEKS 週の推定1RMの傾向（%/週）。記録が足りなければ undefined。
 * 高回数セット（reps + RIR > TREND_MAX_REPS）とデロード回は除く。Theil-Sen 推定（全ペアの傾きの中央値）で外れ値に強くする
 */
export function e1rmTrend(exerciseId: string, ex: Exercise, sessions: Session[], today: string): E1rmTrend | undefined {
  const from = addDays(today, -TREND_WEEKS * 7)
  const byDay = new Map<string, number>()
  for (const se of sessions) {
    if (se.date >= today || se.date < from) continue
    for (const en of se.entries) {
      if (en.exerciseId !== exerciseId || en.target?.kind === 'deload') continue
      const vals = doneSets(en)
        .filter(x => x.reps + (x.amrap ? 0 : Math.max(0, rirOf(x, ex))) <= TREND_MAX_REPS)
        .map(x => e1rm(x.weight, x.reps, x.amrap ? 0 : rirOf(x, ex)))
      if (vals.length === 0) continue
      byDay.set(se.date, Math.max(byDay.get(se.date) ?? 0, ...vals))
    }
  }
  const pts = [...byDay.entries()].map(([d, y]) => ({ x: daysBetween(from, d), y }))
  if (pts.length < TREND_MIN_SESSIONS) return undefined
  const slopes: number[] = []
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) slopes.push((pts[j].y - pts[i].y) / (pts[j].x - pts[i].x))
  }
  const base = median(pts.map(p => p.y))
  if (base <= 0) return undefined
  return { slopePctPerWeek: (median(slopes) * 7) / base * 100, points: pts.length }
}

// ---------- 1. 種目ごとの目標 ----------

/** 前回の記録から今日の重量・レップを決める（セット数は種目の標準値） */
export function suggestTarget(ex: Exercise, history: Entry[], bias = 0, trend?: E1rmTrend): Target {
  const base = { sets: ex.sets, rir: ex.targetRir }
  const last = history[0]
  if (!last) {
    return { ...base, kind: 'first', weight: 0, reps: ex.repMin, reason: `初回：${ex.repMin}〜${ex.repMax}回でRIR ${ex.targetRir}で止まる重量を探す` }
  }

  // 前回がデロードだったときは、デロード前の重量に戻して下限の回数から再開する（デロードは今回だけ）
  if (last.target?.kind === 'deload') {
    const before = history.find(e => e.target?.kind !== 'deload')
    const maxW = (e: Entry) => Math.max(0, ...doneSets(e).map(x => x.weight))
    const weight = before ? maxW(before) : roundTo(maxW(last) / 0.9, ex.increment)
    return {
      ...base, kind: 'reps', weight, reps: ex.repMin,
      reason: '回復の回のあと：元の重量に戻し、下限の回数から',
    }
  }

  // 限界テストのセットは限界まで挙げているので、「目標RIRを残して止めた場合」に換算する
  // （rir 欄は目標回数の時点での予測なので、ここでは使わない）
  const sets = doneSets(last).map(s =>
    s.amrap ? { ...s, reps: Math.max(0, s.reps - ex.targetRir), rir: undefined, measured: true } : { ...s, measured: false },
  )
  // 記録された RIR には個人補正を足す（未入力・換算済みは目標RIRとみなすので足さない）
  const rirOfBiased = (s: SetLog & { measured: boolean }) =>
    !s.measured && typeof s.rir === 'number' ? s.rir + bias : ex.targetRir
  const topWeight = Math.max(...sets.map(s => s.weight))
  const top = sets.filter(s => s.weight === topWeight)
  // 余力 = 記録した RIR − 目標 RIR（最もきつかったセットで判断）
  const surplus = Math.min(...top.map(rirOfBiased)) - ex.targetRir

  // 前回の予定セット数（週ボリュームの調整で標準より少ない週もある）を全部こなしたかで判断する
  const plannedSets = last.target?.sets ?? ex.sets
  if (top.length >= plannedSets && top.every(s => s.reps >= ex.repMax) && surplus >= 0) {
    const steps = surplus >= 3 ? 2 : 1
    return {
      ...base, kind: 'increase', weight: roundTo(topWeight + steps * ex.increment, ex.increment), reps: ex.repMin,
      reason: `前回は全セット${ex.repMax}回に到達${steps === 2 ? '（余力3回以上）' : ''}。重量を+${steps * ex.increment}kg`,
    }
  }

  const missedTwice = history.length >= 2 && history.slice(0, 2).every(e => achieved(e) === false && e.target?.kind !== 'deload')
  const growing = !!trend && trend.slopePctPerWeek >= TREND_MIN_SLOPE
  const pct = trend ? trend.slopePctPerWeek.toFixed(1) : ''
  if (missedTwice && !growing) {
    return {
      // −10%・−1セットは論文の値ではなくアプリの設計値。「停滞時だけ」の方針は Coleman 2024（定期的な休みで筋肥大の上乗せなし）
      ...base, kind: 'deload', sets: Math.max(1, ex.sets - 1), weight: roundTo(topWeight * 0.9, ex.increment), reps: ex.repMin,
      reason: `2回連続で目標未達。今回だけ重量−10%・セット−1で回復を優先${trend ? `（直近${TREND_WEEKS}週の推定1RMの伸び：週${trend.slopePctPerWeek >= 0 ? '+' : ''}${pct}%）` : ''}`,
    }
  }

  const minReps = Math.min(...top.map(s => s.reps))
  const step = surplus >= 2 ? 2 : 1
  const reps = Math.min(minReps + step, ex.repMax)
  return {
    ...base, kind: 'reps', weight: topWeight, reps,
    reason: `${missedTwice ? `2回未達だが直近${TREND_WEEKS}週の推定1RMは週+${pct}%で伸びているため、重量は据え置き。` : ''}同じ重量でレップを${minReps}→${reps}回に${step === 2 ? '（前回は余力2回以上）' : ''}`,
  }
}

// ---------- 2. 筋肉ごとの週ボリューム ----------

export type Volume = Partial<Record<Muscle, number>>

/** 主働筋 1・補助筋 0.5 で数えた部分セット数 */
export function addVolume(vol: Volume, ex: Exercise, sets: number): Volume {
  const out = { ...vol }
  for (const m of ex.primary) out[m] = (out[m] ?? 0) + sets
  for (const m of ex.secondary) out[m] = (out[m] ?? 0) + sets * 0.5
  return out
}

/** [from, to) の期間の部分セット数 */
export function volumeBetween(sessions: Session[], exercises: Exercise[], from: string, to: string): Volume {
  const byId = new Map(exercises.map(e => [e.id, e]))
  let vol: Volume = {}
  for (const s of sessions) {
    if (s.date < from || s.date >= to) continue
    for (const en of s.entries) {
      const ex = byId.get(en.exerciseId)
      if (ex) vol = addVolume(vol, ex, doneSets(en).length)
    }
  }
  return vol
}

export const weeklyTarget = (targets: AppData['weeklyTargets'], m: Muscle) => targets[m] ?? WEEKLY_MIN

/** 前の週の実績から、今週この種目のセット数を ±1 する */
export function adjustSetsForVolume(ex: Exercise, sets: number, lastWeek: Volume, targets: AppData['weeklyTargets']): { sets: number; note?: string } {
  if (ex.primary.length === 0) return { sets }
  // 先週その筋肉の記録が1つもない（使い始め・久しぶりの再開）ときは増やさない（設計書 2026-11-26 追記）
  const under = ex.primary.filter(m => (lastWeek[m] ?? 0) > 0 && (lastWeek[m] ?? 0) < weeklyTarget(targets, m))
  const over = ex.primary.filter(m => (lastWeek[m] ?? 0) > WEEKLY_MAX)
  if (over.length > 0 && sets > 1) return { sets: sets - 1, note: `${over.join('・')}は先週${WEEKLY_MAX}セット超のため−1` }
  if (under.length > 0) return { sets: sets + 1, note: `${under.join('・')}は先週目標未満のため+1` }
  return { sets }
}

/** 週ごとの目標達成率（目標を提示した記録のうち達成した割合）。記録がなければ undefined */
export function achievementRate(sessions: Session[], from: string, to: string): number | undefined {
  const results = sessions
    .filter(s => s.date >= from && s.date < to)
    .flatMap(s => s.entries.filter(e => doneSets(e).length > 0).map(achieved))
    .filter((r): r is boolean => r !== undefined)
  if (results.length === 0) return undefined
  return results.filter(Boolean).length / results.length
}

/**
 * 直近 RAMP_WEEKS 週の達成率がすべて 80% 以上なら、先週、主働筋として完了セットがあった筋肉の週目標を +1（上限 20）。
 * 1 週に 1 回、週の初めに呼ぶ想定。
 */
export function rampWeeklyTargets(data: AppData, today: string): AppData['weeklyTargets'] {
  const thisWeek = weekStart(today)
  const weeks = Array.from({ length: RAMP_WEEKS }, (_, i) => addDays(thisWeek, -7 * (i + 1)))
  const allGood = weeks.every(w => {
    const r = achievementRate(data.sessions, w, addDays(w, 7))
    return r !== undefined && r >= RAMP_RATE
  })
  if (!allGood) return data.weeklyTargets
  // 先週、主働筋として完了セットが 1 以上あった筋肉だけ上げる（補助筋だけ・未実施は上げない）
  const byId = new Map(data.exercises.map(e => [e.id, e]))
  const trained = new Set<Muscle>()
  for (const s of data.sessions) {
    if (s.date < weeks[0] || s.date >= thisWeek) continue
    for (const en of s.entries) {
      const ex = byId.get(en.exerciseId)
      if (ex && doneSets(en).length > 0) for (const m of ex.primary) trained.add(m)
    }
  }
  const next = { ...data.weeklyTargets }
  for (const m of trained) {
    next[m] = Math.min(WEEKLY_MAX, weeklyTarget(next, m) + 1)
  }
  return next
}

// ---------- まとめ：今日の計画 ----------

/**
 * 今日この種目の目標を決める。
 * @param plannedToday 今日すでに組んだ種目による部分セット数（同じ筋肉の 1 回あたり上限を守るため）
 */
export function planExercise(
  ex: Exercise,
  data: AppData,
  today: string,
  condition: Condition = 'normal',
  plannedToday: Volume = {},
): Target {
  const history = historyFor(ex.id, data.sessions, today)
  const { bias } = rirBias(ex.id, data, today)
  const target = suggestTarget(ex, history, bias, e1rmTrend(ex.id, ex, data.sessions, today))
  const notes: string[] = []
  if (bias !== 0) {
    const n = Math.abs(bias)
    notes.push(bias > 0 ? `RIR補正 +${n}（あなたは余力を少なめに見積もる傾向）` : `RIR補正 −${n}（多めに見積もる傾向）`)
  }
  const amrap = (target.kind === 'reps' || target.kind === 'increase') && isCalibrationDue(ex, history)
  if (amrap) notes.push('最終セットは限界テスト')

  let sets = target.sets
  if (target.kind !== 'deload') {
    const thisWeek = weekStart(today)
    const lastWeek = volumeBetween(data.sessions, data.exercises, addDays(thisWeek, -7), thisWeek)
    const adj = adjustSetsForVolume(ex, sets, lastWeek, data.weeklyTargets)
    sets = adj.sets
    if (adj.note) notes.push(adj.note)
  }

  // 調子が悪い日も量は変えない（自動で減らす根拠がなく、量が慢性的に不足する恐れがあるため）。注意だけ出す
  const caution = condition === 'bad'
    ? '調子が悪い日です。記録更新は狙わず、フォームを崩さない範囲で目標に近づけましょう。痛みがあれば中止してください'
    : undefined

  // 1 回あたりの上限
  const room = Math.min(...ex.primary.map(m => SESSION_CAP - (plannedToday[m] ?? 0)), Infinity)
  if (room < sets) {
    sets = Math.max(1, Math.floor(room))
    notes.push(`1回あたり${SESSION_CAP}セットの上限`)
  }

  return { ...target, sets, reason: [target.reason, ...notes].join('／'), ...(caution ? { caution } : {}), ...(amrap ? { amrap: true } : {}) }
}
