import { useEffect, useState } from 'react'
import type { AppData, Entry, Exercise, Muscle, Session, SetLog } from './types'
import { MUSCLES } from './types'
import { WEEKLY_MAX, WEEKLY_MIN } from './logic'
import type { BaselineMetric, BaselineStat, FormExerciseKey, PersonalBaseline } from './form/types'

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

const FORM_KEYS: FormExerciseKey[] = ['squat', 'bench', 'curl', 'rdl', 'ohp', 'lateral', 'pulldown', 'ohext', 'bss']
const BASELINE_METRICS: BaselineMetric[] = [
  'minAngle', 'maxAngle', 'romDeg', 'kneeFlexionBottom', 'trunkLeanMax',
  'hipFlexionBottom', 'elbowFlexionBottom', 'elbowExtensionTop', 'heelLift',
]
const isStat = (v: unknown): v is BaselineStat => isObj(v) && isNum(v.med) && isNum(v.mad) && v.mad >= 0
const VIEW_KINDS = ['side', 'front', 'oblique', 'unknown']

/**
 * 自分の基準を整える。
 * - 旧形式（version が 2 でなく、romDeg・minAngle・maxAngle が数値）：1 レップの値を新形式（legacy）に読み替える。
 *   種目キーが squat・bss なら kneeFlexionBottom を 180 − minAngle で補う。
 * - 新形式（version 2）：形を検証し、壊れた値は捨てる（壊れた指標だけ落とし、基準そのものが使えなければ undefined）。
 * mapKey は formBaselines のキー（旧形式では種目キー）。
 */
function normalizeBaseline(v: unknown, mapKey: string): PersonalBaseline | undefined {
  if (!isObj(v)) return undefined
  const savedAt = typeof v.savedAt === 'string' ? v.savedAt : ''
  if (v.version !== 2) {
    if (!isNum(v.romDeg) || !isNum(v.minAngle) || !isNum(v.maxAngle)) return undefined
    // 旧形式は種目キー（'squat' など）で保存されていた。それ以外のキーの旧形式は種目が分からないので捨てる
    if (!(FORM_KEYS as string[]).includes(mapKey)) return undefined
    const key = mapKey as FormExerciseKey
    const stats: PersonalBaseline['stats'] = {
      romDeg: { med: v.romDeg, mad: 0 }, minAngle: { med: v.minAngle, mad: 0 }, maxAngle: { med: v.maxAngle, mad: 0 },
    }
    if (isNum(v.trunkLeanMax)) stats.trunkLeanMax = { med: v.trunkLeanMax, mad: 0 }
    if (key === 'squat' || key === 'bss') stats.kneeFlexionBottom = { med: 180 - v.minAngle, mad: 0 }
    return {
      version: 2, key, savedAt, weight: 0, repCount: 1, legacy: true, belowGeneral: [],
      stats, conditions: { source: 'live', view: 'unknown' },
    }
  }
  if (!(FORM_KEYS as string[]).includes(v.key as string) || !isObj(v.stats) || !isObj(v.conditions)) return undefined
  const stats: PersonalBaseline['stats'] = {}
  for (const m of BASELINE_METRICS) {
    const st = v.stats[m]
    if (isStat(st)) stats[m] = { med: st.med, mad: st.mad }
  }
  if (Object.keys(stats).length === 0) return undefined
  const c = v.conditions
  const side = c.side === 'left' || c.side === 'right' ? c.side : undefined
  const out: PersonalBaseline = {
    version: 2, key: v.key as FormExerciseKey, savedAt, weight: isNum(v.weight) && v.weight >= 0 ? v.weight : 0,
    repCount: isNum(v.repCount) && v.repCount >= 1 ? Math.floor(v.repCount) : 1,
    stats,
    conditions: {
      source: c.source === 'file' ? 'file' : 'live',
      view: VIEW_KINDS.includes(c.view as string) ? (c.view as PersonalBaseline['conditions']['view']) : 'unknown',
      ...(isNum(c.phiDeg) ? { phiDeg: c.phiDeg } : {}),
      ...(isNum(c.tiltDeg) ? { tiltDeg: c.tiltDeg } : {}),
      ...(side ? { side } : {}),
      ...(isNum(c.segLen) && c.segLen > 0 ? { segLen: c.segLen } : {}),
    },
    belowGeneral: Array.isArray(v.belowGeneral) ? v.belowGeneral.filter((x): x is string => typeof x === 'string') : [],
  }
  if (v.legacy === true) out.legacy = true
  return out
}

/** 基準の一覧を整える。読み替えられない値は捨てる */
function normalizeBaselines(v: unknown): AppData['formBaselines'] {
  if (!isObj(v)) return undefined
  const out: NonNullable<AppData['formBaselines']> = {}
  for (const [k, b] of Object.entries(v)) {
    const nb = normalizeBaseline(b, k)
    if (nb) out[k] = nb
  }
  return out
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
  // 体づくりの目的は4つの値のみ有効。それ以外は未設定（= gain 扱い）に戻す
  const bodyGoal = (['gain', 'maintain', 'cut', 'off'] as const).find(g => g === parsed.bodyGoal)
  const out: AppData = { ...defaultData(), ...parsed, exercises, sessions, weeklyTargets, bodyGoal }
  // 自分の基準：旧形式は読み替え、壊れた値は捨てる（無ければキー自体を持たない）
  if (parsed.formBaselines === undefined) delete out.formBaselines
  else out.formBaselines = normalizeBaselines(parsed.formBaselines)
  return out
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
