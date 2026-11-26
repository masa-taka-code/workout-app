/**
 * 体重の推移から「食事が足りない可能性」「減量が速すぎる可能性」を知らせる判定（純粋関数のみ）。
 *
 * 根拠：Murphy & Koehler 2022 では、エネルギー不足だと除脂肪量の増加が妨げられた。
 * ただし筋力の伸びには有意差がなかったため、「重量が伸びないのは食事のせい」とは言わない。
 * 以下のしきい値はすべて論文の値ではなく「アプリの設計値・暫定」。
 */
import { addDays, weekStart } from './logic'
import type { AppData, Session } from './types'

/** 設計値・暫定：週平均を出すのに必要な体重記録の数（1回だけでは日々の変動に左右されるため） */
export const WEIGHT_MIN_PER_WEEK = 2
/** 設計値・暫定：何週続けて減っていれば知らせるか（短期の水分変動を除くため） */
export const WEIGHT_TREND_WEEKS = 3
/**
 * 設計値・暫定：目的が gain / maintain のとき、週あたりこの % 以上減っていれば知らせる。
 * 参考：Helms 2014（PMC4033492 本文）、Garthe 2011（PMID 21558571 抄録）。減量時の目安の下限を、筋肉を増やす・維持する人には「減りすぎ」の目安として使う。
 */
export const WEIGHT_LOSS_ALERT_PCT = 0.5
/** 設計値・暫定：減量中に、週あたりこの % を超える速さの減少が続くときだけ知らせる（Helms 2014 の週0.5〜1%の上限を参考） */
export const CUT_FAST_LOSS_PCT = 1.0

export interface WeeklyWeight {
  week: string
  avg: number
  n: number
}

/** トレーニング日の体重を週（月曜始まり）ごとに平均する。today より前のみ、記録が少ない週は除く。古い順 */
export function weeklyBodyWeights(sessions: Session[], today: string): WeeklyWeight[] {
  const byWeek = new Map<string, number[]>()
  for (const s of sessions) {
    const w = s.bodyWeight
    if (s.date >= today || typeof w !== 'number' || !Number.isFinite(w) || w <= 0) continue
    const wk = weekStart(s.date)
    const list = byWeek.get(wk)
    if (list) list.push(w)
    else byWeek.set(wk, [w])
  }
  return [...byWeek.entries()]
    .filter(([, list]) => list.length >= WEIGHT_MIN_PER_WEEK)
    .map(([week, list]) => ({ week, avg: list.reduce((a, b) => a + b, 0) / list.length, n: list.length }))
    .sort((a, b) => (a.week < b.week ? -1 : 1))
}

export interface BodyWeightAlert {
  kind: 'under-eating' | 'cut-too-fast'
  pctPerWeek: number
  message: string
}

const round1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1)

/** 体重が減り続けているときの知らせ。該当しなければ undefined */
export function bodyWeightAlert(data: AppData, today: string): BodyWeightAlert | undefined {
  const goal = data.bodyGoal ?? 'gain'
  if (goal === 'off') return undefined
  const thisWeek = weekStart(today)
  // 今週は途中なので使わない。先週までの週平均だけで見る
  const weeks = weeklyBodyWeights(data.sessions, today).filter(w => w.week < thisWeek)
  const need = WEIGHT_TREND_WEEKS + 1
  if (weeks.length < need) return undefined
  const recent = weeks.slice(-need)
  // 直近が先週で、途中に欠けた週がないこと
  if (recent[recent.length - 1].week !== addDays(thisWeek, -7)) return undefined
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].week !== addDays(recent[i - 1].week, 7)) return undefined
    if (!(recent[i].avg < recent[i - 1].avg)) return undefined
  }
  const first = recent[0].avg
  const last = recent[recent.length - 1].avg
  const totalPct = ((first - last) / first) * 100
  const pctPerWeek = totalPct / WEIGHT_TREND_WEEKS
  if (goal === 'cut') {
    if (!(pctPerWeek > CUT_FAST_LOSS_PCT)) return undefined
    return {
      kind: 'cut-too-fast',
      pctPerWeek,
      message: `体重が週約${round1(pctPerWeek)}%のペースで減っています。筋肉を保つには、もう少しゆっくり減らすのがおすすめです`,
    }
  }
  if (!(pctPerWeek >= WEIGHT_LOSS_ALERT_PCT)) return undefined
  return {
    kind: 'under-eating',
    pctPerWeek,
    message: `体重が${WEIGHT_TREND_WEEKS}週間で約${round1(totalPct)}%減っています。${goal === 'maintain' ? '体重を維持するには' : '筋肉を増やすには'}、食事量が足りていない可能性があります`,
  }
}
