/**
 * フォーム解析 v2 の分析（純粋関数）。仮実装：implementer が実装する。公開する関数の形は変えないこと。
 */
import type { EmphasisTarget, FormContext, FormExerciseKey, FormReport, FormSessionSummary, RepResult } from './types'

/** 種目ごとの「効かせたい部位」の選択肢 */
export function emphasisTargets(_key: FormExerciseKey): EmphasisTarget[] {
  return []
}

/** 1セット分のレップから詳細レポートを作る */
export function analyzeSet(reps: RepResult[], _ctx: FormContext): FormReport {
  return {
    overallScore: reps.length ? Math.round(reps.reduce((a, r) => a + r.score, 0) / reps.length) : 0,
    confidence: 0,
    view: 'unknown',
    viewOk: 'ng',
    emphasis: { distribution: [], note: '' },
    effort: { source: 'none' },
    faults: [],
    disclaimer: '',
  }
}

/** 保存用の要約を作る */
export function toSessionSummary(report: FormReport, reps: RepResult[], ctx: FormContext, date: string): FormSessionSummary {
  return {
    date, exerciseId: ctx.exerciseId, key: ctx.key, weight: ctx.weight, reps: reps.length,
    avgScore: report.overallScore, stretchScore: report.stretch?.score, faultCounts: {}, confidence: report.confidence,
  }
}
