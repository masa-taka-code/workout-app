import { describe, expect, it } from 'vitest'
import {
  exerciseAchievement, exerciseSeries, exercisesWithHistory, muscleVolumeThisWeek, personalBests, recentWeeks, weeklySummary,
} from './stats'
import type { AppData, Entry, Exercise, Session, SetLog, Target } from './types'

const bench: Exercise = {
  id: 'bench', name: 'ベンチプレス', part: '胸', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2,
  primary: ['胸'], secondary: ['上腕三頭筋'],
}
const squat: Exercise = {
  id: 'squat', name: 'スクワット', part: '脚', repMin: 5, repMax: 8, increment: 2.5, sets: 3, targetRir: 2,
  primary: ['大腿四頭筋'], secondary: [],
}

const s = (weight: number, reps: number, rir = 0, done = true): SetLog => ({ weight, reps, done, rir })
const target = (weight: number, reps: number, sets = 2, kind: Target['kind'] = 'reps'): Target => ({ kind, weight, reps, sets, rir: 2, reason: '' })
const entry = (exerciseId: string, sets: SetLog[], t?: Target): Entry => ({ exerciseId, sets, target: t })
const session = (date: string, entries: Entry[]): Session => ({ id: date, date, entries })
const data = (sessions: Session[], weeklyTargets: AppData['weeklyTargets'] = {}, exercises = [bench, squat]): AppData => ({
  version: 1, exercises, sessions, restSeconds: 120, weeklyTargets,
})

// 2026-11-24 は火曜、週の月曜は 11-23
const TODAY = '2026-11-24'

describe('exerciseSeries', () => {
  it('記録がなければ空', () => {
    expect(exerciseSeries('bench', data([]))).toEqual([])
  })

  it('古い順に1セッション1点。未完了セットは数えない', () => {
    const d = data([
      session('2026-11-20', [entry('bench', [s(60, 10, 0), s(80, 5, 0, false)])]),
      session('2026-11-10', [entry('bench', [s(50, 10, 0), s(55, 8, 0)])]),
      session('2026-11-15', [entry('squat', [s(100, 5)])]),
    ])
    const series = exerciseSeries('bench', d)
    expect(series.map(p => p.date)).toEqual(['2026-11-10', '2026-11-20'])
    expect(series[0]).toEqual({ date: '2026-11-10', e1rm: 69.7, topWeight: 55, volume: 50 * 10 + 55 * 8 })
    expect(series[1].topWeight).toBe(60)
    expect(series[1].volume).toBe(600)
  })

  it('完了セットがないセッションは点にしない', () => {
    const d = data([session('2026-11-10', [entry('bench', [s(50, 10, 0, false)])])])
    expect(exerciseSeries('bench', d)).toEqual([])
  })

  it('削除済みの種目は空で、落ちない', () => {
    const d = data([session('2026-11-10', [entry('gone', [s(50, 10)])])])
    expect(exerciseSeries('gone', d)).toEqual([])
  })
})

describe('personalBests', () => {
  it('記録がなければ undefined', () => {
    expect(personalBests('bench', data([]))).toBeUndefined()
  })

  it('推定1RMと最大重量を別々に出す', () => {
    const d = data([
      session('2026-11-01', [entry('bench', [s(60, 12, 0)])]), // e1rm 84
      session('2026-11-08', [entry('bench', [s(80, 3, 0)])]), // e1rm 88
    ])
    expect(personalBests('bench', d)).toEqual({
      e1rm: { value: 88, date: '2026-11-08' },
      weight: { value: 80, reps: 3, date: '2026-11-08' },
    })
  })

  it('同重量ならレップが多いほう', () => {
    const d = data([
      session('2026-11-01', [entry('bench', [s(60, 5)])]),
      session('2026-11-08', [entry('bench', [s(60, 8)])]),
    ])
    expect(personalBests('bench', d)?.weight).toEqual({ value: 60, reps: 8, date: '2026-11-08' })
  })

  it('重量もレップも同じなら古い日付', () => {
    const d = data([
      session('2026-11-08', [entry('bench', [s(60, 8)])]),
      session('2026-11-01', [entry('bench', [s(60, 8)])]),
    ])
    const pb = personalBests('bench', d)
    expect(pb?.weight.date).toBe('2026-11-01')
    expect(pb?.e1rm.date).toBe('2026-11-01')
  })

  it('削除済みの種目は undefined', () => {
    const d = data([session('2026-11-01', [entry('gone', [s(60, 8)])])])
    expect(personalBests('gone', d)).toBeUndefined()
  })
})

describe('exerciseAchievement', () => {
  it('目標なし・初回は数えない', () => {
    const d = data([
      session('2026-11-01', [entry('bench', [s(60, 8), s(60, 8)])]),
      session('2026-11-08', [entry('bench', [s(60, 8), s(60, 8)], target(0, 6, 2, 'first'))]),
    ])
    expect(exerciseAchievement('bench', d)).toEqual({ achieved: 0, total: 0 })
  })

  it('達成と未達を数える。他の種目は数えない', () => {
    const d = data([
      session('2026-11-01', [entry('bench', [s(60, 8), s(60, 8)], target(60, 8))]),
      session('2026-11-08', [entry('bench', [s(60, 5), s(60, 5)], target(60, 8)), entry('squat', [s(100, 5)], target(100, 5, 1))]),
    ])
    expect(exerciseAchievement('bench', d)).toEqual({ achieved: 1, total: 2 })
  })
})

describe('recentWeeks', () => {
  it('今週を含めて遡り、古い順', () => {
    expect(recentWeeks(TODAY, 3)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23'])
  })
  it('日曜日は同じ週の月曜から', () => {
    expect(recentWeeks('2026-11-29', 2)).toEqual(['2026-11-16', '2026-11-23'])
  })
  it('月・年をまたぐ', () => {
    expect(recentWeeks('2026-01-02', 2)).toEqual(['2025-12-22', '2025-12-29'])
  })
  it('0週なら空', () => {
    expect(recentWeeks(TODAY, 0)).toEqual([])
  })
})

describe('weeklySummary', () => {
  it('記録がなくても指定週数が返り、rate は undefined', () => {
    const r = weeklySummary(data([]), TODAY)
    expect(r).toHaveLength(8)
    expect(r.every(w => w.sessions === 0 && w.rate === undefined)).toBe(true)
    expect(r[7].week).toBe('2026-11-23')
  })

  it('週またぎ：日曜は前の週、月曜は次の週。完了セットのないセッションは数えない', () => {
    const d = data([
      session('2026-11-22', [entry('bench', [s(60, 8)])]), // 日曜 → 11-16 の週
      session('2026-11-23', [entry('bench', [s(60, 8)])]), // 月曜 → 今週
      session('2026-11-25', [entry('bench', [s(60, 8, 0, false)])]), // 未完了のみ
      session('2026-11-26', [entry('squat', [s(100, 5)])]),
    ])
    const r = weeklySummary(d, TODAY, 2)
    expect(r).toEqual([
      { week: '2026-11-16', sessions: 1, rate: undefined },
      { week: '2026-11-23', sessions: 2, rate: undefined },
    ])
  })

  it('達成率を週ごとに出す', () => {
    const d = data([
      session('2026-11-24', [
        entry('bench', [s(60, 8), s(60, 8)], target(60, 8)),
        entry('squat', [s(100, 3)], target(100, 5, 1)),
      ]),
    ])
    expect(weeklySummary(d, TODAY, 1)[0].rate).toBe(0.5)
  })
})

describe('muscleVolumeThisWeek', () => {
  it('記録も目標もなければ空', () => {
    expect(muscleVolumeThisWeek(data([]), TODAY)).toEqual([])
  })

  it('主働筋1・補助筋0.5で数え、status を判定する（MUSCLES の順）', () => {
    const d = data([
      session('2026-11-23', [entry('bench', [s(60, 8), s(60, 8), s(60, 8), s(60, 8), s(60, 8), s(60, 8), s(60, 8)])]),
    ])
    expect(muscleVolumeThisWeek(d, TODAY)).toEqual([
      { muscle: '胸', volume: 7, target: 10, status: 'under' },
      { muscle: '上腕三頭筋', volume: 3.5, target: 10, status: 'under' },
    ])
  })

  it('目標以上は ok、20 を超えると over', () => {
    const many = (n: number) => Array.from({ length: n }, () => s(60, 8))
    const d = data([
      session('2026-11-23', [entry('bench', many(10)), entry('squat', many(21))]),
    ])
    const r = muscleVolumeThisWeek(d, TODAY)
    expect(r.find(x => x.muscle === '胸')?.status).toBe('ok')
    expect(r.find(x => x.muscle === '大腿四頭筋')).toMatchObject({ volume: 21, status: 'over' })
  })

  it('今週の記録がなくても過去4週にあれば出る。5週前は出ない', () => {
    const recent = data([session('2026-10-26', [entry('bench', [s(60, 8)])])]) // 4週前の月曜
    expect(muscleVolumeThisWeek(recent, TODAY).map(x => x.muscle)).toEqual(['胸', '上腕三頭筋'])
    const old = data([session('2026-10-25', [entry('bench', [s(60, 8)])])]) // 5週前の日曜
    expect(muscleVolumeThisWeek(old, TODAY)).toEqual([])
  })

  it('weeklyTargets に値がある筋肉は記録がなくても出る。日曜は今週に含む', () => {
    const d = data([session('2026-11-29', [entry('squat', [s(100, 5)])])], { 腹筋: 12 })
    expect(muscleVolumeThisWeek(d, TODAY)).toEqual([
      { muscle: '大腿四頭筋', volume: 0, target: 10, status: 'under' },
      { muscle: '腹筋', volume: 0, target: 12, status: 'under' },
    ].map(x => x.muscle === '大腿四頭筋' ? { ...x, volume: 1 } : x))
  })

  it('削除済みの種目の記録が混ざっても落ちない', () => {
    const d = data([session('2026-11-23', [entry('gone', [s(60, 8)]), entry('bench', [s(60, 8)])])])
    expect(muscleVolumeThisWeek(d, TODAY)[0]).toMatchObject({ muscle: '胸', volume: 1 })
  })
})

describe('exercisesWithHistory', () => {
  it('記録がなければ空', () => {
    expect(exercisesWithHistory(data([]))).toEqual([])
  })

  it('最後に記録した日の新しい順。未完了のみ・削除済みは除く', () => {
    const d = data([
      session('2026-11-01', [entry('bench', [s(60, 8)])]),
      session('2026-11-10', [entry('squat', [s(100, 5)]), entry('gone', [s(10, 5)])]),
      session('2026-11-20', [entry('bench', [s(60, 8)]), entry('squat', [s(100, 5, 0, false)])]),
    ])
    expect(exercisesWithHistory(d).map(e => e.id)).toEqual(['bench', 'squat'])
    const d2 = data([
      session('2026-11-01', [entry('bench', [s(60, 8)])]),
      session('2026-11-10', [entry('squat', [s(100, 5)])]),
    ])
    expect(exercisesWithHistory(d2).map(e => e.id)).toEqual(['squat', 'bench'])
    const d3 = data([session('2026-11-01', [entry('bench', [s(60, 8, 0, false)])])])
    expect(exercisesWithHistory(d3)).toEqual([])
  })
})
