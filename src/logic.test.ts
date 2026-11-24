import { describe, expect, it } from 'vitest'
import {
  achieved, adjustSetsForVolume, e1rm, planExercise, rampWeeklyTargets, roundTo, suggestTarget, volumeBetween, weekStart,
} from './logic'
import type { AppData, Entry, Exercise, Session, SetLog } from './types'

const bench: Exercise = {
  id: 'bench', name: 'ベンチプレス', part: '胸', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2,
  primary: ['胸'], secondary: ['上腕三頭筋', '肩前部'],
}

const s = (weight: number, reps: number, rir?: number): SetLog => ({ weight, reps, done: true, rir })
const entry = (sets: SetLog[], target?: Entry['target']): Entry => ({ exerciseId: 'bench', sets, target })
const session = (date: string, entries: Entry[]): Session => ({ id: date, date, entries })
const data = (sessions: Session[], weeklyTargets = {}): AppData => ({ version: 1, exercises: [bench], sessions, restSeconds: 120, weeklyTargets })

describe('基本計算', () => {
  it('RIR で補正した推定1RM', () => {
    expect(e1rm(100, 5)).toBeCloseTo(116.67, 1)
    expect(e1rm(100, 5, 1)).toBe(120)
  })
  it('刻みに丸める', () => {
    expect(roundTo(56.3, 2.5)).toBe(57.5)
    expect(roundTo(54, 2.5)).toBe(55)
  })
  it('週の始まりは月曜', () => {
    expect(weekStart('2026-11-24')).toBe('2026-11-23') // 火曜 → 月曜
    expect(weekStart('2026-11-29')).toBe('2026-11-23') // 日曜 → 同じ週の月曜
  })
})

describe('種目ごとの目標', () => {
  it('記録がなければ初回の案内', () => {
    expect(suggestTarget(bench, []).kind).toBe('first')
  })

  it('全セット上限かつ目標RIRどおりなら +1 刻み', () => {
    const t = suggestTarget(bench, [entry([s(60, 10, 2), s(60, 10, 2), s(60, 10, 2)])])
    expect(t).toMatchObject({ kind: 'increase', weight: 62.5, reps: 6 })
  })

  it('余力が3回以上残っていれば +2 刻み', () => {
    const t = suggestTarget(bench, [entry([s(60, 10, 5), s(60, 10, 5), s(60, 10, 5)])])
    expect(t).toMatchObject({ kind: 'increase', weight: 65 })
  })

  it('上限に届いても目標RIRより追い込んでいたら上げない', () => {
    const t = suggestTarget(bench, [entry([s(60, 10, 0), s(60, 10, 0), s(60, 10, 0)])])
    expect(t.kind).toBe('reps')
  })

  it('上限未満なら同重量でレップ +1、余力2以上なら +2', () => {
    expect(suggestTarget(bench, [entry([s(60, 8, 2), s(60, 8, 2), s(60, 7, 2)])])).toMatchObject({ kind: 'reps', weight: 60, reps: 8 })
    expect(suggestTarget(bench, [entry([s(60, 8, 4), s(60, 8, 4), s(60, 8, 4)])])).toMatchObject({ reps: 10 })
  })

  it('2回連続で目標未達ならデロード', () => {
    const target = { kind: 'reps' as const, weight: 60, reps: 9, sets: 3, rir: 2, reason: '' }
    const missed = entry([s(60, 8, 1), s(60, 7, 0), s(60, 6, 0)], target)
    expect(achieved(missed)).toBe(false)
    const t = suggestTarget(bench, [missed, missed])
    expect(t).toMatchObject({ kind: 'deload', weight: 55, sets: 2 })
  })
})

describe('週ボリューム', () => {
  it('主働筋1・補助筋0.5で数える', () => {
    const vol = volumeBetween([session('2026-11-23', [entry([s(60, 8), s(60, 8), s(60, 8)])])], [bench], '2026-11-23', '2026-11-30')
    expect(vol).toEqual({ 胸: 3, 上腕三頭筋: 1.5, 肩前部: 1.5 })
  })

  it('先週が目標未満なら +1、20超なら −1', () => {
    expect(adjustSetsForVolume(bench, 3, { 胸: 6 }, {}).sets).toBe(4)
    expect(adjustSetsForVolume(bench, 3, { 胸: 22 }, {}).sets).toBe(2)
    expect(adjustSetsForVolume(bench, 3, { 胸: 12 }, {}).sets).toBe(3)
  })

  it('達成率80%以上が3週続けば週目標を +1', () => {
    const target = { kind: 'reps' as const, weight: 60, reps: 8, sets: 3, rir: 2, reason: '' }
    const good = (date: string) => session(date, [entry([s(60, 8), s(60, 8), s(60, 8)], target)])
    const d = data([good('2026-11-02'), good('2026-11-09'), good('2026-11-16')])
    expect(rampWeeklyTargets(d, '2026-11-24')).toMatchObject({ 胸: 11 })
  })
})

describe('今日の計画', () => {
  it('先週のボリューム不足と調子を反映する', () => {
    const d = data([session('2026-11-17', [entry([s(60, 10, 2), s(60, 10, 2), s(60, 10, 2)])])])
    const t = planExercise(bench, d, '2026-11-24')
    expect(t).toMatchObject({ kind: 'increase', weight: 62.5, sets: 4 }) // 先週の胸は3セット < 10
    expect(planExercise(bench, d, '2026-11-24', 'bad').sets).toBe(3)
  })

  it('1回あたりの上限を守る', () => {
    const d = data([])
    expect(planExercise(bench, d, '2026-11-24', 'normal', { 胸: 8 }).sets).toBe(2)
  })
})
