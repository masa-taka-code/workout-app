/**
 * 崩れの原因の推定（純粋関数）。
 * 4つの手がかり（①セット内のどのレップで出るか ②重量 ③過去の推移 ④他の指標との組み合わせ）で候補に点を付け、
 * 確信度（high / mid / low）をつけて並べる。筋電図や筋の長さは測っていないので、断定はしない。
 *
 * 確信度の決め方（根拠のない仮の値・暫定）：
 *  - 手がかりごとに強さ 1（低）/ 2（中）/ 3（高）を決める。
 *  - 同じ原因を支える手がかりが2つ以上あれば、最も強いものを1段階だけ引き上げる（上限は高）。
 *  - 手がかりが1つだけなら、その手がかり自身の強さのまま。
 */
import { ALLOWED_CAUSES } from './advice'
import type { CauseCandidate, CauseKind, Confidence, FormContext } from './types'

/** 判定に使うレップ（信頼度 0.6 以上だけを、番号順に渡す） */
export interface CauseUsableRep {
  index: number
  velocityLossPct?: number
}

interface Clue {
  strength: 1 | 2 | 3
  text: string
}

// ---- 以下の数値はすべて「根拠のない仮の値」（暫定）。研究から決められないので保守的に置いている ----
/** 重い日とみなす：今回の重量が直近最大の何割以上か */
const HEAVY_RATIO = 0.95
/** 軽い重量とみなす：今回の重量の何倍未満か */
const LIGHT_RATIO = 0.9
/**
 * 疲労の手がかり：後半の速度低下がこれ（%）を超えたら「中」。
 * 姿勢推定の速度は未検証なので、速度低下だけでは「高」にしない（疲労の確信度は最大 mid）。
 * 参考：全力の速さで限界まで行うと、上げる速度は −59〜−63%、下ろす速度も −26〜−36% 低下した（Tsoukos 2023）。
 */
const FATIGUE_LOSS_HIGH = 20
/** 同：これを超えたら中 */
const FATIGUE_LOSS_MID = 10
/** 推移が改善中とみなす：発生率が最初から最後までに下がった量 */
const IMPROVE_DROP = 0.2
/** 同：途中で上がってよい量 */
const IMPROVE_SLACK = 0.05
/** タイミングの手がかりを使う最小レップ数 */
const MIN_REPS_FOR_TIMING = 3

const ORDER: CauseKind[] = ['fatigue', 'load', 'mobility', 'technique', 'strength', 'structure']
const LEVEL: Record<number, Confidence> = { 1: 'low', 2: 'mid', 3: 'high' }
const RANK: Record<Confidence, number> = { high: 3, mid: 2, low: 1 }

/**
 * 確信度の上限（根拠が弱い原因は、手がかりが重なっても上限を超えない）。
 *  - 疲労：姿勢推定の速度は未検証
 *  - 膝の内倒れ：2D の投影角は 3D の外反とほとんど一致しない（R² 0〜64%）
 *  - 膝の曲げすぎ（rdl）：2D の膝の角度は誤差が約12° あり、技術の問題と言い切れない
 *  - 基準動画が無いときの squat・bss の浅さ：しきい値に姿勢推定の誤差（約12°）があり、深い屈曲は小さめに出やすい（Leuthold 2025）
 */
function confidenceCap(cause: CauseKind, code: string, ctx: FormContext): Confidence {
  if (cause === 'fatigue') return 'mid'
  if (code === 'knee-valgus') return 'mid'
  if (code === 'knee-bend') return 'mid'
  if (code === 'shallow' && (ctx.key === 'squat' || ctx.key === 'bss') && !(ctx.baseline && ctx.baseline.romDeg > 0)) return 'low'
  return 'high'
}

function rate(counts: Record<string, number>, reps: number, code: string): number {
  return (counts[code] ?? 0) / Math.max(1, reps)
}

/**
 * code の崩れの原因候補を、確信度の高い順に返す（最大3件）。手がかりがなければ空配列。
 * @param faultReps 崩れが出たレップ番号
 * @param usable    信頼度 0.6 以上のレップ（番号順）
 * @param otherCodes 同じセットで検出された他の崩れの code
 */
export function inferCauses(
  code: string,
  faultReps: number[],
  usable: CauseUsableRep[],
  ctx: FormContext,
  otherCodes: string[],
): CauseCandidate[] {
  const clues = new Map<CauseKind, Clue[]>()
  const add = (cause: CauseKind, strength: 1 | 2 | 3, text: string) => {
    const list = clues.get(cause) ?? []
    list.push({ strength, text })
    clues.set(cause, list)
  }

  const n = usable.length
  const hist = ctx.history.filter(h => h.exerciseId === ctx.exerciseId && h.confidence >= 0.6)
  const lightSets = hist.filter(h => h.weight > 0 && h.weight < ctx.weight * LIGHT_RATIO)

  // ① タイミング
  if (n >= MIN_REPS_FOR_TIMING) {
    const pos = (idx: number) => usable.findIndex(r => r.index === idx)
    const positions = faultReps.map(pos).filter(p => p >= 0)
    const early = positions.some(p => p <= 1)
    const lateStart = n - Math.ceil(n / 3)
    const lateOnly = positions.length > 0 && !early && positions.every(p => p >= lateStart)
    if (early) {
      const t = '1〜2レップ目から出ている'
      add('mobility', 1, t)
      add('technique', 1, t)
      add('structure', 1, t)
    } else if (lateOnly) {
      const losses = usable.slice(lateStart).map(r => r.velocityLossPct).filter((v): v is number => v !== undefined)
      const loss = losses.length ? Math.max(...losses) : undefined
      const natural = code === 'bar-drift' ? '（疲労による自然な変化のこともあります：Duffey 2007）' : ''
      if (loss !== undefined && loss > FATIGUE_LOSS_HIGH) {
        add('fatigue', 2, `最後の3分の1だけで出ていて、速度も落ちている（姿勢推定の速度なので参考）${natural}`)
        add('strength', 1, '後半の速度が落ちた区間だけで出ている')
      } else if (loss !== undefined && loss > FATIGUE_LOSS_MID) {
        add('fatigue', 2, `最後の3分の1だけで出ていて、速度が少し落ちている${natural}`)
      } else {
        add('fatigue', 1, `最後の3分の1だけで出ている${natural}`)
      }
    }
  }

  // ② 重量：重い日だけ出ていて、軽い重量の履歴では出ていない
  const heavy = ctx.weight > 0 && ctx.recentBestWeight !== undefined && ctx.weight >= ctx.recentBestWeight * HEAVY_RATIO
  if (heavy && lightSets.length > 0 && lightSets.every(h => (h.faultCounts[code] ?? 0) === 0)) {
    add('load', 2, '重い日だけ出ていて、軽い重量のセットでは出ていない')
    add('strength', 1, '重い日だけ出ている')
  }

  // ③ 履歴の推移（新しい順の history を古い順に直す）
  const recent = hist.slice(0, 3)
  const seq = [...recent].reverse().map(h => rate(h.faultCounts, h.reps, code))
  seq.push(faultReps.length / Math.max(1, n))
  let improving = false
  if (seq.length >= 3) {
    const steady = seq.every((v, i) => i === 0 || v <= seq[i - 1] + IMPROVE_SLACK)
    improving = steady && seq[0] - seq[seq.length - 1] >= IMPROVE_DROP
  }
  if (improving) {
    add('technique', 2, '直近の記録で出る割合が下がってきている（練習で改善中の可能性）')
  } else if (recent.length >= 2 && recent.every(h => (h.faultCounts[code] ?? 0) > 0)) {
    const lightAlso = recent.some(h => h.weight > 0 && h.weight < ctx.weight * LIGHT_RATIO)
    if (lightAlso) {
      add('mobility', 2, '軽い重量の日にも毎回出ている')
      add('structure', 2, '軽い重量の日にも毎回出ている')
    } else {
      add('mobility', 1, '直近のセットで毎回出ている')
      add('structure', 1, '直近のセットで毎回出ている')
    }
  }

  // ④ 他の指標との組み合わせ（足首の硬さ）
  if ((code === 'heel-lift' && otherCodes.includes('forward-lean')) || (code === 'forward-lean' && otherCodes.includes('heel-lift'))) {
    add('mobility', 2, 'かかとの浮きと上体の前傾が同じセットで出ている（足首が関係する可能性）')
  }

  const allowed = ALLOWED_CAUSES[code]
  const out: Array<CauseCandidate & { total: number }> = []
  for (const [cause, list] of clues) {
    if (allowed && !allowed.includes(cause)) continue
    const max = Math.max(...list.map(c => c.strength))
    const level = Math.min(3, max + (list.length >= 2 ? 1 : 0), RANK[confidenceCap(cause, code, ctx)])
    const texts = [...new Set(list.map(c => c.text))]
    out.push({
      cause,
      confidence: LEVEL[level],
      reason: texts.join('／') + '。',
      total: list.reduce((a, c) => a + c.strength, 0),
    })
  }
  out.sort((a, b) =>
    RANK[b.confidence] - RANK[a.confidence] || b.total - a.total || ORDER.indexOf(a.cause) - ORDER.indexOf(b.cause))
  return out.slice(0, 3).map(({ cause, confidence, reason }) => ({ cause, confidence, reason }))
}
