import { describe, expect, it } from 'vitest'
import { NOTE_MAX, appendChip, normalizeNote } from './noteText'

describe('normalizeNote', () => {
  it('前後の空白を除く', () => {
    expect(normalizeNote('  肩に違和感 ')).toBe('肩に違和感')
    expect(normalizeNote('　全角空白　')).toBe('全角空白')
  })
  it('空・空白のみは undefined', () => {
    expect(normalizeNote('')).toBeUndefined()
    expect(normalizeNote('   ')).toBeUndefined()
  })
  it('中の空白は残す', () => {
    expect(normalizeNote('a b')).toBe('a b')
  })
})

describe('appendChip', () => {
  it('空ならそのまま入る', () => {
    expect(appendChip('', '痛み')).toBe('痛み')
    expect(appendChip('  ', '痛み')).toBe('痛み')
  })
  it('文字があれば「、」で区切る', () => {
    expect(appendChip('肩', '違和感')).toBe('肩、違和感')
    expect(appendChip('痛み、違和感', '余裕あり')).toBe('痛み、違和感、余裕あり')
  })
  it('上限を超えるなら変えない', () => {
    const long = 'あ'.repeat(NOTE_MAX - 1)
    expect(appendChip(long, '痛み')).toBe(long)
  })
})
