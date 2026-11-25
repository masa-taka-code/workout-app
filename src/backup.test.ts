import { describe, expect, it } from 'vitest'
import { exportFileName, parseBackup, serialize } from './backup'
import { defaultData } from './storage'
import type { AppData } from './types'

const withSessions = (): AppData => ({
  ...defaultData(),
  sessions: [
    { id: 'b', date: '2026-11-20', entries: [] },
    { id: 'a', date: '2026-11-10', entries: [] },
    { id: 'c', date: '2026-11-25', entries: [] },
  ],
})

describe('backup', () => {
  it('ファイル名に日付が入る', () => {
    expect(exportFileName('2026-11-25')).toBe('workout-log-2026-11-25.json')
  })

  it('整形済み JSON（2スペース）にする', () => {
    expect(serialize(defaultData())).toContain('\n  "version": 1')
  })

  it('正常なバックアップを読み込み、概要を返す', () => {
    const r = parseBackup(serialize(withSessions()))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.summary.sessions).toBe(3)
    expect(r.summary.exercises).toBe(defaultData().exercises.length)
    expect(r.summary.from).toBe('2026-11-10')
    expect(r.summary.to).toBe('2026-11-25')
  })

  it('記録が0件なら from/to は未定義', () => {
    const r = parseBackup(serialize(defaultData()))
    expect(r.ok && r.summary.from).toBeUndefined()
    expect(r.ok && r.summary.to).toBeUndefined()
  })

  it('壊れた JSON はエラー', () => {
    expect(parseBackup('{oops')).toEqual({
      ok: false,
      error: 'ファイルを読み込めませんでした（JSON形式ではありません）',
    })
  })

  it('別形式の JSON はエラー', () => {
    const msg = 'このアプリのバックアップではないようです'
    expect(parseBackup('{"foo":1}')).toEqual({ ok: false, error: msg })
    expect(parseBackup('[]')).toEqual({ ok: false, error: msg })
    expect(parseBackup('null')).toEqual({ ok: false, error: msg })
  })

  it('旧形式の種目でも補われる', () => {
    const old = {
      version: 1,
      restSeconds: 90,
      sessions: [],
      exercises: [{ id: 'x', name: 'ベンチ', part: '胸', repMin: 5, repMax: 8, increment: 2.5, sets: 3 }],
    }
    const r = parseBackup(JSON.stringify(old))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const e = r.data.exercises[0]
    expect(e.targetRir).toBe(2)
    expect(e.primary).toEqual(['胸'])
    expect(e.secondary).toEqual([])
    expect(r.data.weeklyTargets).toEqual({})
    expect(r.data.restSeconds).toBe(90)
  })

  it('書き出して読み込むと同じ内容に戻る', () => {
    const data = withSessions()
    const r = parseBackup(serialize(data))
    expect(r.ok && r.data).toEqual(data)
  })
})
