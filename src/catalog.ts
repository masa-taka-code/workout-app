import type { BodyPart, Equipment, Exercise, Muscle } from './types'

/** 動きの型（代わりの種目の並び順に使う） */
export type MovementPattern =
  | 'horizontal_push' | 'vertical_push' | 'chest_fly'
  | 'horizontal_pull' | 'vertical_pull' | 'shoulder_extension'
  | 'squat' | 'lunge' | 'hinge' | 'hip_extension'
  | 'knee_extension' | 'knee_flexion' | 'calf'
  | 'shoulder_abduction' | 'rear_delt'
  | 'elbow_flexion' | 'elbow_extension' | 'trunk'

/** 理由の文言に使う型のラベル */
export const PATTERN_LABELS: Record<MovementPattern, string> = {
  horizontal_push: '水平押し',
  vertical_push: '頭上へ押す動き',
  chest_fly: 'フライ',
  horizontal_pull: '水平引き（ロウ）',
  vertical_pull: '上から引く動き',
  shoulder_extension: '腕を伸ばしたまま引く動き',
  squat: 'スクワット系',
  lunge: '片脚スクワット系',
  hinge: '股関節を折る動き（ヒンジ）',
  hip_extension: '股関節を伸ばす動き（ヒップスラスト）',
  knee_extension: '膝を伸ばす動き',
  knee_flexion: '膝を曲げる動き',
  calf: 'かかとを上げる動き',
  shoulder_abduction: '腕を横に上げる動き',
  rear_delt: '腕を後ろへ開く動き',
  elbow_flexion: '肘を曲げる動き（カール）',
  elbow_extension: '肘を伸ばす動き',
  trunk: '体幹の種目',
}

/**
 * カタログの種目。lengthened = 筋が伸びた位置で強い負荷がかかる種目。
 * pattern 以下は代わりの種目の並び順に使う属性（省略可。省略は「不明」扱い）。
 * loadability / stability は設計値・暫定。
 */
export interface CatalogItem extends Omit<Exercise, 'id'> {
  lengthened: boolean
  /** 動きの型 */
  pattern?: MovementPattern
  /** 多関節種目か */
  compound?: boolean
  /** 強度の出しやすさ 0〜2（2=高重量を小刻みに漸進できる多関節、0=単関節で軽い） */
  loadability?: 0 | 1 | 2
  /** 安定させる難しさ 0=軌道が決まる（マシン）、1=中、2=高い */
  stability?: 0 | 1 | 2
}

type Meta = [MovementPattern, boolean, 0 | 1 | 2, 0 | 1 | 2]

/** 種目を1行で書くための補助。sets は 3 で固定。meta = [型, 多関節か, loadability, stability] */
const c = (
  name: string, part: BodyPart, repMin: number, repMax: number, increment: number, targetRir: number,
  primary: Muscle[], secondary: Muscle[], equipment: Equipment, meta: Meta, lengthened = false,
): CatalogItem => ({
  name, part, repMin, repMax, increment, sets: 3, targetRir, primary, secondary, equipment, lengthened,
  pattern: meta[0], compound: meta[1], loadability: meta[2], stability: meta[3],
})

/** 種目カタログ。storage.ts の初期種目10個は同じ設定値で含める */
export const CATALOG: CatalogItem[] = [
  // 胸
  c('ベンチプレス', '胸', 6, 10, 2.5, 2, ['胸'], ['上腕三頭筋', '肩前部'], 'barbell', ['horizontal_push', true, 2, 1]),
  c('インクラインダンベルプレス', '胸', 8, 12, 2, 2, ['胸'], ['肩前部', '上腕三頭筋'], 'dumbbell', ['horizontal_push', true, 1, 2]),
  c('ダンベルフライ', '胸', 10, 15, 1, 1, ['胸'], [], 'dumbbell', ['chest_fly', false, 0, 2], true),
  c('ケーブルフライ', '胸', 10, 15, 2.5, 0, ['胸'], [], 'machine', ['chest_fly', false, 1, 1], true),
  c('ディップス', '胸', 6, 12, 2.5, 2, ['胸', '上腕三頭筋'], ['肩前部'], 'bodyweight', ['horizontal_push', true, 1, 2], true),
  c('ダンベルベンチプレス', '胸', 8, 12, 2, 2, ['胸'], ['上腕三頭筋', '肩前部'], 'dumbbell', ['horizontal_push', true, 1, 2]),
  c('チェストプレス', '胸', 8, 12, 2.5, 1, ['胸'], ['上腕三頭筋', '肩前部'], 'machine', ['horizontal_push', true, 2, 0]),
  // 背中
  c('ラットプルダウン', '背中', 8, 12, 2.5, 1, ['背中'], ['上腕二頭筋', '肩後部'], 'machine', ['vertical_pull', true, 2, 0]),
  c('シーテッドロウ', '背中', 8, 12, 2.5, 1, ['背中'], ['上腕二頭筋', '肩後部'], 'machine', ['horizontal_pull', true, 2, 0]),
  c('懸垂', '背中', 5, 12, 2.5, 1, ['背中'], ['上腕二頭筋', '肩後部'], 'bodyweight', ['vertical_pull', true, 1, 2], true),
  c('ワンハンドダンベルロウ', '背中', 8, 12, 2, 1, ['背中'], ['上腕二頭筋', '肩後部'], 'dumbbell', ['horizontal_pull', true, 1, 1], true),
  c('Tバーロウ', '背中', 8, 12, 2.5, 2, ['背中'], ['上腕二頭筋', '肩後部'], 'barbell', ['horizontal_pull', true, 2, 1]),
  c('プルオーバー', '背中', 10, 15, 2, 1, ['背中'], ['胸', '上腕三頭筋'], 'dumbbell', ['shoulder_extension', false, 0, 1], true),
  c('デッドリフト', '背中', 3, 6, 5, 2, ['背中', '臀筋'], ['ハムストリング'], 'barbell', ['hinge', true, 2, 2]),
  // 脚
  c('スクワット', '脚', 6, 10, 2.5, 2, ['大腿四頭筋', '臀筋'], [], 'barbell', ['squat', true, 2, 2]),
  c('ブルガリアンスクワット', '脚', 8, 12, 2, 2, ['大腿四頭筋', '臀筋'], ['ハムストリング'], 'dumbbell', ['lunge', true, 1, 2], true),
  c('レッグプレス', '脚', 8, 15, 5, 1, ['大腿四頭筋', '臀筋'], ['ハムストリング'], 'machine', ['squat', true, 2, 0]),
  c('ハックスクワット', '脚', 8, 12, 5, 1, ['大腿四頭筋'], ['臀筋'], 'machine', ['squat', true, 2, 0], true),
  c('レッグエクステンション', '脚', 10, 15, 2.5, 0, ['大腿四頭筋'], [], 'machine', ['knee_extension', false, 1, 0]),
  c('ルーマニアンデッドリフト', '脚', 6, 10, 2.5, 2, ['ハムストリング', '臀筋'], ['背中'], 'barbell', ['hinge', true, 2, 2], true),
  c('シーテッドレッグカール', '脚', 10, 15, 2.5, 0, ['ハムストリング'], [], 'machine', ['knee_flexion', false, 1, 0], true),
  c('ライイングレッグカール', '脚', 10, 15, 2.5, 0, ['ハムストリング'], [], 'machine', ['knee_flexion', false, 1, 0]),
  c('ヒップスラスト', '脚', 8, 12, 5, 1, ['臀筋'], ['ハムストリング'], 'barbell', ['hip_extension', true, 2, 1]),
  c('カーフレイズ', '脚', 10, 20, 2.5, 0, ['ふくらはぎ'], [], 'machine', ['calf', false, 1, 0], true),
  c('シーテッドカーフレイズ', '脚', 10, 20, 2.5, 0, ['ふくらはぎ'], [], 'machine', ['calf', false, 1, 0]),
  // 肩
  c('ショルダープレス', '肩', 6, 10, 2.5, 2, ['肩前部'], ['上腕三頭筋', '肩側部'], 'barbell', ['vertical_push', true, 2, 2]),
  c('ダンベルショルダープレス', '肩', 8, 12, 2, 2, ['肩前部'], ['上腕三頭筋', '肩側部'], 'dumbbell', ['vertical_push', true, 1, 2]),
  c('サイドレイズ', '肩', 10, 20, 1, 0, ['肩側部'], [], 'dumbbell', ['shoulder_abduction', false, 0, 1]),
  c('ケーブルサイドレイズ', '肩', 10, 20, 1, 0, ['肩側部'], [], 'machine', ['shoulder_abduction', false, 0, 1], true),
  c('リアデルトフライ', '肩', 12, 20, 1, 0, ['肩後部'], [], 'dumbbell', ['rear_delt', false, 0, 1]),
  c('フェイスプル', '肩', 12, 20, 2.5, 0, ['肩後部'], ['背中'], 'machine', ['rear_delt', false, 1, 1]),
  // 腕
  c('インクラインダンベルカール', '腕', 8, 15, 1, 0, ['上腕二頭筋'], [], 'dumbbell', ['elbow_flexion', false, 0, 1], true),
  c('プリーチャーカール', '腕', 8, 12, 2.5, 0, ['上腕二頭筋'], [], 'barbell', ['elbow_flexion', false, 1, 0], true),
  c('ハンマーカール', '腕', 8, 12, 1, 0, ['上腕二頭筋'], [], 'dumbbell', ['elbow_flexion', false, 0, 1]),
  c('ケーブルカール', '腕', 10, 15, 2.5, 0, ['上腕二頭筋'], [], 'machine', ['elbow_flexion', false, 1, 1]),
  c('オーバーヘッドエクステンション', '腕', 8, 15, 1, 0, ['上腕三頭筋'], [], 'dumbbell', ['elbow_extension', false, 0, 1], true),
  c('スカルクラッシャー', '腕', 8, 12, 2.5, 1, ['上腕三頭筋'], [], 'barbell', ['elbow_extension', false, 1, 1], true),
  c('ケーブルプレスダウン', '腕', 10, 15, 2.5, 0, ['上腕三頭筋'], [], 'machine', ['elbow_extension', false, 1, 0]),
  c('オーバーヘッドケーブルエクステンション', '腕', 10, 15, 2.5, 0, ['上腕三頭筋'], [], 'machine', ['elbow_extension', false, 1, 1], true),
  // 腹
  c('ケーブルクランチ', '腹', 10, 15, 2.5, 1, ['腹筋'], [], 'machine', ['trunk', false, 1, 0]),
  c('ハンギングレッグレイズ', '腹', 8, 15, 1, 1, ['腹筋'], [], 'bodyweight', ['trunk', false, 0, 2]),
  c('アブローラー', '腹', 6, 12, 1, 1, ['腹筋'], [], 'other', ['trunk', false, 0, 2], true),
]

/** lengthened と並び順用の属性を除いて Exercise 形（id なし）にする */
export function catalogToExercise(item: CatalogItem): Omit<Exercise, 'id'> {
  const { lengthened: _l, pattern: _p, compound: _c, loadability: _o, stability: _s, ...rest } = item
  void _l; void _p; void _c; void _o; void _s
  return rest
}
