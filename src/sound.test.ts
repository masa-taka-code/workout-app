import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('sound', () => {
  it('AudioContext が無い環境でも例外を投げない', async () => {
    vi.stubGlobal('window', {})
    const { primeAudio, playRestEnd, playTest } = await import('./sound')
    expect(() => primeAudio()).not.toThrow()
    expect(() => playRestEnd()).not.toThrow()
    expect(() => playTest()).not.toThrow()
  })

  it('AudioContext の生成や再生が失敗しても例外を投げない', async () => {
    class Broken {
      constructor() {
        throw new Error('fail')
      }
    }
    vi.stubGlobal('window', { AudioContext: Broken })
    const { primeAudio, playRestEnd } = await import('./sound')
    expect(() => primeAudio()).not.toThrow()
    expect(() => playRestEnd()).not.toThrow()
  })

  it('3回分の音を鳴らし、suspended なら resume する', async () => {
    const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
    const resume = vi.fn().mockResolvedValue(undefined)
    class Fake {
      state = 'suspended'
      currentTime = 0
      destination = {}
      resume = resume
      createOscillator = () => osc
      createGain = () => gain
    }
    vi.stubGlobal('window', { webkitAudioContext: Fake })
    const { playTest } = await import('./sound')
    playTest()
    expect(resume).toHaveBeenCalled()
    expect(osc.start).toHaveBeenCalledTimes(3)
    expect(osc.frequency.value).toBe(880)
  })
})
