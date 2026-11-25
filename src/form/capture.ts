/**
 * 撮影の自動開始・自動終了・声かけの判定（純粋関数。画面・カメラ・音声には依存しない）。
 * 動画ファイルのセット分割も、自動終了と同じ判定（8 秒レップが無い）を使う。
 */
import type { FormExerciseKey, Pose, RepResult, FormSessionSummary } from './types'
import { CONFIG, MIN_VISIBILITY, SIDE_INDEX } from './rules'
import { phiFromWorld, shoulderRatio, viewFromRatio, viewOkFromPhi } from './measure'
import { SAFETY_CODES, adviceFor } from './advice'
import { shouldCueLive, toReportCode } from './analysis'
import { cueVoiceText } from './voice'

/** 置き直しの表示が「良い」状態で、これだけ続いたら計測を始める */
export const AUTO_START_MS = 1500
/** レップが 1 回以上あった後、レップが無いままこれだけ経ったら終了（動画のセット分割も同じ） */
export const AUTO_END_IDLE_MS = 8000
/** 体が映らないままこれだけ経ったら終了 */
export const AUTO_END_HIDDEN_MS = 3000
/** 速度低下がこれを超えたら、安全に関わる声かけだけにする（%） */
export const FATIGUE_LOSS_PCT = 30

/** 待機中の置き場所の判定。hidden＝必要な関節が映っていない */
export type Placement = 'ok' | 'caution' | 'ng' | 'hidden'

/** 縦横比をそろえた姿勢と world（あれば）から、置き場所の良否を決める */
export function judgePlacement(key: FormExerciseKey, pose: Pose | undefined, world?: Pose): Placement {
  if (!pose) return 'hidden'
  const joints = CONFIG[key].joints
  const sideVisible = (side: 'left' | 'right') =>
    joints.every(j => (pose[SIDE_INDEX[side][j]]?.visibility ?? 0) >= MIN_VISIBILITY)
  if (!sideVisible('left') && !sideVisible('right')) return 'hidden'
  const phi = world ? phiFromWorld(world) : undefined
  if (phi !== undefined) return viewOkFromPhi(phi, key)
  const ratio = shoulderRatio(pose)
  if (ratio === undefined) return 'caution'
  return viewFromRatio(ratio, key).viewOk
}

export interface AutoStartState {
  /** 「良い」状態が始まった時刻（ミリ秒）。良くないなら undefined */
  since?: number
}

/** 置き場所が良い（ok または caution）状態が 1.5 秒続いたら start */
export function stepAutoStart(
  state: AutoStartState, placement: Placement, nowMs: number,
): { state: AutoStartState; start: boolean } {
  if (placement !== 'ok' && placement !== 'caution') return { state: {}, start: false }
  const since = state.since ?? nowMs
  return { state: { since }, start: nowMs - since >= AUTO_START_MS }
}

export interface AutoEndState {
  repCount: number
  /** 最後にレップが増えた時刻 */
  lastRepAt?: number
  /** 体が映らなくなった時刻。映っているなら undefined */
  hiddenSince?: number
}

export const initialAutoEnd: AutoEndState = { repCount: 0 }

/**
 * 1 レップ以上あった後、8 秒レップが無い、または体が 3 秒映らなければ end。
 * レップが 1 回も無いうちは終了しない。
 */
export function stepAutoEnd(
  state: AutoEndState, input: { nowMs: number; repCount: number; visible: boolean },
): { state: AutoEndState; end: boolean } {
  const { nowMs, repCount, visible } = input
  const lastRepAt = repCount > state.repCount || (repCount > 0 && state.lastRepAt === undefined)
    ? nowMs
    : state.lastRepAt
  const hiddenSince = visible ? undefined : (state.hiddenSince ?? nowMs)
  const next: AutoEndState = { repCount, lastRepAt, hiddenSince }
  if (repCount < 1 || lastRepAt === undefined) return { state: next, end: false }
  const idle = nowMs - lastRepAt >= AUTO_END_IDLE_MS
  const gone = hiddenSince !== undefined && nowMs - hiddenSince >= AUTO_END_HIDDEN_MS
  return { state: next, end: idle || gone }
}

export interface LiveCue {
  code: string
  /** 声に出す短い文 */
  voice: string
  /** 画面に出す文 */
  screen: string
}

/**
 * セット中の声かけを決める。
 * - 直近 2 レップに同じ崩れが続いたときだけ（1 レップだけの崩れは推定の誤差かもしれない）
 * - 速度低下が 30% を超えたあとは、安全に関わる崩れだけ
 * - 安全に関わる崩れ（SAFETY_CODES）は、shouldCueLive に関係なく言う
 * - shouldCueLive が false の崩れ（直近 3 回で 0 回）は、同じ崩れが 3 レップ続いたときだけ言う
 * - 声にする文が決まっていない崩れは言わない
 * history は新しい順。
 */
export function pickLiveCue(
  key: FormExerciseKey, reps: RepResult[], history: FormSessionSummary[],
): LiveCue | undefined {
  if (reps.length < 2) return undefined
  const last = reps[reps.length - 1]
  const prev = reps[reps.length - 2]
  // v1 の code を v2 にそろえてから判定する（履歴の faultCounts は v2 の名前）
  const prevCodes = new Set(prev.issues.map(i => toReportCode(key, i.code)))
  const prev2 = reps.length >= 3 ? reps[reps.length - 3] : undefined
  const prev2Codes = new Set(prev2?.issues.map(i => toReportCode(key, i.code)) ?? [])
  let codes = last.issues.map(i => toReportCode(key, i.code)).filter(c => prevCodes.has(c))
  if ((last.metrics?.velocityLossPct ?? 0) > FATIGUE_LOSS_PCT) {
    codes = codes.filter(c => SAFETY_CODES.includes(c))
  }
  // 安全に関わるものを先に
  codes.sort((a, b) => Number(SAFETY_CODES.includes(b)) - Number(SAFETY_CODES.includes(a)))
  for (const code of codes) {
    // 安全に関わる崩れは常に言う。フェーディング中の崩れは 3 レップ続いたときだけ
    if (!SAFETY_CODES.includes(code) && !shouldCueLive(code, history) && !prev2Codes.has(code)) continue
    const voice = cueVoiceText(key, code)
    if (!voice) continue
    return { code, voice, screen: adviceFor(key, code).cue || voice }
  }
  return undefined
}

/** 動画の残り時間などの表示用：秒 → 「m:ss」 */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
