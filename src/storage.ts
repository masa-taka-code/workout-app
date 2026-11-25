import { useEffect, useState } from 'react'
import type { AppData, Exercise, Muscle } from './types'

const KEY = 'workout-app:data'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

type Spec = Omit<Exercise, 'id'>

const ex = (s: Spec): Exercise => ({ id: uid(), ...s })

/** 初期登録の種目。伸びた位置で負荷がかかる種目を多めに入れている */
const DEFAULT_EXERCISES: Spec[] = [
  { name: 'ベンチプレス', part: '胸', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2, primary: ['胸'], secondary: ['上腕三頭筋', '肩前部'] },
  { name: 'スクワット', part: '脚', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2, primary: ['大腿四頭筋', '臀筋'], secondary: [] },
  { name: 'ルーマニアンデッドリフト', part: '脚', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2, primary: ['ハムストリング', '臀筋'], secondary: ['背中'] },
  { name: 'ショルダープレス', part: '肩', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2, primary: ['肩前部'], secondary: ['上腕三頭筋', '肩側部'] },
  { name: 'ラットプルダウン', part: '背中', repMin: 8, repMax: 12, increment: 2.5, sets: 3, targetRir: 1, primary: ['背中'], secondary: ['上腕二頭筋', '肩後部'] },
  { name: 'シーテッドロウ', part: '背中', repMin: 8, repMax: 12, increment: 2.5, sets: 3, targetRir: 1, primary: ['背中'], secondary: ['上腕二頭筋', '肩後部'] },
  { name: 'サイドレイズ', part: '肩', repMin: 10, repMax: 20, increment: 1, sets: 3, targetRir: 0, primary: ['肩側部'], secondary: [] },
  { name: 'インクラインダンベルカール', part: '腕', repMin: 8, repMax: 15, increment: 1, sets: 3, targetRir: 0, primary: ['上腕二頭筋'], secondary: [] },
  { name: 'オーバーヘッドエクステンション', part: '腕', repMin: 8, repMax: 15, increment: 1, sets: 3, targetRir: 0, primary: ['上腕三頭筋'], secondary: [] },
  { name: 'カーフレイズ', part: '脚', repMin: 10, repMax: 20, increment: 2.5, sets: 3, targetRir: 0, primary: ['ふくらはぎ'], secondary: [] },
]

export const defaultData = (): AppData => ({
  version: 1,
  restSeconds: 120,
  sessions: [],
  exercises: DEFAULT_EXERCISES.map(ex),
  weeklyTargets: {},
})

/** 古い形式の種目（targetRir・筋肉の指定なし）を補う */
function normalizeExercise(e: Partial<Exercise> & { id: string; name: string }): Exercise {
  const fallbackMuscle: Record<string, Muscle> = { 胸: '胸', 背中: '背中', 脚: '大腿四頭筋', 肩: '肩前部', 腕: '上腕二頭筋', 腹: '腹筋' }
  return {
    part: 'その他', repMin: 8, repMax: 12, increment: 2.5, sets: 3, targetRir: 2,
    primary: e.part && fallbackMuscle[e.part] ? [fallbackMuscle[e.part]] : [],
    secondary: [],
    ...e,
  }
}

/** 読み込んだ JSON を AppData に整える。形式が違えば undefined（読み込みと JSON インポートで共用） */
export function normalizeData(parsed: unknown): AppData | undefined {
  if (!isAppData(parsed)) return undefined
  return { ...defaultData(), ...parsed, exercises: parsed.exercises.map(normalizeExercise) }
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultData()
    return normalizeData(JSON.parse(raw)) ?? defaultData()
  } catch {
    return defaultData()
  }
}

export function useAppData() {
  const [data, setData] = useState<AppData>(loadData)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
      /* 保存できない環境（プライベートモード等）では無視 */
    }
  }, [data])
  return [data, setData] as const
}

export function isAppData(v: unknown): v is AppData {
  const d = v as AppData
  return !!d && d.version === 1 && Array.isArray(d.exercises) && Array.isArray(d.sessions)
}
