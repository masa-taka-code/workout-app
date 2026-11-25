// 休憩終了の音（Web Audio API）。失敗しても例外は投げない。

type AudioCtor = typeof AudioContext

let ctx: AudioContext | undefined

function getContext(): AudioContext | undefined {
  if (ctx) return ctx
  try {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
    const Ctor = w.AudioContext ?? w.webkitAudioContext
    if (!Ctor) return undefined
    ctx = new Ctor()
    return ctx
  } catch {
    return undefined
  }
}

/** ユーザー操作の中で呼ぶ。iOS では操作の中で resume しないと音が出ない */
export function primeAudio(): void {
  try {
    const c = getContext()
    if (c && c.state === 'suspended') void c.resume().catch(() => {})
  } catch {
    /* 音が使えない環境では無視 */
  }
}

/** 880Hz・約0.15秒の音を0.25秒間隔で3回 */
export function playRestEnd(): void {
  try {
    const c = getContext()
    if (!c) return
    const start = c.currentTime + 0.02
    for (let i = 0; i < 3; i++) {
      const t = start + i * 0.25
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      // クリックノイズを防ぐため、音量を滑らかに上げ下げする
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
      osc.connect(gain)
      gain.connect(c.destination)
      osc.start(t)
      osc.stop(t + 0.16)
    }
  } catch {
    /* 鳴らせなくても続行 */
  }
}

/** 設定画面のテスト再生 */
export function playTest(): void {
  primeAudio()
  playRestEnd()
}
