import { describe, expect, it } from 'vitest'
import type { AppData, Entry, Exercise, Session } from '../types'
import {
  buildNextSet, centeredScrollTop, currentSetPos, feedbackComplete, fillWeightAfterComplete, findFirstUndone, hasWarmup, makeUndo, previousSetText, progressCount,
  restoreSession, shouldPreAlert, showRestRir, stepValue, withoutLastSet,
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

describe('currentSetPos', () => {
  it('ベンチ途中でラット1セット目を完了したら、次はラット2セット目（タイマーの次も同じ）', () => {
    const entries = [entry('bench', [true, true, true, false]), entry('row', [true, false])]
    expect(currentSetPos(entries, 'row')).toEqual({ entryIndex: 1, setIndex: 1 })
    const byId = new Map([['bench', ex('bench', 'ベンチプレス')], ['row', ex('row', 'ラットプルダウン')]])
    expect(buildNextSet(entries, byId, 'row')).toMatchObject({ exerciseName: 'ラットプルダウン', setNo: 2, totalSets: 2 })
    // 画面の focus を使わない旧判定（一覧順の最初）だとベンチ4セット目になる
    expect(buildNextSet(entries, byId)).toMatchObject({ exerciseName: 'ベンチプレス', setNo: 4 })
  })
  it('focus の種目が全部終わったら、後ろの種目へ進む', () => {
    const entries = [entry('a', [false]), entry('b', [true, true]), entry('c', [true, false])]
    expect(currentSetPos(entries, 'b')).toEqual({ entryIndex: 2, setIndex: 1 })
  })
  it('後ろが全部終わっていたら、前の種目の未完了へ戻る', () => {
    const entries = [entry('a', [true, false, false]), entry('b', [true]), entry('c', [true])]
    expect(currentSetPos(entries, 'c')).toEqual({ entryIndex: 0, setIndex: 1 })
  })
  it('focus が未設定・一覧にないときは一覧順の最初の未完了', () => {
    const entries = [entry('a', [true]), entry('b', [false, false]), entry('c', [false])]
    expect(currentSetPos(entries, undefined)).toEqual({ entryIndex: 1, setIndex: 0 })
    expect(currentSetPos(entries, 'zzz')).toEqual({ entryIndex: 1, setIndex: 0 })
  })
  it('focus の種目の最初の未完了セットを返す（途中のセットが抜けていても最初のもの）', () => {
    expect(currentSetPos([entry('a', [false]), entry('b', [true, false, false])], 'b')).toEqual({ entryIndex: 1, setIndex: 1 })
  })
  it('削除済みの種目（isVisible が false）は飛ばす', () => {
    const entries = [entry('a', [false]), entry('b', [false]), entry('c', [false])]
    expect(currentSetPos(entries, 'b', e => e.exerciseId !== 'b')).toEqual({ entryIndex: 2, setIndex: 0 })
    expect(currentSetPos(entries, undefined, e => e.exerciseId === 'c')).toEqual({ entryIndex: 2, setIndex: 0 })
  })
  it('すべて完了なら undefined', () => {
    expect(currentSetPos([entry('a', [true]), entry('b', [true])], 'a')).toBeUndefined()
    expect(currentSetPos([], 'a')).toBeUndefined()
  })
})

describe('progressCount', () => {
  it('完了数と全セット数', () => {
    expect(progressCount([entry('a', [true, false]), entry('b', [true, true, false])])).toEqual({ done: 3, total: 5 })
    expect(progressCount([])).toEqual({ done: 0, total: 0 })
  })
})

describe('previousSetText', () => {
  const prev: Entry = { exerciseId: 'a', sets: [set(true, 60, 10), set(true, 57.5, 9), set(false, 55, 8)] }
  it('前回の同じ番号の完了セット', () => {
    expect(previousSetText(prev, 0)).toBe('60×10')
    expect(previousSetText(prev, 1)).toBe('57.5×9')
  })
  it('前回がない・同じ番号がない・未完了なら undefined', () => {
    expect(previousSetText(undefined, 0)).toBeUndefined()
    expect(previousSetText(prev, 3)).toBeUndefined()
    expect(previousSetText(prev, 2)).toBeUndefined()
  })
})

describe('feedbackComplete', () => {
  it('4項目がそろったときだけ true', () => {
    expect(feedbackComplete(undefined)).toBe(false)
    expect(feedbackComplete({ pump: 1, workload: 1, soreness: 0 })).toBe(false)
    expect(feedbackComplete({ pump: 0, workload: 0, soreness: 0, joint: false })).toBe(true)
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
  it('完了の取り消しは休憩タイマーも止める印を持つ', () => {
    expect(makeUndo('x', session).stopTimer).toBe(false)
    expect(makeUndo('x', session, true).stopTimer).toBe(true)
  })
  it('session が無くなっていても足す', () => {
    expect(restoreSession({ ...data, sessions: [] }, session).sessions).toEqual([session])
  })
})

describe('休憩中の余力入力・残り10秒の予告', () => {
  it('休憩の最初の30秒だけ余力を出す', () => {
    expect(showRestRir(0)).toBe(true)
    expect(showRestRir(29999)).toBe(true)
    expect(showRestRir(30000)).toBe(false)
    expect(showRestRir(-1)).toBe(false)
  })

  it('残りちょうど10秒で、まだ予告していないときだけ予告する', () => {
    expect(shouldPreAlert(10, false)).toBe(true)
    expect(shouldPreAlert(10, true)).toBe(false)
    expect(shouldPreAlert(11, false)).toBe(false)
    expect(shouldPreAlert(9, false)).toBe(false)
    expect(shouldPreAlert(0, false)).toBe(false)
  })
})

describe('fillWeightAfterComplete', () => {
  it('未入力（0）の後続の未完了セットに重量を入れ、回数は変えない', () => {
    const sets = [set(true, 40, 8), set(false, 0, 10), set(false, 0, 12)]
    expect(fillWeightAfterComplete(sets, 0)).toEqual([set(true, 40, 8), set(false, 40, 10), set(false, 40, 12)])
  })
  it('重量が入っている後続・完了済み・前のセットは変えない', () => {
    const sets = [set(false, 0, 8), set(true, 30, 8), set(false, 35, 8), set(false, 0, 8)]
    expect(fillWeightAfterComplete(sets, 1)).toEqual([set(false, 0, 8), set(true, 30, 8), set(false, 35, 8), set(false, 30, 8)])
  })
  it('完了したセットの重量が 0 なら何もしない', () => {
    const sets = [set(true, 0, 8), set(false, 0, 8)]
    expect(fillWeightAfterComplete(sets, 0)).toBe(sets)
  })
})
