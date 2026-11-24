import { useEffect, useState } from 'react'
import type { AppData, Exercise } from './types'

const KEY = 'workout-app:data'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

const ex = (name: string, part: Exercise['part'], repMin: number, repMax: number, increment: number, sets = 3): Exercise => ({
  id: uid(), name, part, repMin, repMax, increment, sets,
})

export const defaultData = (): AppData => ({
  version: 1,
  restSeconds: 120,
  sessions: [],
  exercises: [
    ex('ベンチプレス', '胸', 6, 10, 2.5),
    ex('スクワット', '脚', 5, 8, 5),
    ex('デッドリフト', '背中', 3, 6, 5),
    ex('ショルダープレス', '肩', 6, 10, 2.5),
    ex('ラットプルダウン', '背中', 8, 12, 2.5),
    ex('バーベルロウ', '背中', 6, 10, 2.5),
    ex('ダンベルカール', '腕', 8, 12, 1),
    ex('ディップス', '胸', 8, 15, 2.5),
  ],
})

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultData()
    const parsed = JSON.parse(raw) as AppData
    if (parsed?.version !== 1 || !Array.isArray(parsed.exercises) || !Array.isArray(parsed.sessions)) return defaultData()
    return { ...defaultData(), ...parsed }
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
