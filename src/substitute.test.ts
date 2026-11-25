import { describe, expect, it } from 'vitest'
import type { AppData, Entry, Exercise, Session } from './types'
import { BODY_PARTS } from './types'
import { CATALOG } from './catalog'
import type { CatalogItem } from './catalog'
import { defaultData } from './storage'
import { rotationHint, substitutes } from './substitute'

const mk = (name: string, primary: Exercise['primary'], id = name): Exercise => ({
  id, name, part: '胸', repMin: 8, repMax: 12, increment: 2.5, sets: 3, targetRir: 1, primary, secondary: [],
})
const cat = (name: string, primary: CatalogItem['primary'], lengthened = false): CatalogItem => {
  const { id: _id, ...rest } = mk(name, primary)
  void _id
  return { ...rest, lengthened }
}

describe('substitutes', () => {
  const ex = mk('ベンチ', ['胸'])

  it('主働筋が重ならない種目は除く', () => {
    const r = substitutes(ex, [cat('スクワット', ['大腿四頭筋']), cat('フライ', ['胸'])], [])
    expect(r.map(x => x.item.name)).toEqual(['フライ'])
  })

  it('完全一致が先、同順位は伸張位が先、さらに名前順', () => {
    const catalog = [
      cat('ディップス', ['胸', '上腕三頭筋'], true),
      cat('いいプレス', ['胸']),
      cat('あプレス', ['胸']),
      cat('フライ', ['胸'], true),
    ]
    const r = substitutes(ex, catalog, [])
    expect(r.map(x => x.item.name)).toEqual(['フライ', 'あプレス', 'いいプレス', 'ディップス'])
    expect(r[0].reason).toBe('同じ主働筋（胸）・伸びた位置で負荷')
    expect(r[1].reason).toBe('同じ主働筋（胸）')
    expect(r[3].reason).toBe('主働筋が一部同じ（胸）・伸びた位置で負荷')
  })

  it('owned とカタログの同名は owned 側を使い、自分自身と同名は除く', () => {
    const own = mk('フライ', ['胸'], 'own1')
    const r = substitutes(ex, [cat('フライ', ['胸'], true), cat('ベンチ', ['胸'])], [ex, own])
    expect(r).toHaveLength(1)
    expect(r[0].item).toBe(own)
  })

  it('owned の種目はカタログに同名があればその伸張位を使う', () => {
    const own = mk('フライ', ['胸'], 'own1')
    const r = substitutes(ex, [cat('フライ', ['胸'], true), cat('あ', ['胸'])], [own])
    expect(r.map(x => x.item.name)).toEqual(['フライ', 'あ'])
  })

  it('最大5件', () => {
    const catalog = Array.from({ length: 8 }, (_, i) => cat(`種目${i}`, ['胸']))
    expect(substitutes(ex, catalog, [])).toHaveLength(5)
  })
})

describe('rotationHint', () => {
  const ex = mk('ベンチ', ['胸'])
  const entry = (weight: number, joint?: boolean): Entry => ({
    exerciseId: ex.id,
    sets: [{ weight, reps: 10, done: true, rir: 1 }],
    feedback: joint === undefined ? undefined : { joint },
  })
  const session = (date: string, e: Entry): Session => ({ id: date, date, entries: [e] })
  const data = (sessions: Session[]): AppData => ({ ...defaultData(), sessions })
  const today = '2026-03-01'

  it('直近2回のどちらかに関節の痛みがあれば joint', () => {
    const d = data([session('2026-02-10', entry(50, false)), session('2026-02-17', entry(50, true)), session('2026-02-24', entry(50))])
    expect(rotationHint(ex, d, today)?.kind).toBe('joint')
  })

  it('3回前の痛みは対象外', () => {
    const d = data([session('2026-02-03', entry(50, true)), session('2026-02-10', entry(50)), session('2026-02-17', entry(50)), session('2026-02-24', entry(50))])
    expect(rotationHint(ex, d, today)?.kind).not.toBe('joint')
  })

  it('6週以上続いて直近3回が自己ベストを更新していなければ stall', () => {
    const d = data([
      session('2026-01-05', entry(60)),
      session('2026-02-03', entry(50)),
      session('2026-02-10', entry(50)),
      session('2026-02-24', entry(50)),
    ])
    expect(rotationHint(ex, d, today)?.kind).toBe('stall')
  })

  it('6週未満なら undefined', () => {
    const d = data([
      session('2026-02-03', entry(60)),
      session('2026-02-10', entry(50)),
      session('2026-02-17', entry(50)),
      session('2026-02-24', entry(50)),
    ])
    expect(rotationHint(ex, d, today)).toBeUndefined()
  })

  it('直近で自己ベストを更新していれば undefined', () => {
    const d = data([
      session('2026-01-05', entry(50)),
      session('2026-02-03', entry(50)),
      session('2026-02-10', entry(50)),
      session('2026-02-24', entry(55)),
    ])
    expect(rotationHint(ex, d, today)).toBeUndefined()
  })

  it('記録がなければ undefined', () => {
    expect(rotationHint(ex, data([]), today)).toBeUndefined()
  })
})

describe('CATALOG', () => {
  it('名前が重複しない', () => {
    expect(new Set(CATALOG.map(c => c.name)).size).toBe(CATALOG.length)
  })
  it('primary が1つ以上、repMin < repMax', () => {
    for (const c of CATALOG) {
      expect(c.primary.length, c.name).toBeGreaterThan(0)
      expect(c.repMin, c.name).toBeLessThan(c.repMax)
    }
  })
  it('胸・背中・脚・肩・腕・腹に3種目以上', () => {
    for (const part of BODY_PARTS.filter(p => p !== 'その他')) {
      expect(CATALOG.filter(c => c.part === part).length, part).toBeGreaterThanOrEqual(3)
    }
  })
  it('初期種目10個が同じ設定値で含まれる', () => {
    for (const e of defaultData().exercises) {
      const { id: _id, ...spec } = e
      void _id
      const { lengthened: _l, ...found } = CATALOG.find(c => c.name === e.name) ?? ({} as CatalogItem)
      void _l
      expect(found, e.name).toEqual(spec)
    }
  })
})
