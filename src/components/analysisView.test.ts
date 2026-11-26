import { describe, expect, it } from 'vitest'
import type { Entry, Exercise, Session } from '../types'
import { barRatio, isPersonalBest, levelTone, muscleLevel } from './analysisView'

describe('muscleLevel', () => {
  it('目標以上は達成、7割以上は あと少し、それ未満は不足', () => {
    expect(muscleLevel(10, 10)).toBe('achieved')
    expect(muscleLevel(12, 10)).toBe('achieved')
    expect(muscleLevel(7, 10)).toBe('close')
    expect(muscleLevel(9, 10)).toBe('close')
    expect(muscleLevel(6, 10)).toBe('short')
    expect(muscleLevel(0, 10)).toBe('short')
  })
  it('目標が大きいときは割合で見る', () => {
    expect(muscleLevel(14, 20)).toBe('close')
    expect(muscleLevel(13, 20)).toBe('short')
  })
  it('週の上限（20セット）を超えたら上限超え', () => {
    expect(muscleLevel(20, 20)).toBe('achieved')
    expect(muscleLevel(21, 12)).toBe('over')
  })
})

describe('levelTone', () => {
  it('不足は週が終わったあとだけ橙', () => {
    expect(levelTone('short', false)).toBe('muted')
    expect(levelTone('short', true)).toBe('warn')
  })
  it('達成・あと少し・上限超え', () => {
    expect(levelTone('achieved', false)).toBe('good')
    expect(levelTone('close', true)).toBe('ink')
    expect(levelTone('over', false)).toBe('bad')
  })
})

describe('barRatio', () => {
  it('0〜1 に収める', () => {
    expect(barRatio(5, 10)).toBe(0.5)
    expect(barRatio(15, 10)).toBe(1)
    expect(barRatio(0, 10)).toBe(0)
    expect(barRatio(3, 0)).toBe(1)
  })
})

describe('isPersonalBest', () => {
  const ex: Exercise = {
    id: 'bench', name: 'ベンチプレス', part: '胸', primary: ['胸'], secondary: [], repMin: 6, repMax: 10,
    increment: 2.5, sets: 3, targetRir: 2,
  } as Exercise
  const entry = (weight: number): Entry => ({ exerciseId: 'bench', sets: [{ weight, reps: 8, done: true, rir: 2 }] })
  const session = (id: string, date: string, weight: number): Session => ({ id, date, entries: [entry(weight)] })

  it('前の記録より推定1RMが高ければ自己ベスト', () => {
    const sessions = [session('a', '2026-11-01', 60), session('b', '2026-11-08', 65)]
    expect(isPersonalBest(sessions[1].entries[0], ex, sessions, '2026-11-08')).toBe(true)
    expect(isPersonalBest(sessions[0].entries[0], ex, sessions, '2026-11-01')).toBe(false)
  })
  it('前より低ければ自己ベストではない', () => {
    const sessions = [session('a', '2026-11-01', 65), session('b', '2026-11-08', 60)]
    expect(isPersonalBest(sessions[1].entries[0], ex, sessions, '2026-11-08')).toBe(false)
  })
})
