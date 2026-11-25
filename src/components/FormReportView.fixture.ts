import type { Exercise } from '../types'
import type { EmphasisTarget, FormReport, RepResult } from '../form/types'

/**
 * FormReportView の画面確認用サンプル（スクワット 6 レップ）。
 * 崩れ：上体の前傾（確信度 mid）・かかとの浮き（low のみ）、改善した崩れ 1 件、1 レップだけの崩れ 1 件、ストレッチあり、狙いあり。
 * 撮影画面の担当とメインが画面確認に使える。
 */
export const fixtureExercise: Exercise = {
  id: 'squat', name: 'スクワット', part: '脚', repMin: 5, repMax: 8, increment: 2.5, sets: 3, targetRir: 2,
  primary: ['大腿四頭筋', '臀筋'], secondary: ['ハムストリング'], equipment: 'barbell',
}

const rep = (index: number, score: number, over: Partial<RepResult> = {}): RepResult => ({
  index, score, romDeg: 88, eccentricSec: 2.1, concentricSec: 1.1, minAngle: 82, maxAngle: 172, issues: [],
  metrics: { confidence: 0.85, view: 'side', viewOk: 'ok', velocityLossPct: 0, stickingAngle: 118 },
  ...over,
})

export const fixtureReps: RepResult[] = [
  rep(1, 86),
  rep(2, 82, { eccentricSec: 1.9, metrics: { confidence: 0.85, view: 'side', viewOk: 'ok', velocityLossPct: 6, stickingAngle: 120 } }),
  rep(3, 78, { minAngle: 90, metrics: { confidence: 0.8, view: 'side', viewOk: 'ok', velocityLossPct: 14, stickingAngle: 122 } }),
  rep(4, 74, { minAngle: 92, eccentricSec: 1.6, metrics: { confidence: 0.55, view: 'oblique', viewOk: 'caution', velocityLossPct: 22, stickingAngle: 125 } }),
  rep(5, 70, { minAngle: 95, eccentricSec: 1.5, metrics: { confidence: 0.82, view: 'side', viewOk: 'ok', velocityLossPct: 31, stickingAngle: 128 } }),
  rep(6, 68, { minAngle: 96, eccentricSec: 1.4, metrics: { confidence: 0.8, view: 'side', viewOk: 'ok', velocityLossPct: 38, stickingAngle: 130 } }),
]

export const fixtureTargets: EmphasisTarget[] = [
  { id: 'glute', label: 'お尻・内もも' },
  { id: 'quad', label: '太もも前' },
]

export const fixtureReport: FormReport = {
  overallScore: 76,
  confidence: 0.78,
  view: 'side',
  viewOk: 'ok',
  stretch: {
    score: 82, reach: 0.85, consistency: 0.67, timeInStretch: 0.3,
    reference: '論文の基準（膝屈曲 90〜140°）',
  },
  emphasis: {
    distribution: [
      { label: '股関節まわり', muscles: ['臀筋', 'ハムストリング'], share: 0.6 },
      { label: '太もも前', muscles: ['大腿四頭筋'], share: 0.4 },
    ],
    level: 'やや股関節寄り',
    target: {
      id: 'glute', label: 'お尻・内もも', share: 0.6, score: 72,
      tips: ['しゃがむとき、お尻を後ろに引く意識を持つ', '足幅をやや広げ、つま先を少し外に向ける'],
    },
    note: '体の向きと関節の角度からの推定です。筋電図ではありません。',
  },
  effort: { velocityLossPct: 38, proximity: 1, source: 'velocity' },
  faults: [
    {
      code: 'trunk-lean', label: '上体の前傾が大きい', reps: [4, 5, 6],
      causes: [
        { cause: 'mobility', confidence: 'mid', reason: '1レップ目から出ていて、軽い重量の日も同じ' },
        { cause: 'strength', confidence: 'low', reason: '重量が最大に近い日だけ出ている' },
      ],
      cue: '胸を高く保つ',
      drills: ['ゴブレットスクワット（軽い重量で胸を立てる）', 'ボックススクワット'],
      selfCheck: '壁に向かって立ち、つま先を壁から10cm離して膝が壁につくか確かめる。',
      muscleHint: '脊柱起立筋（根拠：中）',
      evidence: 'Fry 2003',
    },
    {
      code: 'heel-lift', label: 'かかとが浮く', reps: [5, 6],
      causes: [{ cause: 'mobility', confidence: 'low', reason: '2レップだけで、手がかりが少ない' }],
      cue: '足裏全体で床を踏む',
      drills: ['ヒールを少し高くしたスクワット'],
      selfCheck: '足首の前側を押し込んで、膝がつま先より前に出るか確かめる。',
      muscleHint: 'ふくらはぎ（根拠：弱）',
    },
    {
      code: 'knee-valgus', label: '膝が内側に入って見える', reps: [],
      causes: [], cue: '膝を外へ開く', drills: [],
    },
    {
      code: 'hip-shift', label: '腰が左右にずれる', reps: [3],
      causes: [{ cause: 'technique', confidence: 'low', reason: '1レップだけ' }],
      cue: '左右均等に踏む', drills: [],
    },
  ],
  primaryCue: '胸を高く保つ',
  trend: '前回よりストレッチ +8点',
  disclaimer: 'この解析は推定です。痛みやしびれがあれば中止し、医師・理学療法士に相談してください。',
}

/** 撮り直しをすすめる版（retakeReason あり） */
export const fixtureReportRetake: FormReport = {
  ...fixtureReport,
  confidence: 0.5,
  viewOk: 'ng',
  retakeReason: '斜めから撮影されています。体の真横にカメラを置いて撮り直すと、精度が上がります。',
}
