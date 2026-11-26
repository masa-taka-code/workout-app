import { describe, expect, it } from 'vitest'
import { analyzeSet, toSessionSummary } from './analysis'
import { inferCauses } from './causes'
import { RepTracker, summarizeSet } from './engine'
import { placementOkOf } from './measure'
import type { MeasureFrame } from './measure'
import {
  ARM_DIST_MIN, FRAME_MARGIN, LEG_DIST_MIN, PLACEMENT_WINDOW_MS, PlacementWindow, judgePlacement, standingSnapshot,
} from './placement'
import type { PlacementFixed, PlacementSample } from './placement'
import { repPath, setVisibility, squatPose, worldPose } from './testPoses'
import type { FormContext, FormExerciseKey, Pose, RepMetrics, RepResult, StandingSnapshot } from './types'
import { LM } from './types'

interface Opts {
  /** 鼻の y */
  top?: number
  /** 鼻〜足首の高さ（脚の種目の距離） */
  span?: number
  /** 肩の y（上半身の種目） */
  shoulderY?: number
  /** 上腕＋前腕の長さ（上半身の種目） */
  arm?: number
  vis?: number
  /** 全体の x（正規化座標×縦横比） */
  x?: number
  /** 足先の y のずれ（足首から） */
  footDy?: number
}

/** 真横に立った人の姿勢（縦横比補正済みの座標で作る）。脚の種目も上半身の種目もこれで使う */
function standing(o: Opts = {}): Pose {
  const top = o.top ?? 0.1
  const span = o.span ?? 0.7
  const vis = o.vis ?? 0.9
  const x = o.x ?? 0.4
  const arm = o.arm ?? 0.3
  const p: Pose = Array.from({ length: 33 }, () => ({ x, y: 0.5, z: 0, visibility: 0 }))
  const set = (i: number, y: number, dx = 0) => { p[i] = { x: x + dx, y, z: 0, visibility: vis } }
  const shoulderY = o.shoulderY ?? top + 0.1 * span
  p[LM.nose] = { x, y: top, z: 0, visibility: vis }
  for (const [l, r] of [[11, 12], [23, 24], [25, 26], [27, 28]] as const) {
    const y = l === 11 ? shoulderY : l === 23 ? top + 0.4 * span : l === 25 ? top + 0.7 * span : top + span
    set(l, y)
    set(r, y, 0.01)
  }
  for (const [l, r, f] of [[13, 14, 0.5], [15, 16, 1]] as const) {
    set(l, shoulderY + arm * f)
    set(r, shoulderY + arm * f, 0.01)
  }
  const foot = top + span + (o.footDy ?? 0)
  set(31, foot)
  set(32, foot, 0.01)
  return p
}

const sample = (pose: Pose | undefined, extra: Partial<PlacementSample> = {}): PlacementSample => ({ pose, ...extra })
const judge = (key: FormExerciseKey, pose: Pose | undefined, extra: Partial<PlacementSample> = {}, aspect?: number) =>
  judgePlacement(key, [sample(pose, { world: worldPose(0), ...extra })], { aspect })
const kinds = (r: ReturnType<typeof judgePlacement>) => r.reasons.map(x => `${x.kind}:${x.severity}`)

describe('判定の土台', () => {
  it('条件がそろっていれば ok で、案内は空', () => {
    for (const key of ['squat', 'rdl', 'bss', 'bench', 'curl', 'ohp', 'pulldown', 'ohext'] as FormExerciseKey[]) {
      // 手首を上げる種目は、肩を低めに置いて頭上まで枠に収まる姿勢にする
      expect(judge(key, standing({ shoulderY: 0.4 }))).toEqual({ level: 'ok', reasons: [] })
    }
  })

  it('姿勢が無い・関節が見えないときは hidden（案内は空）', () => {
    expect(judge('squat', undefined)).toEqual({ level: 'hidden', reasons: [] })
    expect(judge('squat', standing({ vis: 0.3 })).level).toBe('hidden')
    expect(judgePlacement('squat', []).level).toBe('hidden')
  })
})

describe('枠の余白（画面の端から 3% 以上内側）', () => {
  it('脚の種目は鼻と足先も見る：上端 0.025 は ng、0.035 は ok', () => {
    expect(judge('squat', standing({ top: 0.035 })).level).toBe('ok')
    const ng = judge('squat', standing({ top: 0.025 }))
    expect(ng.level).toBe('ng')
    expect(ng.reasons[0]).toMatchObject({ kind: 'frame', severity: 'ng', text: '少し離れるか、カメラの向きを調整してください' })
    expect(FRAME_MARGIN).toBe(0.03)
  })

  it('足先が下端に近い（足首は枠内でも foot_index が 0.98）と ng。bench は鼻・足先を見ない', () => {
    expect(kinds(judge('squat', standing({ top: 0.2, span: 0.58, footDy: 0.2 })))).toContain('frame:ng')
    expect(judge('bench', standing({ top: 0.02, span: 0.96 })).reasons.map(r => r.kind)).not.toContain('frame')
  })

  it('左右の端は、縦横比を戻した x で見る（縦横比 0.75 で x=0.02 は ng、0.04 は ok）', () => {
    const aspect = 0.75
    expect(judge('squat', standing({ x: 0.04 * aspect }), {}, aspect).level).toBe('ok')
    expect(kinds(judge('squat', standing({ x: 0.02 * aspect }), {}, aspect))).toContain('frame:ng')
    // 右端
    expect(kinds(judge('squat', standing({ x: 0.97 * aspect }), {}, aspect))).toContain('frame:ng')
  })

  it('上げきった手首（肩の y − 上腕と前腕の長さ）が上端から 3% 未満なら ng：ohp / pulldown / ohext', () => {
    for (const key of ['ohp', 'pulldown', 'ohext'] as FormExerciseKey[]) {
      expect(judge(key, standing({ shoulderY: 0.34, arm: 0.3 }))).toEqual({ level: 'ok', reasons: [] })
      const ng = judge(key, standing({ shoulderY: 0.32, arm: 0.3 }))
      expect(kinds(ng)).toContain('frame:ng')
    }
    // 手首を上げない種目は、肩が上にあっても枠の対象ではない
    expect(judge('curl', standing({ shoulderY: 0.2, arm: 0.3 })).level).toBe('ok')
  })

  describe('lateral（サイドレイズ）は両肩の左右に腕を水平に上げた手首を見る（上には上げないので上端は対象外）', () => {
    // 正面撮影（φ=90°）。普通の構図：画面の中央に立ち、肩が画面高の 0.3、腕の長さ 0.4
    const world = { world: worldPose(90) }
    const front = (o: Opts = {}) => standing({ x: 0.5, shoulderY: 0.3, arm: 0.4, ...o })
    it('腕を下ろした姿勢と 90° 上げた姿勢が、普通の構図で ok になる（腕の長さ 0.4 の中央立ち）', () => {
      expect(judge('lateral', front(), world)).toEqual({ level: 'ok', reasons: [] })
      // 90° 上げた姿勢：手首・肘が肩の高さで左右へ。予測と同じ位置なので枠の判定は変わらない
      const raised = front()
      for (const [s, e, w, dx] of [[11, 13, 15, -1], [12, 14, 16, 1]] as const) {
        const sh = raised[s]
        raised[e] = { ...raised[e], x: sh.x + dx * 0.2, y: sh.y }
        raised[w] = { ...raised[w], x: sh.x + dx * 0.4, y: sh.y }
      }
      expect(judge('lateral', raised, world)).toEqual({ level: 'ok', reasons: [] })
    })
    it('腕が画面の左右の端（3%）から出る構図は ng（片側だけ寄っていても、反対側の腕で判定する）', () => {
      expect(kinds(judge('lateral', front({ x: 0.55 }), world))).toEqual([]) // 0.55 + 0.4 = 0.95 は枠内
      expect(kinds(judge('lateral', front({ x: 0.58 }), world))).toContain('frame:ng') // 0.99 は枠外
      expect(kinds(judge('lateral', front({ x: 0.42 }), world))).toContain('frame:ng') // 左側：0.02
    })
    it('縦横比があるとき、腕の長さは高さ単位のまま足し引きし、判定のとき x ÷ aspect で戻る', () => {
      const aspect = 0.75
      // 正規化座標で肩が中央（0.5）→ 姿勢の x は 0.5 × 0.75 = 0.375。腕 0.4（高さ単位）は正規化で 0.533 → 画面の外
      expect(kinds(judge('lateral', standing({ x: 0.375, shoulderY: 0.3, arm: 0.4 }), world, aspect))).toContain('frame:ng')
      // 腕 0.25 → 正規化で 0.333：0.5 ± 0.333 = 0.167〜0.833 で枠内
      expect(kinds(judge('lateral', standing({ x: 0.375, shoulderY: 0.3, arm: 0.25 }), world, aspect))).not.toContain('frame:ng')
    })
  })
})

describe('距離', () => {
  it('脚の種目：鼻〜足首が 0.45〜0.9 で ok。小さい→caution、<0.3 は ng、大きい→caution', () => {
    expect(LEG_DIST_MIN).toBe(0.45)
    expect(judge('squat', standing({ span: 0.46 })).level).toBe('ok')
    expect(judge('squat', standing({ span: 0.9, top: 0.04 })).level).toBe('ok')
    const small = judge('squat', standing({ span: 0.44 }))
    expect(small.level).toBe('caution')
    expect(small.reasons[0]).toMatchObject({ kind: 'distance-far', severity: 'caution', text: 'もう少し近づいてください' })
    expect(judge('squat', standing({ span: 0.31 })).level).toBe('caution')
    const tiny = judge('squat', standing({ span: 0.29 }))
    expect(tiny.level).toBe('ng')
    expect(tiny.reasons[0]).toMatchObject({ kind: 'distance-far', severity: 'ng' })
    const big = judge('squat', standing({ span: 0.92, top: 0.035 }))
    expect(big.level).toBe('caution')
    expect(big.reasons[0]).toMatchObject({ kind: 'distance-near', severity: 'caution', text: 'もう少し離れてください' })
  })

  it('rdl・bss も脚の種目の基準を使う', () => {
    for (const key of ['rdl', 'bss'] as FormExerciseKey[]) {
      expect(kinds(judge(key, standing({ span: 0.4 })))).toEqual(['distance-far:caution'])
    }
  })

  it('上半身の種目：上腕＋前腕が 0.15 以上で ok。未満は caution、<0.10 は ng。大きすぎは判定しない', () => {
    expect(ARM_DIST_MIN).toBe(0.15)
    expect(judge('bench', standing({ arm: 0.16 })).level).toBe('ok')
    expect(kinds(judge('bench', standing({ arm: 0.14 })))).toEqual(['distance-far:caution'])
    expect(kinds(judge('bench', standing({ arm: 0.09 })))).toEqual(['distance-far:ng'])
    expect(judge('bench', standing({ arm: 0.5 })).level).toBe('ok')
  })
})

describe('計測中の判定（待機中に固定した値と比べる）', () => {
  const measuring = (pose: Pose, fixed: PlacementFixed, extra: Partial<PlacementSample> = {}, key: FormExerciseKey = 'squat') =>
    judgePlacement(key, [sample(pose, { world: worldPose(0), ...extra })], { fixed })

  describe('距離：しゃがむ深さで変わらず、体節長の比で見る', () => {
    it('squat の最下点（膝 80°）で鼻が下がって鼻〜足首が縮んでも、距離で ng・caution にならない', () => {
      // 立位の体節長（太もも＋すね）。squatPose は太もも・すねとも 0.2
      const stand = squatPose(170, 10)
      const snap = standingSnapshot('squat', [sample(stand, { world: worldPose(0) })])!
      const bottom = squatPose(80, 30)
      bottom[LM.nose] = { x: 0.55, y: 0.62, z: 0, visibility: 1 } // 鼻〜足首が 0.28（待機中の判定なら ng の近さ）
      expect(kinds(judge('squat', bottom))).toContain('distance-far:ng')
      const r = measuring(bottom, { segLen: snap.segA + snap.segB })
      expect(kinds(r)).not.toContain('distance-far:ng')
      expect(kinds(r)).not.toContain('distance-far:caution')
      expect(r.level).toBe('ok')
    })
    it('体節長が待機中の 0.7〜1.3 倍なら ok、外れたら caution、0.5〜1.5 倍の外は ng', () => {
      const pose = standing() // 太もも＋すね＝ 0.3×0.7×2 = 0.42
      const seg = 0.3 * 0.7 * 2
      const at = (ratio: number) => measuring(pose, { segLen: seg / ratio })
      expect(at(1).level).toBe('ok')
      expect(at(0.71).level).toBe('ok')
      expect(at(1.29).level).toBe('ok')
      const far = at(0.69)
      expect(far.level).toBe('caution')
      expect(far.reasons[0]).toMatchObject({ kind: 'distance-far', severity: 'caution' })
      const near = at(1.31)
      expect(near.level).toBe('caution')
      expect(near.reasons[0]).toMatchObject({ kind: 'distance-near', severity: 'caution' })
      expect(kinds(at(0.49))).toEqual(['distance-far:ng'])
      expect(kinds(at(1.51))).toEqual(['distance-near:ng'])
    })
    it('腕の種目は上腕＋前腕の比で見る', () => {
      const pose = standing({ arm: 0.3 })
      expect(measuring(pose, { segLen: 0.3 }, {}, 'bench').level).toBe('ok')
      expect(kinds(measuring(pose, { segLen: 0.3 / 0.6 }, {}, 'bench'))).toEqual(['distance-far:caution'])
    })
    it('固定値が無い（動画ファイル）ときは、距離を判定しない（鼻〜足首が小さくても ng にしない）', () => {
      expect(kinds(measuring(standing({ span: 0.29 }), {}))).not.toContain('distance-far:ng')
    })
  })

  describe('傾き：計測開始時の値からのずれ（3° 以上で「スマホが動いた」ng）', () => {
    it('固定値 3° に対して、2.9° ずれまで ok、3° ずれで ng', () => {
      const fixed = { tiltDeg: 3 }
      expect(measuring(standing(), fixed, { tiltDeg: 5.9 }).level).toBe('ok')
      expect(measuring(standing(), fixed, { tiltDeg: 0.1 }).level).toBe('ok')
      const ng = measuring(standing(), fixed, { tiltDeg: 6 })
      expect(ng.level).toBe('ng')
      expect(ng.reasons[0]).toMatchObject({ kind: 'tilt', severity: 'ng', text: 'スマホが動きました' })
      expect(measuring(standing(), fixed, { tiltDeg: 0 }).level).toBe('ng')
    })
    it('揺れ 2.8〜3.2° は固定値 3° からのずれが小さいので、ずっと ok（3° の境目でちらつかない）', () => {
      for (const t of [2.8, 3.2, 2.9, 3.1, 3.0]) expect(measuring(standing(), { tiltDeg: 3 }, { tiltDeg: t }).level).toBe('ok')
    })
    it('待機中の 7° 超の ng は計測中には使わない（固定値と同じ傾きなら、大きな傾きでも ng にしない）', () => {
      expect(measuring(standing(), { tiltDeg: 9 }, { tiltDeg: 9 }).level).toBe('ok')
      // 待機中は ng のまま
      expect(judge('squat', standing(), { tiltDeg: 9 }).level).toBe('ng')
    })
    it('固定値が無い、または今の傾きが不明なら、傾きの判定をしない', () => {
      expect(measuring(standing(), {}, { tiltDeg: 20 }).level).toBe('ok')
      expect(measuring(standing(), { tiltDeg: 3 }).level).toBe('ok')
    })
  })
})

describe('向き（φ の判定をそのまま使う）', () => {
  const view = (phi: number, key: FormExerciseKey = 'squat') => judge(key, standing({ shoulderY: 0.4 }), { world: worldPose(phi) })
  it('≤15° ok、≤30° caution、>30° ng', () => {
    expect(view(15).level).toBe('ok')
    expect(view(16).level).toBe('caution')
    expect(view(30).level).toBe('caution')
    expect(kinds(view(31))).toEqual(['view:ng'])
  })
  it('caution の案内に「深さが数度ずれる可能性があります」が入る', () => {
    expect(view(20).reasons[0].text).toContain('深さが数度ずれる可能性があります')
  })
  it('lateral は正面（φ=90°）からのずれで見る', () => {
    expect(view(85, 'lateral').level).toBe('ok')
    expect(kinds(view(0, 'lateral'))).toEqual(['view:ng'])
    expect(view(0, 'lateral').reasons[0].text).toContain('正面')
  })
})

describe('スマホの水平', () => {
  const tilt = (deg: number | undefined) => judge('squat', standing(), { tiltDeg: deg })
  it('|3°| 以下 ok、|7°| 以下 caution、>7° ng。案内に傾きの角度が入る', () => {
    expect(tilt(3).level).toBe('ok')
    expect(tilt(-3).level).toBe('ok')
    const c = tilt(5)
    expect(c.level).toBe('caution')
    expect(c.reasons[0]).toMatchObject({ kind: 'tilt', severity: 'caution', text: 'スマホをまっすぐ立ててください（傾き 5°）' })
    expect(tilt(-7).level).toBe('caution')
    const ng = tilt(8)
    expect(ng.level).toBe('ng')
    expect(ng.reasons[0].text).toBe('スマホをまっすぐ立ててください（傾き 8°）')
  })
  it('不明（センサー非対応・拒否・動画ファイル）のときは判定から外す（ng にしない）', () => {
    expect(tilt(undefined)).toEqual({ level: 'ok', reasons: [] })
    // 一部のフレームにしか傾きが無くても、ある分の中央値で見る
    const r = judgePlacement('squat', [
      sample(standing(), { world: worldPose(0) }),
      sample(standing(), { world: worldPose(0), tiltDeg: 9 }),
      sample(standing(), { world: worldPose(0) }),
    ])
    expect(kinds(r)).toEqual(['tilt:ng'])
  })
})

describe('見えやすさ（映っているフレームの visibility の最小値の中央値＋映っていない割合）', () => {
  it('0.7 以上で ok、未満は caution', () => {
    expect(judge('squat', standing({ vis: 0.7 })).level).toBe('ok')
    const c = judge('squat', standing({ vis: 0.69 }))
    expect(c.level).toBe('caution')
    expect(c.reasons[0]).toMatchObject({ kind: 'visibility', severity: 'caution', text: '体全体が明るく写るようにしてください' })
  })
  it('映っているフレームだけの中央値で見る：映っていないフレームがあっても、映っている分が明るければ visibility の caution は出ない（20% 以下）', () => {
    const hid = standing({ vis: 0.1 })
    const good = standing({ vis: 0.9 })
    const r = judgePlacement('squat', [hid, good, good, good, good, good].map(p => sample(p, { world: worldPose(0) })))
    expect(r.level).toBe('ok')
  })
  it('映っていないフレームが 20% 超で caution、50% 超は hidden', () => {
    const hid = standing({ vis: 0.1 })
    const good = standing({ vis: 0.9 })
    const run = (h: number, g: number) =>
      judgePlacement('squat', [...Array(h).fill(hid), ...Array(g).fill(good)].map(p => sample(p, { world: worldPose(0) })))
    expect(run(1, 5).level).toBe('ok') // 16.7%
    const c = run(2, 8) // ちょうど 20% は caution にしない
    expect(c.level).toBe('ok')
    const over = run(3, 9) // 25%
    expect(over.level).toBe('caution')
    expect(over.reasons[0]).toMatchObject({ kind: 'visibility', severity: 'caution' })
    expect(run(5, 5).level).toBe('caution') // ちょうど半分は hidden にしない
    expect(run(6, 5).level).toBe('hidden')
  })
  it('見えやすさが 0.7 未満の中央値と映っていない割合が重なっても、visibility の案内は 1 つ', () => {
    const hid = standing({ vis: 0.1 })
    const dim = standing({ vis: 0.6 })
    const r = judgePlacement('squat', [hid, hid, dim, dim, dim].map(p => sample(p, { world: worldPose(0) })))
    expect(r.level).toBe('caution')
    expect(kinds(r)).toEqual(['visibility:caution'])
  })
})

describe('1 秒の窓（中央値）', () => {
  it('1 フレームだけ悪くても、中央値は変わらない', () => {
    const ok = sample(standing(), { world: worldPose(0) })
    const bad = sample(standing({ top: 0.0 }), { world: worldPose(0) })
    expect(judgePlacement('squat', [ok, ok, ok, bad, ok, ok, ok, ok]).level).toBe('ok')
    expect(judgePlacement('squat', [bad, bad, bad, bad, bad, ok, ok]).level).toBe('ng')
  })
  it('半分より多くが映っていなければ hidden', () => {
    const ok = sample(standing(), { world: worldPose(0) })
    const none = sample(undefined)
    expect(judgePlacement('squat', [ok, none, none]).level).toBe('hidden')
    expect(judgePlacement('squat', [ok, ok, none]).level).not.toBe('hidden')
  })
  it('reasons は悪い順（ng が先）', () => {
    const r = judge('squat', standing({ span: 0.4 }), { tiltDeg: 9 })
    expect(r.reasons.map(x => x.severity)).toEqual(['ng', 'caution'])
    expect(r.level).toBe('ng')
  })
  it('PlacementWindow は直近 1 秒だけ残す', () => {
    const w = new PlacementWindow()
    for (let t = 0; t <= 3000; t += 100) w.push({ t, pose: standing(), world: worldPose(0) })
    const ts = w.samplesNow().map(s => s.t as number)
    expect(ts[ts.length - 1] - ts[0]).toBeLessThanOrEqual(PLACEMENT_WINDOW_MS)
    expect(w.judge('squat').level).toBe('ok')
    w.clear()
    expect(w.judge('squat').level).toBe('hidden')
  })
})

describe('立位の記録（自分の基準用の値）', () => {
  it('体節長・体幹角・φ・傾きを中央値で返す。見えていなければ undefined', () => {
    const s = standingSnapshot('squat', [
      sample(standing(), { world: worldPose(10), tiltDeg: 2 }),
      sample(standing(), { world: worldPose(10), tiltDeg: 4 }),
      sample(standing(), { world: worldPose(10), tiltDeg: 3 }),
    ])!
    expect(s.segA).toBeCloseTo(0.3 * 0.7, 3)
    expect(s.segB).toBeCloseTo(0.3 * 0.7, 3)
    expect(s.trunkLeanDeg).toBeCloseTo(0, 3)
    expect(s.phiDeg).toBeCloseTo(10, 3)
    expect(s.tiltDeg).toBe(3)
    expect(s.side).toBe('left') // 左右が同じ見えやすさなら左
    const rightSide = standingSnapshot('squat', [sample(setVisibility(standing(), 'left', 0.3), { world: worldPose(10) })])!
    expect(rightSide.side).toBe('right')
    expect(standingSnapshot('squat', [sample(undefined)])).toBeUndefined()
  })

  it('保存用の要約に standing が入る', () => {
    const standingValue: StandingSnapshot = { segA: 0.2, segB: 0.2, trunkLeanDeg: 5 }
    const ctx: FormContext = { key: 'squat', exerciseId: 'e', weight: 0, history: [], standing: standingValue }
    const report = analyzeSet([rep(1)], ctx)
    expect(toSessionSummary(report, [rep(1)], ctx, '2026-11-26').standing).toEqual(standingValue)
    expect(toSessionSummary(report, [rep(1)], { ...ctx, standing: undefined }, '2026-11-26')).not.toHaveProperty('standing')
  })
})

// ---------------------------------------------------------------------------
// レップごとの撮影条件（placementOk）
// ---------------------------------------------------------------------------

function rep(index: number, o: Partial<RepResult> = {}, m: Partial<RepMetrics> = {}): RepResult {
  return {
    index, score: 80, romDeg: 100, eccentricSec: 2, concentricSec: 1, minAngle: 80, maxAngle: 170, issues: [],
    metrics: { confidence: 0.9, view: 'side', viewOk: 'ok', ...m }, ...o,
  }
}

describe('placementOk：ng のフレームが半分以上のレップ', () => {
  const frame = (placement?: MeasureFrame['placement']): MeasureFrame => ({ t: 0, visible: true, placement })
  it('半分以上が ng なら false、半分未満なら true、判定が無ければ undefined（hidden は数えない）', () => {
    expect(placementOkOf([frame('ng'), frame('ng'), frame('ok'), frame('caution')])).toBe(false) // ちょうど半分
    expect(placementOkOf([frame('ng'), frame('ok'), frame('caution')])).toBe(true)
    expect(placementOkOf([frame('ng'), frame('hidden'), frame('hidden'), frame('ok'), frame('ok')])).toBe(true)
    expect(placementOkOf([frame(), frame()])).toBeUndefined()
  })

  /** 浅いスクワット（減点される動き）を流し込む。placementAt が各フレームの判定 */
  function runShallow(placementAt: (i: number) => 'ok' | 'ng' | undefined): RepResult[] {
    const t = new RepTracker('squat')
    const frames = repPath({ top: 170, bottoms: [120, 120], downSec: 1.5, upSec: 1 })
    frames.forEach((f, i) => t.push(squatPose(f.angle, 10), f.t, undefined, { placement: placementAt(i) }))
    return t.flush()
  }

  it('ng が半分以上のレップは placementOk=false。回数は数えるが、減点されず（score 100・issues なし）、判定が無いときは減点される', () => {
    const judged = runShallow(() => undefined)
    expect(judged).toHaveLength(2)
    expect(judged.every(r => r.issues.length > 0)).toBe(true) // 比較のため：判定なしなら浅さで減点される

    const bad = runShallow(() => 'ng')
    expect(bad).toHaveLength(2)
    for (const r of bad) {
      expect(r.metrics?.placementOk).toBe(false)
      expect(r.issues).toEqual([])
      expect(r.score).toBe(100)
    }
    const good = runShallow(() => 'ok')
    expect(good.every(r => r.metrics?.placementOk === true)).toBe(true)
    expect(good.every(r => r.issues.length > 0)).toBe(true)
  })

  it('撮影条件が悪かった回は、平均点・崩れ・原因の判定から外れる（summarizeSet / analyzeSet）', () => {
    const reps = [
      rep(1, { score: 60, issues: [{ code: 'shallow', message: '', fix: '', penalty: 40 }] }, { trunkLeanMax: 40 }),
      rep(2, { score: 100 }, { placementOk: false, trunkLeanMax: 90 }),
      rep(3, { score: 100 }, { placementOk: false, trunkLeanMax: 90 }),
    ]
    const s = summarizeSet(reps, 'squat')
    expect(s.reps).toBe(3)
    expect(s.avgScore).toBe(60)
    // 外さなければ trunkLeanMax 90 は forward-lean（72° 超）になる
    const ctx: FormContext = { key: 'squat', exerciseId: 'e', weight: 0, history: [] }
    const withBad = analyzeSet(reps.map(r => ({ ...r, metrics: { ...r.metrics!, placementOk: undefined } })), ctx)
    expect(withBad.faults.map(f => f.code)).toContain('forward-lean')
    const report = analyzeSet(reps, ctx)
    expect(report.faults.map(f => f.code)).not.toContain('forward-lean')
    expect(report.overallScore).toBe(60)
  })

  it('全レップが撮影条件不良なら、点は付けず撮り直しをすすめる', () => {
    const reps = [rep(1, {}, { placementOk: false }), rep(2, {}, { placementOk: false })]
    const report = analyzeSet(reps, { key: 'squat', exerciseId: 'e', weight: 0, history: [] })
    expect(report.overallScore).toBe(0)
    expect(report.retakeReason).toContain('撮影条件')
    expect(report.faults).toEqual([])
  })
})

describe('水平が不明のとき、体幹の前傾（forward-lean）の確信度は low', () => {
  const usable = Array.from({ length: 6 }, (_, i) => ({ index: i + 1 }))
  const base: FormContext = { key: 'squat', exerciseId: 'e', weight: 60, history: [] }
  it('かかとの浮きと重なり、通常は high になる手がかりでも、不明なら low', () => {
    const known = inferCauses('forward-lean', [1, 2], usable, { ...base, tiltUnknown: false }, ['heel-lift'])
    expect(known[0]).toMatchObject({ cause: 'mobility', confidence: 'high' })
    const unknown = inferCauses('forward-lean', [1, 2], usable, { ...base, tiltUnknown: true }, ['heel-lift'])
    expect(unknown.length).toBeGreaterThan(0)
    expect(unknown.every(c => c.confidence === 'low')).toBe(true)
  })
  it('ほかの崩れの確信度は変えない', () => {
    const c = inferCauses('heel-lift', [1, 2], usable, { ...base, tiltUnknown: true }, ['forward-lean'])
    expect(c[0].confidence).toBe('high')
  })
})
