import { useEffect, useState } from 'react'
import type { AppData, Entry, Exercise, Muscle, Session, SetLog } from './types'
import { MUSCLES } from './types'
import { WEEKLY_MAX, WEEKLY_MIN } from './logic'

const KEY = 'workout-app:data'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

type Spec = Omit<Exercise, 'id'>

const ex = (s: Spec): Exercise => ({ id: uid(), ...s })

/** 初期登録の種目。伸びた位置で負荷がかかる種目を多めに入れている */
const DEFAULT_EXERCISES: Spec[] = [
  { name: 'ベンチプレス', part: '胸', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2, primary: ['胸'], secondary: ['上腕三頭筋', '肩前部'], equipment: 'barbell' },
  { name: 'スクワット', part: '脚', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2, primary: ['大腿四頭筋', '臀筋'], secondary: [], equipment: 'barbell' },
  { name: 'ルーマニアンデッドリフト', part: '脚', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2, primary: ['ハムストリング', '臀筋'], secondary: ['背中'], equipment: 'barbell' },
  { name: 'ショルダープレス', part: '肩', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2, primary: ['肩前部'], secondary: ['上腕三頭筋', '肩側部'], equipment: 'barbell' },
  { name: 'ラットプルダウン', part: '背中', repMin: 8, repMax: 12, increment: 2.5, sets: 3, targetRir: 1, primary: ['背中'], secondary: ['上腕二頭筋', '肩後部'], equipment: 'machine' },
  { name: 'シーテッドロウ', part: '背中', repMin: 8, repMax: 12, increment: 2.5, sets: 3, targetRir: 1, primary: ['背中'], secondary: ['上腕二頭筋', '肩後部'], equipment: 'machine' },
  { name: 'サイドレイズ', part: '肩', repMin: 10, repMax: 20, increment: 1, sets: 3, targetRir: 0, primary: ['肩側部'], secondary: [], equipment: 'dumbbell' },
  { name: 'インクラインダンベルカール', part: '腕', repMin: 8, repMax: 15, increment: 1, sets: 3, targetRir: 0, primary: ['上腕二頭筋'], secondary: [], equipment: 'dumbbell' },
  { name: 'オーバーヘッドエクステンション', part: '腕', repMin: 8, repMax: 15, increment: 1, sets: 3, targetRir: 0, primary: ['上腕三頭筋'], secondary: [], equipment: 'dumbbell' },
  { name: 'カーフレイズ', part: '脚', repMin: 10, repMax: 20, increment: 2.5, sets: 3, targetRir: 0, primary: ['ふくらはぎ'], secondary: [], equipment: 'machine' },
]

export const defaultData = (): AppData => ({
  version: 1,
  restSeconds: 120,
  sessions: [],
  exercises: DEFAULT_EXERCISES.map(ex),
  weeklyTargets: {},
})

const isMuscle = (v: unknown): v is Muscle => typeof v === 'string' && (MUSCLES as string[]).includes(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 古い形式・壊れた形式の種目を補う。壊れた値は既定値に戻す */
function normalizeExercise(e: Partial<Exercise> & { id: string; name: string }): Exercise {
  const fallbackMuscle: Record<string, Muscle> = { 胸: '胸', 背中: '背中', 脚: '大腿四頭筋', 肩: '肩前部', 腕: '上腕二頭筋', 腹: '腹筋' }
  const raw: Record<string, unknown> = e
  const part = typeof e.part === 'string' ? e.part : 'その他'
  const muscles = (v: unknown): Muscle[] => (Array.isArray(v) ? v.filter(isMuscle) : [])
  let primary = muscles(raw.primary)
  if (primary.length === 0) primary = fallbackMuscle[part] ? [fallbackMuscle[part]] : []
  const sets = isNum(raw.sets) && Number.isInteger(raw.sets) && raw.sets >= 1 ? raw.sets : 3
  let repMin = isNum(raw.repMin) && raw.repMin >= 1 ? raw.repMin : 8
  let repMax = isNum(raw.repMax) && raw.repMax >= 1 ? raw.repMax : 12
  if (repMin > repMax) {
    repMin = 8
    repMax = 12
  }
  const increment = isNum(raw.increment) && raw.increment > 0 ? raw.increment : 2.5
  const targetRir = isNum(raw.targetRir) && raw.targetRir >= 0 ? raw.targetRir : 2
  return { ...e, part, repMin, repMax, sets, increment, targetRir, primary, secondary: muscles(raw.secondary) } as Exercise
}

/** 週目標を整える。有限な数値だけ残し 10〜20 に収める。未知の筋肉は捨てる（文字列は数値にしない） */
function normalizeWeeklyTargets(v: unknown): AppData['weeklyTargets'] {
  const out: AppData['weeklyTargets'] = {}
  if (!isObj(v)) return out
  for (const m of MUSCLES) {
    const n = v[m]
    if (isNum(n)) out[m] = Math.min(WEEKLY_MAX, Math.max(WEEKLY_MIN, n))
  }
  return out
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 数値（数字だけの文字列は数値にする）。直せなければ 0 */
const toNum = (v: unknown): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

/** 壊れたセットを補正する。オブジェクトでなければ undefined（捨てる） */
function normalizeSet(v: unknown): SetLog | undefined {
  if (!isObj(v)) return undefined
  return { ...v, weight: toNum(v.weight), reps: toNum(v.reps), done: v.done === true } as SetLog
}

/** 壊れた記録を補正する。種目idが無い・sets が配列でなければ捨てる */
function normalizeEntry(v: unknown): Entry | undefined {
  if (!isObj(v) || typeof v.exerciseId !== 'string' || !Array.isArray(v.sets)) return undefined
  const sets = v.sets.map(normalizeSet).filter((x): x is SetLog => x !== undefined)
  return { ...v, sets } as unknown as Entry
}

/** 壊れたセッションを補正する。日付が文字列でなければ捨てる。entries が配列でなければ空にして残す（メモ・体重を失わないため） */
function normalizeSession(v: unknown): Session | undefined {
  if (!isObj(v) || typeof v.date !== 'string') return undefined
  const rawEntries: unknown[] = Array.isArray(v.entries) ? v.entries : []
  const entries = rawEntries.map(normalizeEntry).filter((x): x is Entry => x !== undefined)
  return { ...v, entries } as unknown as Session
}

/** 読み込んだ JSON を AppData に整える。形式が違えば undefined（読み込みと JSON インポートで共用）。壊れた要素は補正または捨てる */
export function normalizeData(parsed: unknown): AppData | undefined {
  if (!isAppData(parsed)) return undefined
  const exercises = (parsed.exercises as unknown[])
    .filter((e): e is Partial<Exercise> & { id: string; name: string } => isObj(e) && typeof e.id === 'string' && typeof e.name === 'string')
    .map(normalizeExercise)
  const seen = new Set<string>()
  const sessions = (parsed.sessions as unknown[])
    .map(normalizeSession)
    .filter((x): x is Session => x !== undefined)
    .map(x => {
      // id が無い・空・重複のときは新しい id を振る（最初のものは元の id のまま）
      const id = typeof x.id === 'string' && x.id !== '' && !seen.has(x.id) ? x.id : uid()
      seen.add(id)
      return id === x.id ? x : { ...x, id }
    })
  const weeklyTargets = normalizeWeeklyTargets(parsed.weeklyTargets)
  return { ...defaultData(), ...parsed, exercises, sessions, weeklyTargets }
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
