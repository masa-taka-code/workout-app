import { describe, expect, it } from 'vitest'
import {
  AUTO_END_HIDDEN_MS, AUTO_END_IDLE_MS, AUTO_START_MS, initialAutoEnd, judgePlacement, pickLiveCue, stepAutoEnd, stepAutoStart,
} from './capture'
import type { AutoEndState } from './capture'
import { LM } from './types'
import type { Pose, RepResult } from './types'

function rep(index: number, codes: string[], velocityLossPct?: number): RepResult {
  return {
    index, score: 80, romDeg: 90, eccentricSec: 2, concentricSec: 1, minAngle: 80, maxAngle: 170,
    issues: codes.map(code => ({ code, message: code, fix: code, penalty: 5 })),
    metrics: velocityLossPct === undefined ? undefined : { confidence: 0.9, view: 'side', viewOk: 'ok', velocityLossPct },
  }
}

describe('自動開始', () => {
  it('良い状態が 1.5 秒続いたら開始する', () => {
    let s = {}
    let r = stepAutoStart(s, 'ok', 1000)
    expect(r.start).toBe(false)
    s = r.state
    r = stepAutoStart(s, 'ok', 1000 + AUTO_START_MS - 1)
    expect(r.start).toBe(false)
    s = r.state
    r = stepAutoStart(s, 'ok', 1000 + AUTO_START_MS)
    expect(r.start).toBe(true)
  })

  it('caution でも開始する', () => {
    const a = stepAutoStart({}, 'caution', 0)
    expect(stepAutoStart(a.state, 'caution', AUTO_START_MS).start).toBe(true)
  })

  it('途中で ng や映らなくなったらやり直し、ng のままでは開始しない', () => {
    const a = stepAutoStart({}, 'ok', 0)
    const b = stepAutoStart(a.state, 'hidden', 1000)
    const c = stepAutoStart(b.state, 'ok', 1400)
    expect(stepAutoStart(c.state, 'ok', 1400 + AUTO_START_MS - 1).start).toBe(false)
    let s = {}
    for (let t = 0; t <= 10000; t += 500) {
      const r = stepAutoStart(s, 'ng', t)
      expect(r.start).toBe(false)
      s = r.state
    }
  })
})

function run(
  steps: { t: number; reps: number; visible: boolean }[],
): { endedAt?: number } {
  let state: AutoEndState = initialAutoEnd
  for (const st of steps) {
    const r = stepAutoEnd(state, { nowMs: st.t, repCount: st.reps, visible: st.visible })
    state = r.state
    if (r.end) return { endedAt: st.t }
  }
  return {}
}

describe('自動終了・セット分割', () => {
  it('レップが 0 回のうちは、何秒たっても終了しない', () => {
    expect(run([{ t: 0, reps: 0, visible: true }, { t: 60000, reps: 0, visible: true }, { t: 61000, reps: 0, visible: false }, { t: 70000, reps: 0, visible: false }]).endedAt).toBeUndefined()
  })

  it('最後のレップから 8 秒で終了する（7.9 秒では終了しない）', () => {
    expect(run([
      { t: 1000, reps: 1, visible: true },
      { t: 1000 + AUTO_END_IDLE_MS - 1, reps: 1, visible: true },
    ]).endedAt).toBeUndefined()
    expect(run([
      { t: 1000, reps: 1, visible: true },
      { t: 1000 + AUTO_END_IDLE_MS, reps: 1, visible: true },
    ]).endedAt).toBe(1000 + AUTO_END_IDLE_MS)
  })

  it('レップが増えると 8 秒の数え直しになる', () => {
    expect(run([
      { t: 0, reps: 1, visible: true },
      { t: 6000, reps: 2, visible: true },
      { t: 13000, reps: 2, visible: true },
      { t: 14000, reps: 2, visible: true },
    ]).endedAt).toBe(14000)
  })

  it('体が 3 秒映らなければ終了する（2.9 秒では終了しない）', () => {
    expect(run([
      { t: 0, reps: 2, visible: true },
      { t: 1000, reps: 2, visible: false },
      { t: 1000 + AUTO_END_HIDDEN_MS - 1, reps: 2, visible: false },
    ]).endedAt).toBeUndefined()
    expect(run([
      { t: 0, reps: 2, visible: true },
      { t: 1000, reps: 2, visible: false },
      { t: 1000 + AUTO_END_HIDDEN_MS, reps: 2, visible: false },
    ]).endedAt).toBe(1000 + AUTO_END_HIDDEN_MS)
  })

  it('映らなかった時間は、映ったらリセットされる', () => {
    expect(run([
      { t: 0, reps: 2, visible: true },
      { t: 1000, reps: 2, visible: false },
      { t: 3000, reps: 2, visible: true },
      { t: 5000, reps: 2, visible: false },
      { t: 7000, reps: 2, visible: false },
    ]).endedAt).toBeUndefined()
  })

  it('動画のセット分割：8 秒以上レップの無い区間で区切る', () => {
    // 動画の時刻（ミリ秒）で、レップが 3 回 → 10 秒の空き → 2 回
    const repTimes = [2000, 4500, 7000, 17000, 19500]
    const lastTime = 22000
    const ends: number[] = []
    let state: AutoEndState = initialAutoEnd
    let count = 0
    for (let t = 0; t <= lastTime; t += 500) {
      count = state.repCount + repTimes.filter(x => x === t).length
      const r = stepAutoEnd(state, { nowMs: t, repCount: count, visible: true })
      state = r.state
      if (r.end) {
        ends.push(t)
        state = initialAutoEnd // 新しいセット
      }
    }
    expect(ends).toEqual([7000 + AUTO_END_IDLE_MS])
  })
})

describe('置き場所の判定', () => {
  const blank = (): Pose => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }))
  const sidePose = (): Pose => {
    const p = blank()
    for (const i of [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip]) {
      p[i] = { x: 0.5, y: 0.2 + (i % 5) * 0.1, z: 0, visibility: 0.9 }
    }
    return p
  }

  it('姿勢が無い・関節が見えないときは hidden', () => {
    expect(judgePlacement('bench', undefined)).toBe('hidden')
    expect(judgePlacement('bench', blank())).toBe('hidden')
  })

  it('world の肩の向きが真横なら ok、正面なら ng', () => {
    const w = (sx: number, sz: number): Pose => {
      const p = blank()
      p[LM.leftShoulder] = { x: -sx, y: 0, z: -sz }
      p[LM.rightShoulder] = { x: sx, y: 0, z: sz }
      return p
    }
    expect(judgePlacement('bench', sidePose(), w(0, 0.2))).toBe('ok')
    expect(judgePlacement('bench', sidePose(), w(0.2, 0))).toBe('ng')
  })
})

describe('セット中の声かけ', () => {
  it('同じ崩れが 2 レップ続いたときだけ出す', () => {
    expect(pickLiveCue('squat', [rep(1, ['forward-lean'])], [])).toBeUndefined()
    expect(pickLiveCue('squat', [rep(1, ['forward-lean']), rep(2, ['heel-lift'])], [])).toBeUndefined()
    const cue = pickLiveCue('squat', [rep(1, ['forward-lean']), rep(2, ['forward-lean'])], [])
    expect(cue?.code).toBe('forward-lean')
    expect(cue?.voice).toBe('胸を前の壁へ')
  })

  it('速度低下が 30% を超えたあとは、安全に関わる崩れだけ', () => {
    const reps = [rep(1, ['forward-lean', 'knee-valgus']), rep(2, ['forward-lean', 'knee-valgus'], 35)]
    expect(pickLiveCue('squat', reps, [])?.code).toBe('knee-valgus')
    const onlyLean = [rep(1, ['forward-lean']), rep(2, ['forward-lean'], 35)]
    expect(pickLiveCue('squat', onlyLean, [])).toBeUndefined()
  })

  it('shouldCueLive が false の崩れ（直近 3 回で 0 回）は言わない', () => {
    const h = (n: number) => ({
      date: '2026-01-0' + n, exerciseId: 'sq', key: 'squat' as const, weight: 60, reps: 5, avgScore: 80, faultCounts: {}, confidence: 0.9,
    })
    expect(pickLiveCue('squat', [rep(1, ['forward-lean']), rep(2, ['forward-lean'])], [h(3), h(2), h(1)])).toBeUndefined()
  })

  it('安全に関わる崩れ（knee-valgus・hip-rise）は、shouldCueLive が false でも 2 レップ続けば言う', () => {
    const h = { date: '2026-11-20', exerciseId: 'e', key: 'squat' as const, weight: 60, reps: 5, avgScore: 90, faultCounts: {}, confidence: 1 }
    const cue = pickLiveCue('squat', [rep(1, ['knee-valgus']), rep(2, ['knee-valgus'])], [h, h, h])
    expect(cue?.code).toBe('knee-valgus')
    expect(pickLiveCue('squat', [rep(1, ['knee-valgus'])], [h, h, h])).toBeUndefined() // 1 レップだけでは言わない
    expect(pickLiveCue('bench', [rep(1, ['hip-rise']), rep(2, ['hip-rise'])], [{ ...h, key: 'bench' }, { ...h, key: 'bench' }, { ...h, key: 'bench' }])?.code).toBe('hip-rise')
  })

  it('shouldCueLive が false の崩れは、同じ崩れが 3 レップ続いたら言う（2 レップでは言わない）', () => {
    const h = { date: '2026-11-20', exerciseId: 'e', key: 'squat' as const, weight: 60, reps: 5, avgScore: 90, faultCounts: {}, confidence: 1 }
    const hist = [h, h, h]
    expect(pickLiveCue('squat', [rep(1, ['forward-lean']), rep(2, ['forward-lean'])], hist)).toBeUndefined()
    expect(pickLiveCue('squat', [rep(1, ['forward-lean']), rep(2, ['forward-lean']), rep(3, ['forward-lean'])], hist)?.code).toBe('forward-lean')
    // 3 レップのうち最初が違えば、連続 2 レップなので言わない
    expect(pickLiveCue('squat', [rep(1, []), rep(2, ['forward-lean']), rep(3, ['forward-lean'])], hist)).toBeUndefined()
    // 3 レップ続いても、直近の履歴で出ている崩れは従来どおり 2 レップで言う
    const withFault = { ...h, faultCounts: { 'forward-lean': 2 } }
    expect(pickLiveCue('squat', [rep(1, ['forward-lean']), rep(2, ['forward-lean'])], [withFault, h, h])?.code).toBe('forward-lean')
  })

  it('計測中の v1 の code を v2 にそろえて、履歴によるフェーディングと声を決める', () => {
    // squat の v1「lean」は v2「forward-lean」。直近3回で forward-lean が0回なら言わない
    const h0 = { date: '2026-11-20', exerciseId: 'e', key: 'squat' as const, weight: 60, reps: 5, avgScore: 90, faultCounts: {}, confidence: 1 }
    expect(pickLiveCue('squat', [rep(1, ['lean']), rep(2, ['lean'])], [h0, h0, h0])).toBeUndefined()
    expect(pickLiveCue('squat', [rep(1, ['lean']), rep(2, ['lean'])], [])?.code).toBe('forward-lean')
    // curl の v1「body-english」（体幹の反動）は v2「swing」で、声は「背中を壁に」
    const swing = pickLiveCue('curl', [rep(1, ['body-english']), rep(2, ['body-english'])], [])
    expect(swing?.code).toBe('swing')
    expect(swing?.voice).toBe('背中を壁に')
    // curl の v1「swing」（肘の前後）は v2「elbow-forward」
    expect(pickLiveCue('curl', [rep(1, ['swing']), rep(2, ['swing'])], [])?.code).toBe('elbow-forward')
  })

  it('声が決まっていない崩れは言わない', () => {
    expect(pickLiveCue('squat', [rep(1, ['unknown-code']), rep(2, ['unknown-code'])], [])).toBeUndefined()
  })
})
