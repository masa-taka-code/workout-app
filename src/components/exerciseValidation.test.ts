import { describe, expect, it } from 'vitest'
import { cycleMuscle, newDraft, normalizeDraft, validateExercise } from './exerciseValidation'
import type { ExerciseDraft } from './exerciseValidation'

const ok = (): ExerciseDraft => ({ ...newDraft(), name: 'ベンチプレス', primary: ['胸'], secondary: ['上腕三頭筋'] })

describe('validateExercise', () => {
  it('正しい入力ならエラーなし', () => {
    expect(validateExercise(ok(), [])).toEqual({})
  })
  it('名前が空・空白だけならエラー', () => {
    expect(validateExercise({ ...ok(), name: '   ' }, []).name).toBeTruthy()
  })
  it('同名はエラー（前後の空白は無視）', () => {
    expect(validateExercise({ ...ok(), name: ' スクワット ' }, [{ name: 'スクワット' }]).name).toBeTruthy()
    expect(validateExercise({ ...ok(), name: 'スクワット' }, [{ name: 'デッドリフト' }]).name).toBeUndefined()
  })
  it('レップ範囲の境界', () => {
    expect(validateExercise({ ...ok(), repMin: 1, repMax: 2 }, [])).toEqual({})
    expect(validateExercise({ ...ok(), repMin: 49, repMax: 50 }, [])).toEqual({})
    expect(validateExercise({ ...ok(), repMin: 0, repMax: 10 }, []).rep).toBeTruthy()
    expect(validateExercise({ ...ok(), repMin: 5, repMax: 51 }, []).rep).toBeTruthy()
    expect(validateExercise({ ...ok(), repMin: 10, repMax: 10 }, []).rep).toBeTruthy()
    expect(validateExercise({ ...ok(), repMin: 12, repMax: 8 }, []).rep).toBeTruthy()
    expect(validateExercise({ ...ok(), repMin: 6.5, repMax: 10 }, []).rep).toBeTruthy()
  })
  it('刻みは0より大きい', () => {
    expect(validateExercise({ ...ok(), increment: 0 }, []).increment).toBeTruthy()
    expect(validateExercise({ ...ok(), increment: -1 }, []).increment).toBeTruthy()
    expect(validateExercise({ ...ok(), increment: 1.25 }, [])).toEqual({})
  })
  it('セット数は1〜10', () => {
    expect(validateExercise({ ...ok(), sets: 0 }, []).sets).toBeTruthy()
    expect(validateExercise({ ...ok(), sets: 11 }, []).sets).toBeTruthy()
    expect(validateExercise({ ...ok(), sets: 10 }, [])).toEqual({})
  })
  it('目標RIRは0〜4', () => {
    expect(validateExercise({ ...ok(), targetRir: -1 }, []).targetRir).toBeTruthy()
    expect(validateExercise({ ...ok(), targetRir: 5 }, []).targetRir).toBeTruthy()
    expect(validateExercise({ ...ok(), targetRir: 0 }, [])).toEqual({})
  })
  it('主働筋は1つ以上必須、補助筋は空でもよい', () => {
    expect(validateExercise({ ...ok(), primary: [] }, []).primary).toBeTruthy()
    expect(validateExercise({ ...ok(), secondary: [] }, [])).toEqual({})
  })
  it('同じ筋肉を主と補助の両方に入れるとエラー', () => {
    expect(validateExercise({ ...ok(), primary: ['胸'], secondary: ['胸'] }, []).secondary).toBeTruthy()
  })
})

describe('newDraft', () => {
  it('器具の初期値はバーベル', () => {
    expect(newDraft().equipment).toBe('barbell')
  })
  it('器具が未設定でも検証は通る', () => {
    expect(validateExercise({ ...ok(), equipment: undefined }, [])).toEqual({})
  })
})

describe('cycleMuscle', () => {
  it('なし → 主 → 補助 → なし', () => {
    let d = newDraft()
    d = cycleMuscle(d, '胸')
    expect(d.primary).toEqual(['胸'])
    d = cycleMuscle(d, '胸')
    expect(d.primary).toEqual([])
    expect(d.secondary).toEqual(['胸'])
    d = cycleMuscle(d, '胸')
    expect(d.secondary).toEqual([])
  })
})

describe('normalizeDraft', () => {
  it('名前の空白を除き、筋肉を MUSCLES の順に並べる', () => {
    const d = normalizeDraft({ ...ok(), name: ' ベンチ ', primary: ['肩前部', '胸'] })
    expect(d.name).toBe('ベンチ')
    expect(d.primary).toEqual(['胸', '肩前部'])
  })
})
