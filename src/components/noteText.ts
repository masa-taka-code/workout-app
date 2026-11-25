/** セットメモの整形（純粋関数） */

export const NOTE_MAX = 200
export const NOTE_CHIPS = ['痛み', '違和感', 'フォーム崩れ', '余裕あり'] as const

/** 確定時の整形：前後の空白を除き、空なら undefined */
export function normalizeNote(text: string): string | undefined {
  const t = text.trim()
  return t === '' ? undefined : t
}

/** チップの追記：既に文字があれば「、」で区切る。上限を超える場合は追記しない */
export function appendChip(text: string, chip: string): string {
  const base = text.trim()
  const next = base === '' ? chip : `${base}、${chip}`
  return next.length > NOTE_MAX ? text : next
}
