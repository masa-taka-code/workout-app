import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLACEMENT_INTERVAL_MS, createVoice, cueVoiceText } from './voice'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubSpeech() {
  const speak = vi.fn()
  const cancel = vi.fn()
  class Utter {
    text: string
    lang = ''
    rate = 1
    constructor(text: string) { this.text = text }
  }
  vi.stubGlobal('speechSynthesis', { speak, cancel })
  vi.stubGlobal('SpeechSynthesisUtterance', Utter)
  return { speak, cancel }
}

describe('voice', () => {
  it('speechSynthesis も AudioContext も無い環境で例外を投げない', () => {
    vi.stubGlobal('window', {})
    const v = createVoice(true)
    expect(() => {
      v.prime()
      v.say('スタート')
      v.placement('斜めです')
      v.cue('胸を前の壁へ')
      v.startChime()
      v.repTick()
      v.resetSet()
      v.cancel()
    }).not.toThrow()
  })

  it('読み上げや音の生成が失敗しても例外を投げない', () => {
    class Broken {
      constructor() { throw new Error('fail') }
    }
    vi.stubGlobal('window', { AudioContext: Broken })
    vi.stubGlobal('speechSynthesis', { speak: () => { throw new Error('x') }, cancel: () => { throw new Error('x') } })
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor() { throw new Error('x') } })
    const v = createVoice(true)
    expect(() => {
      v.prime()
      v.say('終了')
      v.placement('斜めです')
      v.repTick()
      v.cancel()
    }).not.toThrow()
  })

  it('置き直しの声は 4 秒に 1 回まで', () => {
    const { speak } = stubSpeech()
    let t = 100000
    const v = createVoice(true, () => t)
    expect(v.placement('斜めです')).toBe(true)
    t += PLACEMENT_INTERVAL_MS - 1
    expect(v.placement('斜めです')).toBe(false)
    t += 1
    expect(v.placement('斜めです')).toBe(true)
    expect(speak).toHaveBeenCalledTimes(2)
  })

  it('フォームの声かけは 1 セットに 1 回。resetSet で戻る', () => {
    vi.useFakeTimers()
    const { speak } = stubSpeech()
    const v = createVoice(true)
    expect(v.cue('胸を前の壁へ')).toBe(true)
    expect(v.cue('足裏全体で押す')).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(speak).toHaveBeenCalledTimes(1)
    v.resetSet()
    expect(v.cue('足裏全体で押す')).toBe(true)
  })

  it('オフのときは何も読まず、制限の数にも入らない', () => {
    const { speak } = stubSpeech()
    const v = createVoice(false)
    v.prime()
    v.say('スタート')
    expect(v.placement('斜めです')).toBe(false)
    expect(v.cue('胸を前の壁へ')).toBe(false)
    expect(speak).not.toHaveBeenCalled()
  })

  it('声の文は種目で変わるものがあり、決まっていない崩れは undefined', () => {
    expect(cueVoiceText('squat', 'forward-lean')).toBe('胸を前の壁へ')
    expect(cueVoiceText('bench', 'shallow')).not.toBe(cueVoiceText('squat', 'shallow'))
    expect(cueVoiceText('squat', 'no-such-code')).toBeUndefined()
  })
})
