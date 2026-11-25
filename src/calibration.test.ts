import { describe, expect, it } from 'vitest'
import { isCalibrationDue, rirBias, rirSamples } from './calibration'
import type { AppData, Entry, Exercise, Session, SetLog, Target } from './types'

const ex = (id: string, equipment?: Exercise['equipment']): Exercise => ({
  id, name: id, part: '胸', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2,
  primary: ['胸'], secondary: [], equipment,
})
const target: Target = { kind: 'reps', weight: 20, reps: 8, sets: 3, rir: 2, reason: '' }
const amrapSet = (reps: number, rir?: number, extra: Partial<SetLog> = {}): SetLog =>
  ({ weight: 20, reps, done: true, rir, amrap: true, ...extra })
const entry = (id: string, sets: SetLog[], t: Target | undefined = target): Entry => ({ exerciseId: id, sets, target: t })
const sess = (date: string, entries: Entry[]): Session => ({ id: date, date, entries })
const data = (sessions: Session[]): AppData =>
  ({ version: 1, exercises: [], sessions, restSeconds: 120, weeklyTargets: {} })

describe('rirSamples', () => {
  it('誤差 = (reps − 目標回数) − rir を新しい順に集める', () => {
    const d = data([
      sess('2026-01-01', [entry('a', [amrapSet(10, 1)])]), // 2 - 1 = 1
      sess('2026-02-01', [entry('a', [amrapSet(9, 2)])]), // 1 - 2 = -1
    ])
    expect(rirSamples('a', d, '2026-03-01')).toEqual([-1, 1])
  })

  it('対象外を除く（amrap でない・未完了・rir なし・目標未満・target なし・before 以降）', () => {
    const d = data([
      sess('2026-01-01', [
        entry('a', [
          { weight: 20, reps: 10, done: true, rir: 1 },
          amrapSet(10, 1, { done: false }),
          amrapSet(10, undefined),
          amrapSet(7, 1),
          amrapSet(10, 1),
        ]),
        { exerciseId: 'a', sets: [amrapSet(10, 1)] },
      ]),
      sess('2026-03-01', [entry('a', [amrapSet(10, 1)])]),
    ])
    expect(rirSamples('a', d, '2026-03-01')).toEqual([1])
  })

  it('種目指定なしなら全種目', () => {
    const d = data([sess('2026-01-01', [entry('a', [amrapSet(10, 1)]), entry('b', [amrapSet(10, 0)])])])
    expect(rirSamples('a', d, '2027-01-01')).toEqual([1])
    expect(rirSamples(undefined, d, '2027-01-01')).toEqual([1, 2])
  })
})

describe('rirBias', () => {
  const mk = (id: string, errs: number[], start = 1) =>
    errs.map((e, i) => sess(`2026-01-${String(start + i).padStart(2, '0')}`, [entry(id, [amrapSet(8 + e + 1, 1)])]))
  // reps = 8 + e + 1, rir 1 → 誤差 e

  it('サンプルが2件未満なら補正なし', () => {
    expect(rirBias('a', data(mk('a', [1])), '2026-12-01')).toEqual({ bias: 0, samples: 0, scope: 'none' })
  })

  it('その種目が2件以上なら種目別', () => {
    const r = rirBias('a', data([...mk('a', [1, 1]), ...mk('b', [3, 3, 3], 10)]), '2026-12-01')
    expect(r).toEqual({ bias: 1, samples: 2, scope: 'exercise' })
  })

  it('種目が足りなければ全種目にフォールバック', () => {
    const r = rirBias('a', data([...mk('a', [2], 1), ...mk('b', [0], 10)]), '2026-12-01')
    expect(r).toEqual({ bias: 1, samples: 2, scope: 'all' })
  })

  it('直近5件の平均', () => {
    // 古い順 3,3,0,0,0,0,0 → 直近5件は全部0
    const r = rirBias('a', data(mk('a', [3, 3, 0, 0, 0, 0, 0])), '2026-12-01')
    expect(r).toEqual({ bias: 0, samples: 5, scope: 'exercise' })
  })

  it('0.5刻みに丸め、−2〜+3 に収める', () => {
    expect(rirBias('a', data(mk('a', [1, 0, 0])), '2026-12-01').bias).toBe(0.5) // 0.33 → 0.5
    expect(rirBias('a', data(mk('a', [5, 5])), '2026-12-01').bias).toBe(3)
    const low = [1, 2].map(i => sess(`2026-01-0${i}`, [entry('a', [amrapSet(8, 7)])])) // 誤差 −7
    expect(rirBias('a', data(low), '2026-12-01').bias).toBe(-2)
  })
})

describe('isCalibrationDue', () => {
  const hist = (n: number) => Array.from({ length: n }, () => entry('a', [amrapSet(8, 2)]))
  it('4回目（過去3回）で true', () => {
    expect([0, 1, 2, 3, 4, 7].map(n => isCalibrationDue(ex('a', 'dumbbell'), hist(n))))
      .toEqual([false, false, false, true, false, true])
  })
  it('バーベルは常に false', () => {
    expect(isCalibrationDue(ex('a', 'barbell'), hist(3))).toBe(false)
  })
})
