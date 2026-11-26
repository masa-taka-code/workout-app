import { HIP_KNEE_LEVELS } from '../form/analysis'
import { adviceFor } from '../form/advice'
import type { Confidence, FaultFinding, FormExerciseKey, PersonalBaseline, RepResult } from '../form/types'

/** 確信度の点と言葉（色では示さない）。例「●●○ 中」 */
export function confidenceDots(c: Confidence): { dots: string; word: string } {
  if (c === 'high') return { dots: '●●●', word: '高' }
  if (c === 'mid') return { dots: '●●○', word: '中' }
  return { dots: '●○○', word: '低' }
}

/** 撮影条件の言葉：0.8 以上「良い」、0.6 以上「ふつう」、それ未満「よくない（参考値）」 */
export function conditionWord(confidence: number): string {
  if (confidence >= 0.8) return '良い'
  if (confidence >= 0.6) return 'ふつう'
  return 'よくない（参考値）'
}

/** 信頼度 0.6 未満、または撮影条件が悪かった（placementOk=false）レップは参考値 */
export function isReferenceRep(rep: RepResult): boolean {
  return rep.metrics !== undefined && (rep.metrics.confidence < 0.6 || rep.metrics.placementOk === false)
}

/** 撮影条件が悪かったレップの番号（回数には数えるが、減点・崩れの判定から外した回） */
export function badPlacementReps(reps: RepResult[]): number[] {
  return reps.filter(r => r.metrics?.placementOk === false).map(r => r.index)
}

/** 配分（0〜1）を 5% 刻みに丸めた数字（%）。例 0.58 → 60 */
export function roundShare(share: number): number {
  const pct = Math.min(1, Math.max(0, share)) * 100
  return Math.round(pct / 5) * 5
}

/** 「約60%」 */
export function shareText(share: number): string {
  return `約${roundShare(share)}%`
}

/** 負荷配分の段階（膝優位〜股関節優位）の位置 0〜3。段階の名前でなければ -1 */
export function levelIndex(level: string | undefined): number {
  return (HIP_KNEE_LEVELS as readonly string[]).indexOf(level ?? '')
}

/** 「3・4・5回目」 */
export function repsText(reps: number[]): string {
  return `${[...reps].sort((a, b) => a - b).join('・')}回目`
}

export interface FaultGroups {
  /** 改善した崩れ（今回は1回も出なかったもの。reps が空） */
  improved: FaultFinding[]
  /** 2レップ以上で出た崩れ */
  main: FaultFinding[]
  /** 1レップだけの崩れ（「その他」にまとめる） */
  others: FaultFinding[]
}

/** 崩れを、改善した・主な・1レップだけに分ける。主なものは出たレップ数の多い順（同数は元の順） */
export function groupFaults(faults: FaultFinding[]): FaultGroups {
  const improved = faults.filter(f => f.reps.length === 0)
  const rest = faults.filter(f => f.reps.length > 0)
  const main = rest
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.reps.length >= 2)
    .sort((a, b) => b.f.reps.length - a.f.reps.length || a.i - b.i)
    .map(({ f }) => f)
  const others = rest.filter(f => f.reps.length === 1)
  return { improved, main, others }
}

/** 確信度 low しかない（原因を言わずセルフチェックへ誘導する） */
export function onlyLowConfidence(f: FaultFinding): boolean {
  return f.causes.every(c => c.confidence === 'low')
}

/** 原因の種類の言い方 */
export const CAUSE_LABEL: Record<string, string> = {
  strength: '筋力がまだ足りない可能性',
  mobility: '体の硬さ（関節の動く範囲）',
  technique: '動きのコツ（練習で改善中）',
  fatigue: '疲れ（セット後半）',
  load: '重量が重すぎる可能性',
  structure: '骨格・体格による個人差',
}

/** 基準ボタンの文言。n は基準に使う条件の良いレップ数 */
export function baselineButtonText(n: number): string {
  return `このセットを基準にする（条件の良い ${n} レップの中央値）`
}

/** 条件の良いレップが足りないとき（基準を作れない）の案内 */
export const BASELINE_TOO_FEW_TEXT = '条件の良いレップが3回以上必要です'

/** 基準の崩れ code を、確認ダイアログの言い方にする */
function belowLabel(key: FormExerciseKey, code: string): string {
  if (code === 'forward-lean') return '前傾が大きい'
  if (code === 'shallow' || code === 'shallow-hinge' || code === 'partial-bottom' || code === 'partial-top') return '浅い'
  return adviceFor(key, code).label
}

/**
 * 基準にする前の確認の文。belowGeneral（基準に使ったレップの半数以上で、一般の目安では崩れと出た崩れ）があるときは
 * 「一般の目安では〜と出ています」、なければ上書きの確認。
 */
export function baselineConfirmText(b: PersonalBaseline): string {
  if (b.belowGeneral.length === 0) {
    return `条件の良い ${b.repCount} レップの中央値を基準にします。すでに基準がある場合は上書きされます。よろしいですか？`
  }
  const labels = [...new Set(b.belowGeneral.map(c => belowLabel(b.key, c)))].join('／')
  return `この基準は一般の目安では${labels}と出ています。それでも基準にしますか？`
}

/** 0〜1 を「85%」に */
export function pctText(v: number): string {
  return `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`
}

/** 配分の帯の幅（%）。0〜100 に収める */
export function barWidth(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v * 100)))
}

/** 安全に関わる崩れ（声かけ・表示で優先する） */
export const SAFETY_FAULT_CODES: readonly string[] = ['hip-rise', 'knee-valgus']
