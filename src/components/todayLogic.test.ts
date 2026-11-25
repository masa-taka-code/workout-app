import { describe, expect, it } from 'vitest'
import type { AppData, Entry, Exercise, Session } from '../types'
import {
  buildNextSet, centeredScrollTop, findFirstUndone, findScrollTarget, hasWarmup, makeUndo, restoreSession, stepValue, withoutLastSet,
} from './todayLogic'

const set = (done: boolean, weight = 50, reps = 8) => ({ weight, reps, done })
const entry = (id: string, dones: boolean[]): Entry => ({ exerciseId: id, sets: dones.map(d => set(d)) })
const ex = (id: string, name: string, extra: Partial<Exercise> = {}): Exercise =>
  ({ id, name, part: '胸', repMin: 6, repMax: 10, increment: 2.5, equipment: 'barbell', ...extra }) as Exercise

describe('findFirstUndone', () => {
  it('種目の追加順→セット順で最初の未完了を返す', () => {
    expect(findFirstUndone([entry('a', [true, true]), entry('b', [true, false, false])])).toEqual({ entryIndex: 1, setIndex: 1 })
  })
  it('すべて完了なら undefined', () => {
    expect(findFirstUndone([entry('a', [true]), entry('b', [true])])).toBeUndefined()
  })
  it('isVisible で除いた種目は飛ばす', () => {
    expect(findFirstUndone([entry('a', [false]), entry('b', [false])], e => e.exerciseId === 'b')).toEqual({ entryIndex: 1, setIndex: 0 })
  })
})

describe('findScrollTarget', () => {
  const entries = [entry('a', [true, false]), entry('b', [false]), entry('c', [true])]
  it('同じ種目に未完了があればそこ', () => {
    expect(findScrollTarget(entries, 0)).toEqual({ entryIndex: 0, setIndex: 1 })
  })
  it('同じ種目が終わっていれば次の種目', () => {
    expect(findScrollTarget([entry('a', [true]), entry('b', [false])], 0)).toEqual({ entryIndex: 1, setIndex: 0 })
  })
  it('全部完了なら undefined', () => {
    expect(findScrollTarget([entry('a', [true]), entry('b', [true])], 0)).toBeUndefined()
  })
})

describe('buildNextSet', () => {
  const byId = new Map([['a', ex('a', 'ベンチプレス')], ['b', ex('b', 'カール')]])
  it('名前・何セット目・全セット数・重量・回数', () => {
    const entries: Entry[] = [
      { exerciseId: 'a', sets: [set(true, 57.5, 6), set(false, 57.5, 6), set(false, 57.5, 6), set(false, 57.5, 6)] },
      entry('b', [false]),
    ]
    expect(buildNextSet(entries, byId)).toEqual({ exerciseName: 'ベンチプレス', setNo: 2, totalSets: 4, weight: 57.5, reps: 6 })
  })
  it('なければ undefined', () => {
    expect(buildNextSet([entry('a', [true])], byId)).toBeUndefined()
    expect(buildNextSet([], byId)).toBeUndefined()
  })
  it('種目一覧にないものは飛ばす', () => {
    expect(buildNextSet([entry('zzz', [false]), entry('b', [false])], byId)?.exerciseName).toBe('カール')
  })
})

describe('stepValue', () => {
  it('増減し、0 未満にならない', () => {
    expect(stepValue(57.5, 2.5)).toBe(60)
    expect(stepValue(0, -1)).toBe(0)
    expect(stepValue(1, -2.5)).toBe(0)
  })
  it('小数の誤差を丸める', () => {
    expect(stepValue(0.1, 0.2)).toBe(0.3)
  })
})

describe('centeredScrollTop', () => {
  it('見える範囲の中央に置く', () => {
    // 高さ 740 − タブバー 56 − タイマー 140 = 544、要素 200 → 上に 172
    expect(centeredScrollTop(500, 200, 100, 740, 56, 140)).toBe(100 + 500 - 172)
  })
  it('要素が高ければ上端合わせ、負にはしない', () => {
    expect(centeredScrollTop(300, 800, 0, 740, 56, 140)).toBe(292)
    expect(centeredScrollTop(0, 100, 0, 740, 56, 0)).toBe(0)
  })
})

describe('hasWarmup', () => {
  it('初回・重量未定は出さない', () => {
    const t = { kind: 'first', weight: 0, reps: 8, sets: 3, rir: 2, reason: '' } as const
    expect(hasWarmup(ex('a', 'x'), t)).toBe(false)
    expect(hasWarmup(ex('a', 'x'), undefined)).toBe(false)
  })
  it('バーベルで重量があれば出す', () => {
    const t = { kind: 'reps', weight: 60, reps: 8, sets: 3, rir: 2, reason: '' } as const
    expect(hasWarmup(ex('a', 'x'), t)).toBe(true)
  })
})

describe('undo', () => {
  const session: Session = { id: 's1', date: '2026-11-25', entries: [entry('a', [true, false])] }
  const data = { sessions: [session, { id: 's0', date: '2026-11-24', entries: [] }] } as unknown as AppData
  it('削除前の session に丸ごと戻る', () => {
    const undo = makeUndo('2セット目を削除しました', session)
    const removed: AppData = { ...data, sessions: data.sessions.map(s => (s.id === 's1' ? { ...s, entries: [withoutLastSet(s.entries[0])] } : s)) }
    expect(removed.sessions[0].entries[0].sets).toHaveLength(1)
    const back = restoreSession(removed, undo.session)
    expect(back.sessions[0]).toBe(session)
    expect(back.sessions).toHaveLength(2)
  })
  it('session が無くなっていても足す', () => {
    expect(restoreSession({ ...data, sessions: [] }, session).sessions).toEqual([session])
  })
})
