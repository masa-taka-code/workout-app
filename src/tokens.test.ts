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
]
const DARK_PAIRS: [string, string][] = [
  ['text', 'bg'], ['muted', 'surface'], ['accent', 'surface'],
  ['good-text', 'good-weak'], ['warn-text', 'warn-weak'], ['on-accent', 'accent'],
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
