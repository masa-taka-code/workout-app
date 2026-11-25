/**
 * フォーム採点の計算（純粋なロジック。React・MediaPipe に依存しない）。
 * 仮実装：implementer が実装する。公開する関数・クラスの形は変えないこと。
 */
import type { Exercise } from '../types'
import type { Baseline, FormExerciseKey, FrameResult, Pose, RepResult, SetSummary } from './types'

/** 種目名から採点対応の種目キーを決める。対応していなければ undefined */
export function formKeyFor(_ex: Exercise): FormExerciseKey | undefined {
  return undefined
}

/** 撮影のしかた（画面に出す説明） */
export function setupGuide(_key: FormExerciseKey): string {
  return ''
}

/** 1セット分のフレームを順に受け取り、レップを数えて採点する */
export class RepTracker {
  readonly key: FormExerciseKey
  readonly baseline?: Baseline

  constructor(key: FormExerciseKey, baseline?: Baseline) {
    this.key = key
    this.baseline = baseline
  }

  /** timeMs は単調増加するミリ秒（performance.now() など） */
  push(_pose: Pose | undefined, _timeMs: number): FrameResult {
    return { visible: false, angles: {}, phase: 'idle', reps: [] }
  }

  reset(): void {}
}

export function summarizeSet(_reps: RepResult[]): SetSummary {
  return { reps: 0, avgScore: 0, mainIssues: [], lengthenedOk: false }
}

/** 良いフォームのレップから基準を作る */
export function baselineFrom(rep: RepResult): Baseline {
  return { romDeg: rep.romDeg, minAngle: rep.minAngle, maxAngle: rep.maxAngle }
}
