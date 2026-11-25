/**
 * 筋肥大理論（概要設計書「筋肥大理論とアルゴリズム設計」）に沿った目標算出。
 *
 * 1. 種目ごと（毎回）: RIR で補正したダブルプログレッション
 * 2. 筋肉ごと（週単位）: 部分セット数（主働筋 1・補助筋 0.5）を 10〜20 に収める
 */
import { isCalibrationDue, rirBias } from './calibration'
import type { AppData, Condition, Entry, Exercise, Muscle, Session, SetLog, Target } from './types'

export const WEEKLY_MIN = 10
export const WEEKLY_MAX = 20
/** 1 回のセッションで 1 つの筋肉に割り当てる部分セットの上限（後半セットの質の低下を防ぐ） */
export const SESSION_CAP = 10
export const RAMP_RATE = 0.8
export const RAMP_WEEKS = 3

// ---------- 基本計算 ----------

/** RIR で補正した推定 1RM（Epley 式）: w × (1 + (reps + RIR) / 30) */
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

// ---------- 履歴 ----------

/** 指定日より前のその種目の記録（新しい順、完了セットがあるものだけ） */
export function historyFor(exerciseId: string, sessions: Session[], before: string): Entry[] {
  return sessions
    .filter(s => s.date < before)
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap(s => s.entries.filter(e => e.exerciseId === exerciseId && doneSets(e).length > 0))
}

// ---------- 1. 種目ごとの目標 ----------

/** 前回の記録から今日の重量・レップを決める（セット数は種目の標準値） */
export function suggestTarget(ex: Exercise, history: Entry[], bias = 0): Target {
  const base = { sets: ex.sets, rir: ex.targetRir }
  const last = history[0]
  if (!last) {
    return { ...base, kind: 'first', weight: 0, reps: ex.repMin, reason: `初回：${ex.repMin}〜${ex.repMax}回でRIR ${ex.targetRir}で止まる重量を探す` }
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

  if (top.length >= ex.sets && top.every(s => s.reps >= ex.repMax) && surplus >= 0) {
    const steps = surplus >= 3 ? 2 : 1
    return {
      ...base, kind: 'increase', weight: roundTo(topWeight + steps * ex.increment, ex.increment), reps: ex.repMin,
      reason: `前回は全セット${ex.repMax}回に到達${steps === 2 ? '（余力3回以上）' : ''}。重量を+${steps * ex.increment}kg`,
    }
  }

  const missedTwice = history.length >= 2 && history.slice(0, 2).every(e => achieved(e) === false)
  if (missedTwice) {
    return {
      ...base, kind: 'deload', sets: Math.max(1, ex.sets - 1), weight: roundTo(topWeight * 0.9, ex.increment), reps: ex.repMin,
      reason: '2回連続で目標未達。今回だけ重量−10%・セット−1で回復を優先',
    }
  }

  const minReps = Math.min(...top.map(s => s.reps))
  const step = surplus >= 2 ? 2 : 1
  const reps = Math.min(minReps + step, ex.repMax)
  return {
    ...base, kind: 'reps', weight: topWeight, reps,
    reason: `同じ重量でレップを${minReps}→${reps}回に${step === 2 ? '（前回は余力2回以上）' : ''}`,
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
  const under = ex.primary.filter(m => (lastWeek[m] ?? 0) < weeklyTarget(targets, m))
  const over = ex.primary.filter(m => (lastWeek[m] ?? 0) > WEEKLY_MAX)
  if (over.length > 0 && sets > 1) return { sets: sets - 1, note: `${over.join('・')}は先週${WEEKLY_MAX}セット超のため−1` }
  if (under.length > 0) return { sets: sets + 1, note: `${under.join('・')}は先週目標未満のため+1` }
  return { sets }
}

/** 週ごとの目標達成率（目標を提示した記録のうち達成した割合）。記録がなければ undefined */
export function achievementRate(sessions: Session[], from: string, to: string): number | undefined {
  const results = sessions
    .filter(s => s.date >= from && s.date < to)
    .flatMap(s => s.entries.map(achieved))
    .filter((r): r is boolean => r !== undefined)
  if (results.length === 0) return undefined
  return results.filter(Boolean).length / results.length
}

/**
 * 直近 RAMP_WEEKS 週の達成率がすべて 80% 以上なら、その週にトレーニングした筋肉の週目標を +1（上限 20）。
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
  const lastWeek = volumeBetween(data.sessions, data.exercises, weeks[0], thisWeek)
  const next = { ...data.weeklyTargets }
  for (const m of Object.keys(lastWeek) as Muscle[]) {
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
  const target = suggestTarget(ex, history, bias)
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
