import type { BodyPart, Equipment, Exercise, Muscle } from './types'

/** カタログの種目。lengthened = 筋が伸びた位置で強い負荷がかかる種目 */
export interface CatalogItem extends Omit<Exercise, 'id'> {
  lengthened: boolean
}

/** 種目を1行で書くための補助。sets は 3 で固定 */
const c = (
  name: string, part: BodyPart, repMin: number, repMax: number, increment: number, targetRir: number,
  primary: Muscle[], secondary: Muscle[], equipment: Equipment, lengthened = false,
): CatalogItem => ({ name, part, repMin, repMax, increment, sets: 3, targetRir, primary, secondary, equipment, lengthened })

/** 種目カタログ。storage.ts の初期種目10個は同じ設定値で含める */
export const CATALOG: CatalogItem[] = [
  // 胸
  c('ベンチプレス', '胸', 6, 10, 2.5, 2, ['胸'], ['上腕三頭筋', '肩前部'], 'barbell'),
  c('インクラインダンベルプレス', '胸', 8, 12, 2, 2, ['胸'], ['肩前部', '上腕三頭筋'], 'dumbbell'),
  c('ダンベルフライ', '胸', 10, 15, 1, 1, ['胸'], [], 'dumbbell', true),
  c('ケーブルフライ', '胸', 10, 15, 2.5, 0, ['胸'], [], 'machine', true),
  c('ディップス', '胸', 6, 12, 2.5, 2, ['胸', '上腕三頭筋'], ['肩前部'], 'bodyweight', true),
  c('チェストプレス', '胸', 8, 12, 2.5, 1, ['胸'], ['上腕三頭筋', '肩前部'], 'machine'),
  // 背中
  c('ラットプルダウン', '背中', 8, 12, 2.5, 1, ['背中'], ['上腕二頭筋', '肩後部'], 'machine'),
  c('シーテッドロウ', '背中', 8, 12, 2.5, 1, ['背中'], ['上腕二頭筋', '肩後部'], 'machine'),
  c('懸垂', '背中', 5, 12, 2.5, 1, ['背中'], ['上腕二頭筋', '肩後部'], 'bodyweight', true),
  c('ワンハンドダンベルロウ', '背中', 8, 12, 2, 1, ['背中'], ['上腕二頭筋', '肩後部'], 'dumbbell', true),
  c('Tバーロウ', '背中', 8, 12, 2.5, 2, ['背中'], ['上腕二頭筋', '肩後部'], 'barbell'),
  c('プルオーバー', '背中', 10, 15, 2, 1, ['背中'], ['胸', '上腕三頭筋'], 'dumbbell', true),
  c('デッドリフト', '背中', 3, 6, 5, 2, ['背中', '臀筋'], ['ハムストリング'], 'barbell'),
  // 脚
  c('スクワット', '脚', 6, 10, 2.5, 2, ['大腿四頭筋', '臀筋'], [], 'barbell'),
  c('ブルガリアンスクワット', '脚', 8, 12, 2, 2, ['大腿四頭筋', '臀筋'], ['ハムストリング'], 'dumbbell', true),
  c('レッグプレス', '脚', 8, 15, 5, 1, ['大腿四頭筋', '臀筋'], ['ハムストリング'], 'machine'),
  c('ハックスクワット', '脚', 8, 12, 5, 1, ['大腿四頭筋'], ['臀筋'], 'machine', true),
  c('レッグエクステンション', '脚', 10, 15, 2.5, 0, ['大腿四頭筋'], [], 'machine'),
  c('ルーマニアンデッドリフト', '脚', 6, 10, 2.5, 2, ['ハムストリング', '臀筋'], ['背中'], 'barbell', true),
  c('シーテッドレッグカール', '脚', 10, 15, 2.5, 0, ['ハムストリング'], [], 'machine', true),
  c('ライイングレッグカール', '脚', 10, 15, 2.5, 0, ['ハムストリング'], [], 'machine'),
  c('ヒップスラスト', '脚', 8, 12, 5, 1, ['臀筋'], ['ハムストリング'], 'barbell'),
  c('カーフレイズ', '脚', 10, 20, 2.5, 0, ['ふくらはぎ'], [], 'machine'),
  c('シーテッドカーフレイズ', '脚', 10, 20, 2.5, 0, ['ふくらはぎ'], [], 'machine', true),
  // 肩
  c('ショルダープレス', '肩', 6, 10, 2.5, 2, ['肩前部'], ['上腕三頭筋', '肩側部'], 'barbell'),
  c('ダンベルショルダープレス', '肩', 8, 12, 2, 2, ['肩前部'], ['上腕三頭筋', '肩側部'], 'dumbbell'),
  c('サイドレイズ', '肩', 10, 20, 1, 0, ['肩側部'], [], 'dumbbell'),
  c('ケーブルサイドレイズ', '肩', 10, 20, 1, 0, ['肩側部'], [], 'machine', true),
  c('リアデルトフライ', '肩', 12, 20, 1, 0, ['肩後部'], [], 'dumbbell'),
  c('フェイスプル', '肩', 12, 20, 2.5, 0, ['肩後部'], ['背中'], 'machine'),
  // 腕
  c('インクラインダンベルカール', '腕', 8, 15, 1, 0, ['上腕二頭筋'], [], 'dumbbell', true),
  c('プリーチャーカール', '腕', 8, 12, 2.5, 0, ['上腕二頭筋'], [], 'barbell', true),
  c('ハンマーカール', '腕', 8, 12, 1, 0, ['上腕二頭筋'], [], 'dumbbell'),
  c('ケーブルカール', '腕', 10, 15, 2.5, 0, ['上腕二頭筋'], [], 'machine'),
  c('オーバーヘッドエクステンション', '腕', 8, 15, 1, 0, ['上腕三頭筋'], [], 'dumbbell', true),
  c('スカルクラッシャー', '腕', 8, 12, 2.5, 1, ['上腕三頭筋'], [], 'barbell', true),
  c('ケーブルプレスダウン', '腕', 10, 15, 2.5, 0, ['上腕三頭筋'], [], 'machine'),
  c('オーバーヘッドケーブルエクステンション', '腕', 10, 15, 2.5, 0, ['上腕三頭筋'], [], 'machine', true),
  // 腹
  c('ケーブルクランチ', '腹', 10, 15, 2.5, 1, ['腹筋'], [], 'machine'),
  c('ハンギングレッグレイズ', '腹', 8, 15, 1, 1, ['腹筋'], [], 'bodyweight'),
  c('アブローラー', '腹', 6, 12, 1, 1, ['腹筋'], [], 'other', true),
]

/** lengthened を除いて Exercise 形（id なし）にする */
export function catalogToExercise(item: CatalogItem): Omit<Exercise, 'id'> {
  const { lengthened: _lengthened, ...rest } = item
  void _lengthened
  return rest
}
