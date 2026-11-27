/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// index.css を読んで、色の変数をライト・ダークごとに取り出す
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

function parseVars(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toLowerCase()
  return out
}

const rootBlock = css.match(/:root\s*\{([^}]*)\}/)![1]
const darkBlock = css.match(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/)![1]
const light = parseVars(rootBlock)
const dark = { ...light, ...parseVars(darkBlock) }

function lum(hex: string): number {
  const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = ch.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const LIGHT_PAIRS: [string, string][] = [
  ['text', 'bg'], ['text', 'surface'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'accent-weak'], ['muted', 'surface-2'],
  ['accent', 'bg'], ['accent', 'surface'], ['accent', 'accent-weak'],
  ['good-text', 'good-weak'], ['warn-text', 'warn-weak'], ['on-accent', 'accent'],
  ['bad-text', 'bad-weak'], ['bad-text', 'surface'],
  ['on-select', 'select-bg'], ['on-good', 'good-solid'], ['pr-text', 'pr-weak'], ['info-text', 'info-weak'],
  ['on-bad', 'bad'], ['accent-text', 'accent-weak'], ['good-solid', 'surface'],
]
const DARK_PAIRS: [string, string][] = [
  ['text', 'bg'], ['muted', 'surface'], ['accent', 'surface'],
  ['good-text', 'good-weak'], ['warn-text', 'warn-weak'], ['on-accent', 'accent'],
  ['bad-text', 'bad-weak'], ['bad-text', 'surface'],
  ['on-select', 'select-bg'], ['on-good', 'good-solid'], ['pr-text', 'pr-weak'], ['info-text', 'info-weak'],
  ['on-bad', 'bad'], ['accent-text', 'accent-weak'], ['good-solid', 'surface'],
]
// 部品の枠・アイコンなど文字以外は 3:1（WCAG 1.4.11）
const UI_PAIRS: [string, string][] = [
  ['control-border', 'surface'], ['control-border', 'bg'], ['accent', 'surface'], ['good-solid', 'surface'],
]

describe('デザイントークンのコントラスト（WCAG AA 4.5:1）', () => {
  for (const [name, vars, pairs] of [['ライト', light, LIGHT_PAIRS], ['ダーク', dark, DARK_PAIRS]] as const) {
    for (const [fg, bg] of pairs) {
      it(`${name}: ${fg} / ${bg}`, () => {
        expect(vars[fg], `--${fg}`).toBeDefined()
        expect(vars[bg], `--${bg}`).toBeDefined()
        expect(contrast(vars[fg], vars[bg])).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

describe('デザイントークンのコントラスト（部品の枠 3:1）', () => {
  for (const [name, vars] of [['ライト', light], ['ダーク', dark]] as const) {
    for (const [fg, bg] of UI_PAIRS) {
      it(`${name}: ${fg} / ${bg}`, () => {
        expect(vars[fg], `--${fg}`).toBeDefined()
        expect(contrast(vars[fg], vars[bg])).toBeGreaterThanOrEqual(3)
      })
    }
  }
})

// ダークの面・ボタン・選択の新しい決まり（設計値）
describe('ダークの追加トークン', () => {
  const ratio = (a: string, b: string) => contrast(dark[a], dark[b])
  const TEXT_PAIRS: [string, string, number][] = [
    ['text', 'surface-2', 4.5], ['text', 'surface-3', 4.5], ['text', 'control-bg', 4.5], ['text', 'control-bg-bar', 4.5],
    ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'surface-2', 4.5], ['muted', 'control-bg', 4.5],
    ['muted-bar', 'surface-3', 4.5], ['muted-bar', 'control-bg-bar', 4.5],
    ['text', 'input-bg', 4.5], ['on-accent', 'accent-pressed', 4.5], ['accent-text', 'surface-3', 4.5],
    ['on-select', 'select-bg', 4.5], ['accent', 'surface-3', 3],
  ]
  for (const [fg, bg, min] of TEXT_PAIRS) {
    it(`文字 ${fg} / ${bg} は ${min}:1 以上`, () => {
      expect(dark[fg], `--${fg}`).toBeDefined()
      expect(dark[bg], `--${bg}`).toBeDefined()
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min)
    })
  }
  it('補足色は主な面（背景・カード・内側の面）の上で 7:1 以上、固定バー上の補足色も 7:1 以上', () => {
    for (const bg of ['bg', 'surface', 'surface-2']) expect(ratio('muted', bg)).toBeGreaterThanOrEqual(7)
    expect(ratio('muted-bar', 'surface-3')).toBeGreaterThanOrEqual(7)
  })
  it('部品の枠は、置かれる面の上で 3:1 以上', () => {
    for (const bg of ['bg', 'surface', 'surface-2', 'surface-3']) {
      expect(ratio('control-border', bg), bg).toBeGreaterThanOrEqual(3)
    }
  })
  it('選んだものの枠は、面の上で 3:1 以上', () => {
    for (const bg of ['surface', 'surface-2', 'surface-3', 'control-bg-bar']) expect(ratio('select-border', bg), bg).toBeGreaterThanOrEqual(3)
  })
  it('選んだものの塗りは、完了ボタンの塗りより暗い（輝度が 1/4 以下）', () => {
    expect(lum(dark['select-bg'])).toBeLessThanOrEqual(lum(dark['accent']) / 4)
  })
  it('押せるボタンの面はカードより 1.3:1 以上明るく、内側の面や固定バーの中でも周りより暗くならない', () => {
    expect(ratio('control-bg', 'surface')).toBeGreaterThanOrEqual(1.3)
    expect(lum(dark['control-bg'])).toBeGreaterThan(lum(dark['surface-2']))
    expect(lum(dark['control-bg-bar'])).toBeGreaterThan(lum(dark['surface-3']))
  })
  it('入力欄の面はカードより暗い', () => {
    expect(lum(dark['input-bg'])).toBeLessThan(lum(dark.surface))
  })
  it('面の段差：背景 < カード < 内側の面 < 固定バー', () => {
    const order = ['bg', 'surface', 'surface-2', 'surface-3']
    for (let i = 1; i < order.length; i++) expect(lum(dark[order[i]])).toBeGreaterThan(lum(dark[order[i - 1]]))
    expect(ratio('surface-3', 'surface')).toBeGreaterThanOrEqual(1.3)
  })
  it('分析の棒：達成と不足の輝度差が 1.5:1 以上、どちらも内側の面の上で 3:1 以上', () => {
    expect(ratio('bar-good', 'bar-warn')).toBeGreaterThanOrEqual(1.5)
    expect(ratio('bar-good', 'surface-2')).toBeGreaterThanOrEqual(3)
    expect(ratio('bar-warn', 'surface-2')).toBeGreaterThanOrEqual(3)
  })
  it('グラフの色は面の上で 3:1 以上、筋肉マップの体の色は内側の面（ツールパネル）より明るい面', () => {
    expect(ratio('data', 'surface')).toBeGreaterThanOrEqual(3)
    expect(ratio('data', 'surface-2')).toBeGreaterThanOrEqual(3)
    expect(dark['map-body']).toBe(dark['surface-3'])
  })
})

describe('映像の上の状態表示（白文字 / --status-*-bg、ライト・ダーク共通）', () => {
  for (const [name, vars] of [['ライト', light], ['ダーク', dark]] as const) {
    for (const bg of ['status-ok-bg', 'status-caution-bg', 'status-ng-bg']) {
      it(`${name}: 白 / ${bg}`, () => {
        expect(vars[bg], `--${bg}`).toBeDefined()
        expect(contrast('#ffffff', vars[bg])).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

// 筋肉マップの色の差（WCAG 1.4.11 の 3:1、段階どうしは 1.5:1 を目標）
describe('筋肉マップの色の差', () => {
  for (const [name, v, step] of [['ライト', light, 1.5], ['ダーク', dark, 1.45]] as const) {
    it(`${name}: 地 → 補助 → 主働が 3:1 以上`, () => {
      expect(contrast(v['map-body'], v['map-secondary'])).toBeGreaterThanOrEqual(3)
      expect(contrast(v['map-secondary'], v['map-primary'])).toBeGreaterThanOrEqual(3)
    })
    it(`${name}: 週ボリュームの4段階（地と最小段階 3:1、隣同士 ${step}:1）`, () => {
      const ramp = ['map-body', 'map-l1', 'map-l2', 'map-l3', 'map-l4']
      expect(contrast(v[ramp[0]], v[ramp[1]])).toBeGreaterThanOrEqual(3)
      for (let i = 1; i < ramp.length - 1; i++) {
        expect(contrast(v[ramp[i]], v[ramp[i + 1]])).toBeGreaterThanOrEqual(step)
      }
    })
  }
})
