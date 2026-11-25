/**
 * 崩れ（FaultFinding）ごとの表示用の定義表。ラベル・キュー・練習・セルフチェック・筋肉のヒント・出典。
 * 文言は断定しない。キューは外的焦点（体の部位でなく、動きの結果・床・バー）の短い言葉にする。
 * 外的焦点のキューの根拠の強さは「弱〜中」（再解析で効果がほぼ消える：McKay 2024）。害はないので続けるが、効果は断定しない。
 * 根拠：scratchpad の form-research と verify の確認結果（論文本文・抄録で確認できた範囲だけを書く）。
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
  '膝-壁テスト：壁の前に立ち、かかとを床につけたまま膝を壁につけられる範囲で、足を壁からできるだけ離します。つま先と壁の距離を測り、足の置き方を毎回そろえて、左右・日を変えて比べます。2cm 以上変われば変化ありとみなせます（1cm の変化は誤差の範囲：Powden 2015）。'

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
    label: '膝が内側に入って見える',
    cue: '床を外に押し広げる',
    drills: ['軽い重量で反復する', 'かかと台で比べる'],
    selfCheck: KNEE_WALL_TEST + ' 左右差も見ます。',
    muscleHint: '股関節の筋力との関係は研究で一致していません（根拠の強さ：低）',
    evidence: '2D の投影角は 3D の外反とほとんど一致しません（R² 0〜64%）。股関節の筋力との関係：Alzahrani 2021（系統的レビュー）、Dix 2019（女性の片脚スクワットの研究）',
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
    evidence: '後半の軌道の変化は、疲労による自然な変化のことがあります（Duffey 2007。方向は系統的レビューでも確認）',
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
  'lean-back': {
    label: '腰が反りすぎている',
    cue: 'お腹に力を入れ、肋骨を下げる',
    drills: ['重量を下げる', '座位で背もたれを使って行う'],
    muscleHint: '重量が重すぎる・疲れてきたときに出やすい動きです（暫定、根拠の強さ：意見）',
    evidence: '体幹の後傾がレップ開始時より 15° 以上増えたら知らせます。しきい値は暫定で、研究で確かめられた値ではありません',
  },
  'elbow-drift': {
    label: '上腕がぶれる',
    cue: '肘を天井に向けたまま',
    drills: ['軽い重量で肘の位置を固定して行う'],
    evidence: '上腕の振れ 25° 超を知らせます（暫定のしきい値。研究で確かめられた値ではありません）',
  },
  'knee-bend': {
    label: '膝が曲がりすぎて見える（スクワットに近い）',
    cue: 'すねを床と垂直に保つ',
    drills: ['壁にお尻を近づけるヒップヒンジの練習', '軽いダンベルで股関節から折りたたむ練習'],
    muscleHint: '膝を曲げるほど、もも裏より太もも前の関与が増えやすいと考えられます（根拠の強さ：弱）',
    evidence: '最下点の膝の内角 130° 未満を知らせます（暫定のしきい値。姿勢推定の角度誤差は約12°：Leuthold 2025）',
  },
  'shallow-hinge': {
    label: '股関節の曲がりが浅い',
    cue: 'お尻を後ろの壁へ',
    drills: ['軽い重量で基準動画と同じ深さにそろえる', '壁にお尻を近づけるヒップヒンジの練習'],
    muscleHint: 'もも裏の硬さが関係することがあります（根拠の強さ：弱）',
    evidence: '股関節を深く曲げてハムストリングを伸ばす方向が有利（Maeo 2021、座位レッグカールの研究からの類推）。基準動画の90%未満で知らせます（暫定）',
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
    evidence: '深さをそろえると記録を比べやすい。可動域の違いによる長期の効果は研究で一貫しない',
  },
  'ohp:shallow': {
    label: 'バーの下ろし方が浅い',
    cue: 'バーを顎の高さまで下ろす',
    drills: ['重量を下げて、毎回同じ高さまで下ろす', '基準動画と同じ深さで撮り比べる'],
    evidence: '下ろす深さと筋肥大の関係は研究で確かめられていません。基準動画の90%未満、基準がなければ肘の屈曲 70° 未満で知らせます（暫定）',
  },
  'lateral:swing': {
    label: '体の反動を使っている',
    cue: '上体を止めたまま腕だけ',
    drills: ['重量を下げる', '座位や、ベンチに胸をつけて行う', 'テンポを決めて行う'],
    muscleHint: '重すぎる・疲れてきたときに出やすい動きです（根拠の強さ：弱）',
    evidence: '反動の有無で筋肥大に差がなかった研究はカールなどのもの（Augustin 2025）。体幹の振れ 15° 超を知らせます（暫定）',
  },
  'pulldown:swing': {
    label: '体の反動を使っている',
    cue: '胸を張ったまま、肘を下へ',
    drills: ['重量を下げる', 'テンポを決めて行う'],
    muscleHint: '重すぎる・疲れてきたときに出やすい動きです（根拠の強さ：弱）',
    evidence: '体幹の振れ 20° 超を知らせます（暫定）。約30°の後傾は広背筋の活動を変えないため、後傾そのものは崩れにしていません（Buonsenso 2025）',
  },
  'pulldown:partial-top': {
    label: '上で腕を伸ばしきれていない',
    cue: 'バーに引き上げられるまで腕を伸ばす',
    drills: ['重量を下げて、上で肩まで伸ばす', '基準動画と同じ高さまで戻す'],
    evidence: '肘の内角が 150° 未満（基準動画があれば基準の最大角 −15° 未満）を知らせます（暫定）。上での伸ばしきりと肥大の関係は研究で確かめられていません',
  },
  'ohext:shallow': {
    label: '肘の曲げ方が浅い',
    cue: '手を首の後ろまで下ろす',
    drills: ['重量を下げて、肘 90° まで曲げる', '基準動画と同じ深さで撮り比べる'],
    evidence: '研究の可動域は肘 90° まで曲げる範囲（Maeo 2023、頭上で長頭の筋量が大きく増えた）。基準動画があれば90%未満で知らせます',
  },
  'bss:shallow': {
    label: 'しゃがみが浅い',
    cue: '後ろ膝を床に近づける',
    drills: ['重量を下げて深さをそろえる', '基準動画と同じ深さで撮り比べる'],
    muscleHint: '足首と股関節の曲がりやすさが深さと関係します（根拠の強さ：中、squat からの類推）',
    evidence: '研究での深さの指示は前の太ももが床と平行（Song 2023）。基準なしでは前脚の膝屈曲 78°（90° − 姿勢推定の誤差 12°：Leuthold 2025）未満で知らせます（暫定）',
  },
}

/** 未知の code でも落ちないよう、最低限の定義を返す */
export function adviceFor(key: FormExerciseKey, code: string): FaultAdvice {
  return ADVICE_BY_KEY[`${key}:${code}`] ?? ADVICE[code] ?? { label: code, cue: '', drills: [] }
}

/** 安全に関わる崩れ（primaryCue で最優先する） */
export const SAFETY_CODES: readonly string[] = ['hip-rise', 'knee-valgus', 'lean-back']

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
  'lean-back': ['load', 'fatigue', 'technique'],
  'elbow-drift': ['load', 'fatigue', 'technique'],
  'knee-bend': ['technique'],
  'shallow-hinge': ['mobility', 'technique', 'fatigue', 'load'],
}
