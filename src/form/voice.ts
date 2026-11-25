/**
 * 撮影中の音声（読み上げ・チャイム・回数の音）。
 * speechSynthesis や AudioContext が無い環境・失敗しても、例外は投げず何もしない。
 * 置き直しの声は 4 秒に 1 回まで、フォームの声かけは 1 セットに 1 回まで。
 */
import type { FormExerciseKey } from './types'

export const PLACEMENT_INTERVAL_MS = 4000
/** チャイムのあと、声を出すまでの間（ミリ秒） */
export const CHIME_GAP_MS = 250

/** 崩れの code ごとの短い声（12拍以内）。種目別のものは `種目:code` が優先 */
const CUE_VOICE: Record<string, string> = {
  'forward-lean': '胸を前の壁へ',
  lean: '胸を前の壁へ',
  'heel-lift': '足裏全体で押す',
  shallow: 'お尻を箱へ',
  'bench:shallow': '胸まで下ろす',
  'knee-valgus': '床を外へ広げる',
  'hip-rise': 'お尻はベンチに',
  'bar-drift': 'バーを肩の上へ',
  // v2 の curl の swing は「体幹の反動」。肘の前後は elbow-forward
  'curl:swing': '背中を壁に',
  swing: '肘は脇腹に',
  'curl:body-english': '背中を壁に',
  'body-english': '背中を壁に',
  'elbow-forward': '肘は脇腹に',
  'fast-down': 'ゆっくり下ろす',
  'partial-bottom': '下で伸ばしきる',
}

/** 声に出す短い文。決まっていない崩れは undefined（声かけしない） */
export function cueVoiceText(key: FormExerciseKey, code: string): string | undefined {
  return CUE_VOICE[`${key}:${code}`] ?? CUE_VOICE[code]
}

/** 置き直しの声 */
export const PLACEMENT_VOICE = {
  hidden: '全身が映っていません。スマホを離してください',
  caution: '斜めです。体の真横に置いてください',
  ng: '正面からです。体の真横に置いてください',
} as const

type AudioCtor = typeof AudioContext
let audioCtx: AudioContext | undefined

function getAudio(): AudioContext | undefined {
  if (audioCtx) return audioCtx
  try {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
    const Ctor = w.AudioContext ?? w.webkitAudioContext
    if (!Ctor) return undefined
    audioCtx = new Ctor()
    return audioCtx
  } catch {
    return undefined
  }
}

/** 短い音を1回鳴らす */
function beep(freq: number, durationSec: number, volume: number): void {
  try {
    const c = getAudio()
    if (!c) return
    if (c.state === 'suspended') void c.resume().catch(() => {})
    const t = c.currentTime + 0.01
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + durationSec)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start(t)
    osc.stop(t + durationSec + 0.02)
  } catch {
    /* 鳴らせなくても続行 */
  }
}

/** 読み上げる。前の読み上げは打ち切る。読み上げられない環境では false */
function speakNow(text: string): boolean {
  try {
    const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis
    const Utter = (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance
    if (!synth || !Utter) return false
    synth.cancel()
    const u = new Utter(text)
    u.lang = 'ja-JP'
    u.rate = 1.05
    synth.speak(u)
    return true
  } catch {
    return false
  }
}

export interface FormVoice {
  /** ユーザーの操作（タップ）の中で呼ぶ。iOS で音声を有効にする */
  prime(): void
  /** 制限なしで読み上げる（開始・終了など） */
  say(text: string): void
  /** 置き直しの声。4 秒に 1 回まで。出したら true */
  placement(text: string): boolean
  /** フォームの声かけ。チャイム→短い文。1 セットに 1 回まで。出したら true */
  cue(text: string): boolean
  /** 自動開始の音 */
  startChime(): void
  /** レップを数えた短い音（80ms） */
  repTick(): void
  /** 新しいセットの前に呼ぶ（声かけの回数を戻す） */
  resetSet(): void
  /** 読み上げを止める */
  cancel(): void
}

/**
 * enabled が false のときはすべて何もしない。
 * now はテスト用（ミリ秒）。
 */
export function createVoice(enabled: boolean, now: () => number = () => Date.now()): FormVoice {
  let lastPlacementAt = Number.NEGATIVE_INFINITY
  let cued = false

  return {
    prime() {
      if (!enabled) return
      try {
        const c = getAudio()
        if (c && c.state === 'suspended') void c.resume().catch(() => {})
      } catch { /* 無視 */ }
      // iOS はタップの中で最初の読み上げを始めないと、あとで声が出ない
      speakNow('撮影を始めます')
    },
    say(text) {
      if (!enabled) return
      speakNow(text)
    },
    placement(text) {
      if (!enabled) return false
      const t = now()
      if (t - lastPlacementAt < PLACEMENT_INTERVAL_MS) return false
      lastPlacementAt = t
      speakNow(text)
      return true
    },
    cue(text) {
      if (!enabled || cued) return false
      cued = true
      beep(880, 0.2, 0.3)
      try {
        setTimeout(() => { speakNow(text) }, CHIME_GAP_MS)
      } catch {
        /* 無視 */
      }
      return true
    },
    startChime() {
      if (!enabled) return
      beep(660, 0.15, 0.25)
    },
    repTick() {
      if (!enabled) return
      beep(520, 0.08, 0.2)
    },
    resetSet() {
      cued = false
    },
    cancel() {
      try {
        const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis
        synth?.cancel()
      } catch { /* 無視 */ }
    },
  }
}
