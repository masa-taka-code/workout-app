/**
 * 崩れ（FaultFinding）ごとの表示用の定義表。ラベル・キュー・練習・セルフチェック・筋肉のヒント・出典。
 * 文言は断定しない。キューは外的焦点（体の部位でなく、動きの結果・床・バー）の短い言葉にする。
 * 根拠：scratchpad の form-research/faults.md と muscles.md（いずれも検索要約ベースで、論文本文は未確認）。
 */
import type { CauseKind, FormExerciseKey } from './types'

export interface FaultAdvice {
  label: string
  cue: string
  drills: string[]
  selfCheck?: string
  muscleHint?: string
  evidence?: string
}

/** 膝-壁テストの手順（信頼性は高いが、後ろ足の位置で値が変わるので手順をそろえる） */
export const KNEE_WALL_TEST =
  '膝-壁テスト：壁の前に立ち、かかとを床につけたまま膝を壁につけられる範囲で、足を壁からできるだけ離します。つま先と壁の距離を測り、足の置き方を毎回そろえて、左右・日を変えて比べます（Powden 2015）。'

/** 共通の定義（種目で文言が違うものは下の ADVICE_BY_KEY が優先される） */
const ADVICE: Record<string, FaultAdvice> = {
  'forward-lean': {
    label: '上体の前傾が大きい',
    cue: '胸のマークを前の壁に見せる',
    drills: ['ゴブレットスクワット', 'かかと台（2.5cm程度）で比べる', '足首の可動域ドリル（ふくらはぎのストレッチなど）'],
    selfCheck: KNEE_WALL_TEST,
    muscleHint: '足首の硬さ（ふくらはぎ）が関係することが多いようです（根拠の強さ：中）',
    evidence: '膝の前方移動を制限すると前傾が増える（Fry 2003）。かかと台で前傾が減った研究あり（14名、結果は割れる）',
  },
  'heel-lift': {
    label: 'かかとが浮く',
    cue: '足裏全体で床を押す',
    drills: ['ふくらはぎのストレッチ', 'かかと台・リフティングシューズを試す'],
    selfCheck: KNEE_WALL_TEST,
    muscleHint: '足首の背屈（ふくらはぎ）が関係することがあります（根拠の強さ：中）',
    evidence: '荷重位の足首背屈と動作の関連（Dill ら）。ストレッチで背屈は増えるが小さい（Radford 2006）',
  },
  shallow: {
    label: '深さが足りない',
    cue: '深さをそろえる',
    drills: ['軽い重量で深さをそろえる'],
  },
  'knee-valgus': {
    label: '膝が内側に入る（参考）',
    cue: '床を外に押し広げる',
    drills: ['軽い重量で反復する', 'かかと台で比べる'],
    selfCheck: KNEE_WALL_TEST + ' 左右差も見ます。',
    muscleHint: '股関節の筋力との関係は研究で一致していません（根拠の強さ：低）',
    evidence: 'Alzahrani 2021（系統的レビュー）、Dix 2019',
  },
  'hip-rise': {
    label: 'お尻が浮く',
    cue: 'お尻をベンチに貼りつける',
    drills: ['足の位置を見直す（両足を床につける）', '重量を下げる'],
    evidence: '頭・肩・お尻をベンチ、両足を床につける（NSCA 系教材の通説）',
  },
  'bar-drift': {
    label: 'バーの軌道がずれる',
    cue: 'バーを肩の上に戻す',
    drills: ['軽い重量の軌道と見比べる'],
    evidence: '限界近くでは軌道が肩の真上に寄る（Duffey 2007、少人数）',
  },
  'partial-bottom': {
    label: '下で腕を伸ばしきれていない',
    cue: '下でしっかり腕を伸ばす',
    drills: ['重量を下げて伸ばしきる', 'インクラインで伸びた位置を使う'],
    evidence: '伸張側で肘屈筋の肥大が大きい（Pedrosa 2023）',
  },
  'partial-top': {
    label: '上まで巻き上げられていない',
    cue: '手首を肩に近づける',
    drills: ['重量を下げて上まで巻き上げる'],
  },
  swing: {
    label: '体の反動を使っている',
    cue: '背中を壁につけるつもりで',
    drills: ['壁に背をつけて行う', 'プリーチャーカール', 'テンポを決めて行う'],
    muscleHint: '反動でも肥大は同程度という研究があり、減点は小さくしています（根拠の強さ：弱）',
    evidence: 'Augustin 2025（単一研究）',
  },
  'elbow-forward': {
    label: '肘が前に出る',
    cue: '肘を脇腹に置いたまま',
    drills: ['プリーチャーカール', '肘の位置を固定して行う'],
  },
  'fast-down': {
    label: '下ろすのが速い',
    cue: '静かに置きにいくように下ろす',
    drills: ['1〜3秒かけて下ろす'],
  },
  'rom-drop': {
    label: '後半に可動域が狭くなる',
    cue: '最初と同じ深さまで動かす',
    drills: ['可動域を保てる回数で止める', '重量を下げる'],
  },
  'short-rom': {
    label: 'いつもより可動域が狭い',
    cue: '基準動画と同じ深さまで動かす',
    drills: ['基準動画と見比べる'],
  },
}

/** 種目で文言が変わるもの（キーは「種目:code」） */
const ADVICE_BY_KEY: Record<string, FaultAdvice> = {
  'squat:shallow': {
    label: 'しゃがみが浅い',
    cue: 'お尻を箱に置きにいく',
    drills: ['ボックススクワットで深さをそろえる', 'かかと台で比べる'],
    selfCheck: KNEE_WALL_TEST,
    muscleHint: '足首と股関節の曲がりやすさが深さと関係します（根拠の強さ：中）',
    evidence: '背屈と股関節屈曲が深さと関連（101名）。深いほど臀筋・内転筋の肥大が大きい（Kubo 2019）',
  },
  'bench:shallow': {
    label: 'バーが胸まで下りていない',
    cue: '胸に軽く触れるまで下ろす',
    drills: ['重量を下げて全可動域で行う', '基準動画と同じ深さで撮り比べる'],
    evidence: 'フル可動域で大胸筋の肥大が大きい（Mendonça 2021）',
  },
}

/** 未知の code でも落ちないよう、最低限の定義を返す */
export function adviceFor(key: FormExerciseKey, code: string): FaultAdvice {
  return ADVICE_BY_KEY[`${key}:${code}`] ?? ADVICE[code] ?? { label: code, cue: '', drills: [] }
}

/** 安全に関わる崩れ（primaryCue で最優先する） */
export const SAFETY_CODES: readonly string[] = ['hip-rise', 'knee-valgus']

/** 崩れごとに、原因として挙げてよい種類（研究の表にない原因は出さない）。表にない code は全種類を許す */
export const ALLOWED_CAUSES: Record<string, CauseKind[]> = {
  'forward-lean': ['mobility', 'technique', 'fatigue', 'load', 'strength', 'structure'],
  'heel-lift': ['mobility', 'technique', 'structure'],
  shallow: ['mobility', 'technique', 'load', 'fatigue', 'strength', 'structure'],
  'knee-valgus': ['mobility', 'strength', 'technique', 'fatigue', 'load'],
  'hip-rise': ['load', 'fatigue', 'technique'],
  'bar-drift': ['technique', 'fatigue', 'load'],
  swing: ['load', 'fatigue', 'technique'],
  'elbow-forward': ['load', 'fatigue', 'technique'],
  'partial-bottom': ['fatigue', 'load', 'technique'],
  'partial-top': ['fatigue', 'load', 'technique'],
  'fast-down': ['technique', 'load'],
  'rom-drop': ['fatigue', 'load'],
  'short-rom': ['technique', 'fatigue', 'load'],
}
