import { describe, expect, it } from 'vitest'
import { RepTracker } from './engine'
import {
  combineConfidence, judgeView, makeFrame, measureRep, meanUpwardVelocity, median, phiFromWorld,
  segmentStability, shoulderRatio, stickingAngle, upwardVelocities, velocityLossPct, viewKindFromPhi,
  viewOkFromPhi, visibilityTerm,
} from './measure'
import type { MeasureFrame, RepWindow, SetStats } from './measure'
import { SIDE_INDEX } from './rules'
import type { Joint } from './rules'
import {
  benchPose, bssPose, curlPose, lateralPose, ohextPose, ohpPose, rdlPose, repPath, setVisibility, shiftPose, squatPose, worldPose,
} from './testPoses'
import type { PathFrame } from './testPoses'
import type { FormExerciseKey, Pose, RepMetrics, RepResult } from './types'
import { LM } from './types'

const DT = 1000 / 30

/** 複数のレップの動きを時間順につなげる */
function concat(paths: { top: number; bottoms: number[]; downSec: number; upSec: number }[]): PathFrame[] {
  const out: PathFrame[] = []
  let start = 1000
  for (const p of paths) {
    const part = repPath({ ...p, startMs: start })
    out.push(...part)
    start = part[part.length - 1].t + DT
  }
  return out
}

function runAll(
  key: FormExerciseKey,
  frames: PathFrame[],
  make: (f: PathFrame, i: number) => Pose,
  world?: (f: PathFrame, i: number) => Pose | undefined,
): RepResult[] {
  const t = new RepTracker(key)
  let reps: RepResult[] = []
  frames.forEach((f, i) => {
    reps = t.push(make(f, i), f.t, world?.(f, i)).reps
  })
  return reps
}

/** 最下点（最後に最小角度だった生フレーム）の番号 */
const lastBottomIndex = (frames: PathFrame[]) => {
  const min = Math.min(...frames.map((f) => f.angle))
  return frames.map((f) => f.angle).lastIndexOf(min)
}

const m = (r: RepResult): RepMetrics => r.metrics as RepMetrics

describe('median', () => {
  it('奇数個は真ん中、偶数個は中央2つの平均、空は undefined', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeUndefined()
  })
})

describe('信頼度', () => {
  const ptsOf = (pose: Pose): Partial<Record<Joint, (typeof pose)[number]>> => {
    const out: Partial<Record<Joint, (typeof pose)[number]>> = {}
    for (const j of ['shoulder', 'hip', 'knee', 'ankle'] as Joint[]) out[j] = pose[SIDE_INDEX.left[j]]
    return out
  }
  /** n フレーム分のスクワット（膝 100° で静止）。invisible の番号は見えなかったフレーム */
  const frames = (n: number, pose: Pose = squatPose(100, 20), invisible: number[] = []): MeasureFrame[] =>
    Array.from({ length: n }, (_, i): MeasureFrame =>
      invisible.includes(i)
        ? { t: i * 100, visible: false }
        : makeFrame('squat', {
          t: i * 100, side: 'left', pts: ptsOf(pose), pose, angle: 100, angles: { knee: 100, torso: 20 },
        }))
  const setOf = (fs: MeasureFrame[]): SetStats => ({
    segA: fs.flatMap((f) => (f.segA !== undefined ? [f.segA] : [])),
    segB: fs.flatMap((f) => (f.segB !== undefined ? [f.segB] : [])),
    worldLen: [],
    firstVelocities: [],
  })
  const win: RepWindow = { startT: 0, minT: 500, endT: 900 }

  it('visibility の項：0.5 → 0.5、0.65 → 0.75、0.8 以上 → 1', () => {
    expect(visibilityTerm(0.5)).toBeCloseTo(0.5, 5)
    expect(visibilityTerm(0.65)).toBeCloseTo(0.75, 5)
    expect(visibilityTerm(0.8)).toBeCloseTo(1, 5)
    expect(visibilityTerm(0.95)).toBe(1)
  })

  it('全部が良い条件なら 1.00（visibility 1、真横、体節長が安定、欠損なし）', () => {
    const fs = frames(10)
    expect(measureRep('squat', fs, win, setOf(fs)).metrics.confidence).toBe(1)
  })

  it('visibility が 0.65 なら 0.75', () => {
    const pose = setVisibility(setVisibility(squatPose(100, 20), 'left', 0.65), 'right', 0.65)
    const fs = frames(10, pose)
    expect(measureRep('squat', fs, win, setOf(fs)).metrics.confidence).toBe(0.75)
  })

  it('見えなかったフレームが 10 枚中 2 枚なら、欠損の項 0.8', () => {
    const fs = frames(10, squatPose(100, 20), [3, 4])
    expect(measureRep('squat', fs, win, setOf(fs)).metrics.confidence).toBe(0.8)
  })

  it('体節長の項：中央値の 0.85〜1.15 倍に入るフレームが 9/10 なら 0.9（境界の 1.15 倍は入る）', () => {
    const fs = frames(10)
    const set = setOf(fs)
    fs[0] = { ...fs[0], segA: (fs[0].segA as number) * 1.3 }
    expect(measureRep('squat', fs, win, set).metrics.confidence).toBe(0.9)
    expect(segmentStability([{ t: 0, visible: true, segA: 1.15, segB: 0.85 }], 1, 1)).toBe(1)
    expect(segmentStability([{ t: 0, visible: true, segA: 1.16, segB: 1 }], 1, 1)).toBe(0)
    expect(segmentStability([{ t: 0, visible: true, segA: 1, segB: 0.84 }], 1, 1)).toBe(0)
    expect(segmentStability([], 1, 1)).toBe(0)
  })

  it('各項の積：0.75 × caution 0.8 × 0.9 × (1 − 0.2) = 0.432 → 0.43、ng は 0.4 倍', () => {
    expect(combineConfidence(0.75, 'caution', 0.9, 0.2)).toBe(0.43)
    expect(combineConfidence(1, 'ng', 1, 0)).toBe(0.4)
    expect(combineConfidence(1, 'ok', 1, 0)).toBe(1)
  })
})

describe('撮影角度', () => {
  it('world：肩の線の向きから真横からのずれ φ を出す', () => {
    expect(phiFromWorld(worldPose(0))).toBeCloseTo(0, 5)
    expect(phiFromWorld(worldPose(20))).toBeCloseTo(20, 5)
    expect(phiFromWorld(worldPose(40))).toBeCloseTo(40, 5)
    expect(phiFromWorld(worldPose(90))).toBeCloseTo(90, 5)
  })

  it('φ ≤ 15° ok、15〜30° caution、> 30° ng。向きは ≤ 30° side、≥ 60° front、その間 oblique', () => {
    expect(viewOkFromPhi(15)).toBe('ok')
    expect(viewOkFromPhi(15.1)).toBe('caution')
    expect(viewOkFromPhi(30)).toBe('caution')
    expect(viewOkFromPhi(30.1)).toBe('ng')
    expect(viewKindFromPhi(30)).toBe('side')
    expect(viewKindFromPhi(45)).toBe('oblique')
    expect(viewKindFromPhi(60)).toBe('front')
  })

  /** 肩・股関節の x だけを指定した 2D 姿勢（肩幅 ÷ 胴 = width ÷ 0.25） */
  const torsoPose = (width: number): Pose => {
    const p = squatPose(170, 0).map((q) => ({ ...q }))
    p[LM.leftShoulder] = { ...p[LM.leftShoulder], x: 0.5 - width / 2, y: 0.3 }
    p[LM.rightShoulder] = { ...p[LM.rightShoulder], x: 0.5 + width / 2, y: 0.3 }
    p[LM.leftHip] = { ...p[LM.leftHip], x: 0.5, y: 0.55 }
    p[LM.rightHip] = { ...p[LM.rightHip], x: 0.5, y: 0.55 }
    return p
  }
  const frameOf = (pose: Pose, world?: Pose): MeasureFrame => ({ t: 0, visible: true, pose, world })

  it('world なし：肩幅 ÷ 胴の長さが 0.25 未満 side、0.6 以上 front、その間 oblique', () => {
    expect(shoulderRatio(torsoPose(0.0625))).toBeCloseTo(0.25, 5)
    expect(judgeView([frameOf(torsoPose(0.05))])).toEqual({ view: 'side', viewOk: 'ok' }) // 0.2
    expect(judgeView([frameOf(torsoPose(0.1))]).view).toBe('oblique') // 0.4
    expect(judgeView([frameOf(torsoPose(0.1))]).viewOk).toBe('caution')
    expect(judgeView([frameOf(torsoPose(0.16))]).view).toBe('front') // 0.64
    expect(judgeView([frameOf(torsoPose(0.2))]).viewOk).toBe('ng') // 0.8
  })

  it('world があれば world を優先する（2D は側面でも φ=40° なら ng）', () => {
    const j = judgeView([frameOf(torsoPose(0.05), worldPose(40))])
    expect(j.view).toBe('oblique')
    expect(j.viewOk).toBe('ng')
    expect(j.phi).toBe(40)
  })

  it('姿勢が測れないときは unknown / caution', () => {
    expect(judgeView([{ t: 0, visible: true }])).toEqual({ view: 'unknown', viewOk: 'caution' })
  })

  it('RepTracker：world あり φ=20° → 信頼度 0.8、φ=40° → 0.4、φ=10° → 1.0、world なし（真横）→ 1.0', () => {
    const frames = concat([{ top: 170, bottoms: [70], downSec: 1.5, upSec: 1 }])
    const conf = (phi?: number) => {
      const reps = runAll('squat', frames, (f) => squatPose(f.angle, 20), phi === undefined ? undefined : () => worldPose(phi))
      expect(reps).toHaveLength(1)
      return m(reps[0])
    }
    expect(conf(20)).toMatchObject({ confidence: 0.8, viewOk: 'caution', view: 'side' })
    expect(conf(40)).toMatchObject({ confidence: 0.4, viewOk: 'ng', view: 'oblique' })
    expect(conf(10)).toMatchObject({ confidence: 1, viewOk: 'ok' })
    expect(conf()).toMatchObject({ confidence: 1, viewOk: 'ok', view: 'side' })
  })
})

describe('速度', () => {
  it('中央差分：y が 0.8 → 0.7 → 0.5（0, 0.5, 1 秒）なら、真ん中の上向き速度は 0.3/秒', () => {
    const v = upwardVelocities([
      { t: 0, y: 0.8, angle: 70 }, { t: 500, y: 0.7, angle: 90 }, { t: 1000, y: 0.5, angle: 110 },
    ])
    expect(v).toHaveLength(1)
    expect(v[0].v).toBeCloseTo(0.3, 5)
    expect(v[0].angle).toBe(90)
  })

  it('区間の平均速度は始点と終点の位置から出す（0.8 → 0.5 を 1 秒 = 0.3/秒）', () => {
    const s = [
      { t: 0, y: 0.8, angle: 0 }, { t: 500, y: 0.7, angle: 0 }, { t: 1000, y: 0.5, angle: 0 },
    ]
    expect(meanUpwardVelocity(s, 0, 1000)).toBeCloseTo(0.3, 5)
    expect(meanUpwardVelocity(s, 500, 1000)).toBeCloseTo(0.4, 5)
    expect(meanUpwardVelocity(s, 0, 0)).toBeUndefined()
  })

  it('velocityLossPct：基準 1.0 に対して 0.6 なら 40%、基準より速ければ 0', () => {
    expect(velocityLossPct(0.6, 1)).toBe(40)
    expect(velocityLossPct(1.2, 1)).toBe(0)
    expect(velocityLossPct(0.5, 0)).toBe(0)
  })

  it('RepTracker：上げる時間 1 秒 → 2 秒のレップで、速度は半分、velocityLossPct は 0 → 約 50%', () => {
    const frames = concat([
      { top: 170, bottoms: [70], downSec: 1.5, upSec: 1 },
      { top: 170, bottoms: [70], downSec: 1.5, upSec: 2 },
    ])
    const reps = runAll('squat', frames, (f) => squatPose(f.angle, 20), () => worldPose(5))
    expect(reps).toHaveLength(2)
    expect(m(reps[0]).velocityLossPct).toBe(0)
    expect(Math.abs((m(reps[1]).velocityLossPct as number) - 50)).toBeLessThan(5)
    // 1 レップ目：腰が約 0.26 上がるのに約 0.93 秒 → 0.28/秒 ÷ 脚の長さ 0.4 = 0.7 体節/秒 × world の脚 0.8m ≒ 0.56 m/s
    const v1 = m(reps[0]).concentricVelocity as number
    expect(v1).toBeGreaterThan(0.5)
    expect(v1).toBeLessThan(0.62)
    expect(m(reps[1]).concentricVelocity as number).toBeCloseTo(v1 / 2, 1)
  })

  it('world が無いときは concentricVelocity を出さず、velocityLossPct だけ出す', () => {
    const frames = concat([
      { top: 170, bottoms: [70], downSec: 1.5, upSec: 1 },
      { top: 170, bottoms: [70], downSec: 1.5, upSec: 2 },
    ])
    const reps = runAll('squat', frames, (f) => squatPose(f.angle, 20))
    expect(m(reps[1]).concentricVelocity).toBeUndefined()
    expect(m(reps[1]).velocityLossPct).toBeGreaterThan(40)
  })

  it('3レップ目は最初の2レップの最大が基準（4レップ目が1レップ目と同じ速さなら 0）', () => {
    const fast = { top: 170, bottoms: [70], downSec: 1.5, upSec: 1 }
    const slow = { ...fast, upSec: 2 }
    const reps = runAll('squat', concat([fast, slow, slow, fast]), (f) => squatPose(f.angle, 20))
    expect(reps).toHaveLength(4)
    expect(m(reps[2]).velocityLossPct).toBeGreaterThan(40)
    expect(m(reps[3]).velocityLossPct).toBeLessThan(5)
  })

  describe('スティッキングポイント', () => {
    const vp = (v: number[]) => v.map((x, i) => ({ t: i * 100, v: x, angle: 70 + i * 10 }))
    it('最初の速度ピークの後の最初の極小の角度を返す', () => {
      // ピーク 1.0（i=4）→ 0.4（i=6、角度 130）まで落ちて 0.55 以上に戻る
      expect(stickingAngle(vp([0, 0.2, 0.5, 0.8, 1.0, 0.7, 0.4, 0.55, 0.8, 1.0, 1.1]))).toBe(130)
    })
    it('速度が下がり続けるだけ（戻らない）なら undefined、ピークが無くても undefined', () => {
      expect(stickingAngle(vp([0, 0.5, 1, 0.8, 0.5, 0.2]))).toBeUndefined()
      expect(stickingAngle(vp([0.2, 0.4, 0.6, 0.8, 1]))).toBeUndefined()
      expect(stickingAngle([])).toBeUndefined()
    })
    it('ピークの 10% 未満の揺れは無視する', () => {
      expect(stickingAngle(vp([0, 0.5, 1, 0.95, 1, 0.5, 0.2, 0.4, 0.6]))).toBe(130)
    })

    it('RepTracker：上げる途中で一度ゆっくりになる動きで、その区間の角度が出る', () => {
      // 70° から 94° までは 1 フレーム 4°、94〜99° は 1°、99° 以降はまた 4°
      const angles: number[] = []
      for (let i = 0; i < 15; i++) angles.push(170)
      for (let i = 1; i <= 45; i++) angles.push(170 - (100 * i) / 45)
      for (let i = 0; i < 6; i++) angles.push(70)
      for (let a = 74; a <= 94; a += 4) angles.push(a)
      for (let a = 95; a <= 99; a += 1) angles.push(a)
      for (let a = 103; a <= 175; a += 4) angles.push(a)
      for (let i = 0; i < 10; i++) angles.push(175)
      const frames: PathFrame[] = angles.map((angle, i) => ({ t: 1000 + i * DT, angle, progress: 0 }))
      const reps = runAll('squat', frames, (f) => squatPose(f.angle, 20))
      expect(reps).toHaveLength(1)
      const s = m(reps[0]).stickingAngle as number
      expect(s).toBeGreaterThanOrEqual(94)
      expect(s).toBeLessThanOrEqual(100)
    })
  })
})

describe('squat の指標', () => {
  const frames = concat([{ top: 170, bottoms: [70], downSec: 1.5, upSec: 1 }])
  const one = (make: (f: PathFrame) => Pose) => {
    const reps = runAll('squat', frames, (f) => make(f))
    expect(reps).toHaveLength(1)
    return m(reps[0])
  }

  it('膝屈曲・体幹前傾・すね前傾・股関節モーメントの割合を、最下点の姿勢から手計算どおりに出す', () => {
    // 最下点 膝 70°、体幹 20°、すね鉛直。
    // 股関節 x = 0.5 − 0.2·sin70° = 0.312061、肩 x = 0.312061 + 0.25·sin20° = 0.397566、膝 x = 0.5
    // 股関節までの水平距離 0.085505、膝まで 0.102434 → 割合 0.085505 / 0.187939 = 0.455 → 0.45
    const x = one((f) => squatPose(f.angle, 20))
    expect(x.kneeFlexionBottom).toBeCloseTo(110, 0)
    expect(x.trunkLeanMax).toBeCloseTo(20, 0)
    expect(x.shinLeanBottom).toBeCloseTo(0, 0)
    expect(x.trunkLeanBottom).toBeCloseTo(20, 0)
    expect(x.hipMomentShare).toBeCloseTo(0.45, 2)
    expect(x.heelLift).toBe(0)
    expect(x.kneeValgusDeg).toBeUndefined() // 正面ではない
    expect(x.timeInStretch).toBeGreaterThan(0)
    expect(x.timeInStretch).toBeLessThan(1)
  })

  it('体幹の前傾はレップ中の最大（20° → 50° と増えれば 50°）', () => {
    const x = one((f) => squatPose(f.angle, 20 + 30 * f.progress))
    expect(x.trunkLeanMax).toBeCloseTo(50, 0)
    // 最下点の前傾（trunkLeanBottom）は、最も曲がったフレームの値
    expect(x.trunkLeanBottom).toBeGreaterThan(40)
    expect(x.trunkLeanBottom).toBeLessThanOrEqual(x.trunkLeanMax as number)
  })

  it('すねが 10° 前傾していれば shinLeanBottom は 10°、膝屈曲は変わらず 110°', () => {
    const x = one((f) => squatPose(f.angle, 20, { shinLean: 10 }))
    expect(x.shinLeanBottom).toBeCloseTo(10, 0)
    expect(x.kneeFlexionBottom).toBeCloseTo(110, 0)
  })

  it('かかとが 0.04 浮けば、脚の長さ 0.4 に対して 0.1', () => {
    const x = one((f) => squatPose(f.angle, 20, { heelLift: 0.04 * f.progress }))
    expect(x.heelLift).toBeCloseTo(0.1, 3)
  })

  it('膝の倒れ込み：正面（肩幅 ÷ 胴 ≥ 0.6）で、膝が内側なら正、外側なら負。真横では出さない', () => {
    // 股関節 (0.40,0.5)、膝 (0.45,0.7)、足首 (0.40,0.9)：膝が体の中心（x=0.5）側に 0.05 寄る
    // 投影角 = 180° − 2·atan(0.05/0.2) = 151.93° → ずれ 28.07°
    const front = (kneeX: number): Pose => {
      const p = squatPose(100, 0).map((q) => ({ ...q }))
      p[LM.leftShoulder] = { ...p[LM.leftShoulder], x: 0.4, y: 0.3 }
      p[LM.rightShoulder] = { ...p[LM.rightShoulder], x: 0.6, y: 0.3 }
      p[LM.leftHip] = { ...p[LM.leftHip], x: 0.4, y: 0.5 }
      p[LM.rightHip] = { ...p[LM.rightHip], x: 0.6, y: 0.5 }
      p[LM.leftKnee] = { ...p[LM.leftKnee], x: kneeX, y: 0.7 }
      p[LM.leftAnkle] = { ...p[LM.leftAnkle], x: 0.4, y: 0.9 }
      return p
    }
    const run3 = (pose: Pose) => {
      const pts = {
        shoulder: pose[LM.leftShoulder], hip: pose[LM.leftHip], knee: pose[LM.leftKnee], ankle: pose[LM.leftAnkle],
      }
      const fs = [0, 1, 2].map((i) => makeFrame('squat', {
        t: i * 100, side: 'left', pts, pose, angle: 100, angles: { knee: 100, torso: 0 },
      }))
      const set: SetStats = {
        segA: fs.map((f) => f.segA as number), segB: fs.map((f) => f.segB as number), worldLen: [], firstVelocities: [],
      }
      return measureRep('squat', fs, { startT: 0, minT: 100, endT: 200 }, set).metrics
    }
    const inward = run3(front(0.45))
    expect(inward.view).toBe('front')
    expect(inward.kneeValgusDeg).toBeCloseTo(28.1, 1)
    expect(run3(front(0.35)).kneeValgusDeg).toBeCloseTo(-28.1, 1)
    expect(run3(squatPose(100, 20)).kneeValgusDeg).toBeUndefined()
  })
})

describe('bench の指標', () => {
  const down = { top: 170, bottoms: [60], downSec: 1.5, upSec: 1 }

  it('barPathDrift：1レップ目は 0、2レップ目が 0.05 横にずれていれば、前腕 0.2 に対して 0.25', () => {
    const frames = concat([down, down])
    const half = repPath({ ...down, startMs: 1000 }).length
    const reps = runAll('bench', frames, (f, i) => (i < half ? benchPose(f.angle) : shiftPose(benchPose(f.angle), 0.05)))
    expect(reps).toHaveLength(2)
    expect(m(reps[0]).barPathDrift).toBe(0)
    expect(m(reps[1]).barPathDrift).toBeCloseTo(0.25, 2)
  })

  it('同じ軌道なら 2 レップ目も 0', () => {
    const reps = runAll('bench', concat([down, down]), (f) => benchPose(f.angle))
    expect(m(reps[1]).barPathDrift).toBeCloseTo(0, 3)
  })

  it('hipRise：上げる動作で腰が 0.05 上がれば、最下点の胴 0.25 に対して 0.2。上がらなければ 0', () => {
    const frames = concat([down])
    const bottom = lastBottomIndex(frames)
    const make = (rise: number) => (f: PathFrame, i: number) => {
      const p = benchPose(f.angle).map((q) => ({ ...q }))
      const y = i > bottom ? 0.65 - rise : 0.65
      p[LM.leftHip] = { x: 0.4, y, z: 0, visibility: 1 }
      p[LM.rightHip] = { x: 0.4, y, z: 0, visibility: 1 }
      return p
    }
    const up = runAll('bench', frames, make(0.05))
    expect(up).toHaveLength(1)
    expect(m(up[0]).hipRise).toBeCloseTo(0.2, 2)
    expect(m(runAll('bench', frames, make(0))[0]).hipRise).toBe(0)
  })

  it('肘が 100° 以下にいた時間の割合 timeInStretch が出る', () => {
    const reps = runAll('bench', concat([down]), (f) => benchPose(f.angle))
    expect(m(reps[0]).timeInStretch).toBeGreaterThan(0)
    expect(m(reps[0]).timeInStretch).toBeLessThan(1)
  })
})

describe('curl の指標', () => {
  const path = { top: 165, bottoms: [40], downSec: 1.2, upSec: 2.5 }

  it('upperArmRange：上腕が 10° → 40° に動けば 30°。torsoRange：体幹が 3° → 28° なら 25°', () => {
    const frames = concat([path])
    const bottom = lastBottomIndex(frames)
    const reps = runAll('curl', frames, (f, i) => curlPose(f.angle, i <= bottom ? 10 : 40, i <= bottom ? 3 : 28))
    expect(reps).toHaveLength(1)
    expect(m(reps[0]).upperArmRange).toBeCloseTo(30, 0)
    expect(m(reps[0]).torsoRange).toBeCloseTo(25, 0)
  })

  it('shoulderAngleAtBottom：伸ばしきりで上腕が体幹より前なら +、後ろなら −', () => {
    const frames = concat([path])
    const fwd = runAll('curl', frames, (f) => curlPose(f.angle, 10, 3))
    expect(m(fwd[0]).shoulderAngleAtBottom).toBeCloseTo(10, 0)
    expect(m(fwd[0]).upperArmRange).toBeCloseTo(0, 0)
    const back = runAll('curl', frames, (f) => curlPose(f.angle, -15, 3))
    expect(m(back[0]).shoulderAngleAtBottom).toBeCloseTo(-15, 0)
  })

  it('体が左向きでも、前を + で出す', () => {
    const frames = concat([path])
    const mirror = (p: Pose): Pose => p.map((q) => ({ ...q, x: 1 - q.x }))
    const reps = runAll('curl', frames, (f) => mirror(curlPose(f.angle, 10, 3)))
    expect(m(reps[0]).shoulderAngleAtBottom).toBeCloseTo(10, 0)
  })

  it('curl は伸張域がレップの外にあるので timeInStretch は出さない。squat/bench 用の指標も出ない', () => {
    const x = m(runAll('curl', concat([path]), (f) => curlPose(f.angle, 10, 3))[0])
    expect(x.timeInStretch).toBeUndefined()
    expect(x.kneeFlexionBottom).toBeUndefined()
    expect(x.barPathDrift).toBeUndefined()
  })
})

describe('追加6種目の指標', () => {
  const path = { top: 170, bottoms: [80], downSec: 1.5, upSec: 1.5 }
  const frames = concat([path])
  /** 深い位置（主関節 100° 未満）にいるフレームか */
  const deep = (f: PathFrame) => f.angle < 100
  const latPath = concat([{ top: 170, bottoms: [80], downSec: 1.2, upSec: 1.5 }])

  it('rdl：最下点の股関節屈曲 = 180 − 股関節角、膝の内角を出す（膝一定なら 165°、曲げすぎなら 120°）', () => {
    const rdlPath = concat([{ ...path, bottoms: [95] }])
    const reps = runAll('rdl', rdlPath, (f) => rdlPose(f.angle, 165))
    expect(reps).toHaveLength(1)
    expect(reps[0].minAngle).toBeCloseTo(95, 0)
    expect(m(reps[0]).hipFlexionBottom).toBeCloseTo(85, 0)
    expect(m(reps[0]).kneeAngleBottom).toBeCloseTo(165, 0)
    const bent = runAll('rdl', rdlPath, (f) => rdlPose(f.angle, 120))
    expect(m(bent[0]).kneeAngleBottom).toBeCloseTo(120, 0)
    expect(m(bent[0]).hipFlexionBottom).toBeCloseTo(85, 0)
    // squat 用の指標・伸張滞在率は出さない
    expect(m(reps[0]).kneeFlexionBottom).toBeUndefined()
    expect(m(reps[0]).timeInStretch).toBeUndefined()
  })

  it('ohp：肘の屈曲 = 180 − 最小角、後傾の最大と開始時の後傾（反りの増加）を出す', () => {
    const reps = runAll('ohp', frames, (f) => ohpPose(f.angle, deep(f) ? 25 : 5))
    expect(reps).toHaveLength(1)
    expect(m(reps[0]).elbowFlexionBottom).toBeCloseTo(100, 0)
    expect(m(reps[0]).trunkLeanBack).toBeCloseTo(25, 0)
    expect(m(reps[0]).trunkLeanBackBaseline).toBeCloseTo(5, 0)
  })

  it('ohp：前傾は後傾 0 とする。体が左向きでも後ろへの反りを出す', () => {
    const fwd = runAll('ohp', frames, (f) => ohpPose(f.angle, -10))
    expect(m(fwd[0]).trunkLeanBack).toBe(0)
    expect(m(fwd[0]).trunkLeanBackBaseline).toBe(0)
    const mirror = (p: Pose): Pose => p.map((q) => ({ ...q, x: 1 - q.x }))
    const left = runAll('ohp', frames, (f) => mirror(ohpPose(f.angle, deep(f) ? 25 : 5)))
    expect(m(left[0]).trunkLeanBack).toBeCloseTo(25, 0)
  })

  it('lateral：左右の大きい方の外転で数え、最大外転・左右差・体幹の振れを出す（正面で ok）', () => {
    const reps = runAll('lateral', latPath, (f) => lateralPose(180 - f.angle, 180 - f.angle - (deep(f) ? 20 : 0), deep(f) ? 20 : 0))
    expect(reps).toHaveLength(1)
    // 主関節 = 180 − 大きい方（左）の外転
    expect(reps[0].minAngle).toBeCloseTo(80, 0)
    expect(m(reps[0]).abductionTop).toBeCloseTo(100, 0)
    expect(m(reps[0]).abductionAsymmetry).toBeCloseTo(20, 0)
    expect(m(reps[0]).torsoRange).toBeCloseTo(20, 0)
    expect(m(reps[0]).view).toBe('front')
    expect(m(reps[0]).viewOk).toBe('ok')
  })

  it('lateral：右腕の方が高く上がるときは右の外転で数える。左右が同じなら左右差 0、上体が動かなければ振れ 0', () => {
    const r = runAll('lateral', latPath, (f) => lateralPose(180 - f.angle - 15, 180 - f.angle))
    expect(r[0].minAngle).toBeCloseTo(80, 0)
    expect(m(r[0]).abductionTop).toBeCloseTo(100, 0)
    const even = runAll('lateral', latPath, (f) => lateralPose(180 - f.angle))
    expect(m(even[0]).abductionAsymmetry).toBeCloseTo(0, 0)
    expect(m(even[0]).torsoRange).toBeCloseTo(0, 0)
  })

  it('lateral：撮影の向きは正面が ok、真横が ng（world あり φ=0 は真横、φ=90 は正面）', () => {
    const side = runAll('lateral', latPath, (f) => lateralPose(180 - f.angle), () => worldPose(0))
    expect(m(side[0]).view).toBe('side')
    expect(m(side[0]).viewOk).toBe('ng')
    const front = runAll('lateral', latPath, (f) => lateralPose(180 - f.angle), () => worldPose(85))
    expect(m(front[0]).view).toBe('front')
    expect(m(front[0]).viewOk).toBe('ok')
    const slant = runAll('lateral', latPath, (f) => lateralPose(180 - f.angle), () => worldPose(65))
    expect(m(slant[0]).viewOk).toBe('caution')
  })

  it('pulldown：後傾の最大・体幹の振れ・上で伸ばしきったときの肘の内角を出す', () => {
    const pd = concat([{ top: 170, bottoms: [60], downSec: 1.5, upSec: 1.5 }])
    const reps = runAll('pulldown', pd, (f) => ohpPose(f.angle, deep(f) ? 20 : 5))
    expect(reps).toHaveLength(1)
    expect(m(reps[0]).trunkLeanBack).toBeCloseTo(20, 0)
    expect(m(reps[0]).torsoRange).toBeCloseTo(15, 0)
    expect(m(reps[0]).elbowExtensionTop).toBeCloseTo(170, 0)
    expect(m(reps[0]).trunkLeanBackBaseline).toBeUndefined()
  })

  it('pulldown：上で 160° までしか伸ばさないと elbowExtensionTop は 160°', () => {
    const pd = concat([{ top: 160, bottoms: [60], downSec: 1.5, upSec: 1.5 }])
    const reps = runAll('pulldown', pd, (f) => ohpPose(f.angle))
    expect(reps).toHaveLength(1)
    expect(m(reps[0]).elbowExtensionTop).toBeCloseTo(160, 0)
  })

  it('pulldown：上で 140° までしか伸ばさないレップも数え、elbowExtensionTop は 140°（基準なしの partial-top の判定用）', () => {
    const pd = concat([{ top: 140, bottoms: [60], downSec: 1.5, upSec: 1.5 }])
    const reps = runAll('pulldown', pd, (f) => ohpPose(f.angle))
    expect(reps).toHaveLength(1)
    expect(m(reps[0]).elbowExtensionTop).toBeCloseTo(140, 0)
  })

  it('pulldown：手首が下がる動作が上げる（concentric）動作。2 レップ目が 2 倍遅ければ速度低下 約 50%', () => {
    const pd = concat([
      { top: 170, bottoms: [60], downSec: 1, upSec: 1 },
      { top: 170, bottoms: [60], downSec: 2, upSec: 1 },
    ])
    const reps = runAll('pulldown', pd, (f) => ohpPose(f.angle))
    expect(reps).toHaveLength(2)
    expect(m(reps[0]).velocityLossPct).toBe(0)
    // pulldown の top を 130° に下げたため、計測区間（130° 未満）が短くなりフレームの刻みの影響が増える。許容を 8 → 12 に広げた（2026-11-26）
    expect(Math.abs((m(reps[1]).velocityLossPct as number) - 50)).toBeLessThan(12)
  })

  it('ohext：肘の屈曲 = 180 − 最小角、上腕の振れ（鉛直からの角度の範囲）を出す', () => {
    const still = runAll('ohext', frames, (f) => ohextPose(f.angle, 0))
    expect(still).toHaveLength(1)
    expect(m(still[0]).elbowFlexionBottom).toBeCloseTo(100, 0)
    expect(m(still[0]).upperArmRange).toBeCloseTo(0, 0)
    const drift = runAll('ohext', frames, (f) => ohextPose(f.angle, deep(f) ? 10 : -5))
    expect(m(drift[0]).upperArmRange).toBeCloseTo(15, 0)
    expect(m(drift[0]).elbowFlexionBottom).toBeCloseTo(100, 0)
  })

  it('bss：前脚の膝の屈曲と体幹の前傾の最大を出す（前脚が右でも左でも）', () => {
    for (const side of ['left', 'right'] as const) {
      const reps = runAll('bss', frames, (f) => bssPose(f.angle, deep(f) ? 25 : 5, side))
      expect(reps).toHaveLength(1)
      expect(reps[0].minAngle).toBeCloseTo(80, 0)
      expect(m(reps[0]).kneeFlexionBottom).toBeCloseTo(100, 0)
      expect(m(reps[0]).trunkLeanMax).toBeCloseTo(25, 0)
    }
  })

  it('bss：後ろ脚の方が visibility が高くても、足首が前にある脚を前脚にする', () => {
    // 前脚＝右（visibility 0.7）、後ろ脚＝左（visibility 1）
    const reps = runAll('bss', frames, (f) => bssPose(f.angle, 5, 'right', { visLeft: 1, visRight: 0.7 }))
    expect(reps).toHaveLength(1)
    expect(reps[0].minAngle).toBeCloseTo(80, 0)
  })

  it('bss：鼻が見えず向きが分からないときは visibility の高い方の脚を使う', () => {
    const p = bssPose(150, 5, 'right', { visLeft: 1, visRight: 0.7 })
    p[LM.nose] = { ...p[LM.nose], visibility: 0 }
    // 左（後ろ脚）の膝の内角は約 116°、前脚（右）は 150°
    expect(new RepTracker('bss').push(p, 0).angles.knee).toBeLessThan(130)
    const withNose = bssPose(150, 5, 'right', { visLeft: 1, visRight: 0.7 })
    expect(new RepTracker('bss').push(withNose, 0).angles.knee).toBeCloseTo(150, 0)
  })

  it('新6種目は squat・bench・curl 専用の指標を出さない', () => {
    const x = m(runAll('ohp', frames, (f) => ohpPose(f.angle))[0])
    expect(x.kneeFlexionBottom).toBeUndefined()
    expect(x.barPathDrift).toBeUndefined()
    expect(x.shoulderAngleAtBottom).toBeUndefined()
    expect(x.timeInStretch).toBeUndefined()
  })
})

describe('RepTracker と metrics', () => {
  it('全レップに metrics が付き、world を渡さなくても動く', () => {
    const reps = runAll('squat', concat([{ top: 170, bottoms: [70, 70], downSec: 1.5, upSec: 1 }]), (f) => squatPose(f.angle, 20))
    expect(reps).toHaveLength(2)
    for (const r of reps) {
      expect(r.metrics).toBeDefined()
      expect(m(r).confidence).toBeGreaterThan(0.9)
    }
  })

  it('reset の後は、セットの統計（1レップ目の軌道・速度の基準）も捨てる', () => {
    const t = new RepTracker('bench')
    const frames = concat([{ top: 170, bottoms: [60], downSec: 1.5, upSec: 1 }])
    for (const f of frames) t.push(benchPose(f.angle), f.t)
    t.reset()
    let reps: RepResult[] = []
    for (const f of frames) reps = t.push(shiftPose(benchPose(f.angle), 0.1), f.t).reps
    expect(reps).toHaveLength(1)
    expect(m(reps[0]).barPathDrift).toBe(0)
  })

  it('reset の後の1レップ目は、前のセットの速度に関係なく velocityLossPct が 0', () => {
    const t = new RepTracker('squat')
    const fast = concat([{ top: 170, bottoms: [70], downSec: 1.5, upSec: 1 }])
    for (const f of fast) t.push(squatPose(f.angle, 20), f.t)
    t.reset()
    const slow = concat([{ top: 170, bottoms: [70], downSec: 1.5, upSec: 3 }])
    let reps: RepResult[] = []
    for (const f of slow) reps = t.push(squatPose(f.angle, 20), f.t).reps
    expect(reps).toHaveLength(1)
    expect(m(reps[0]).velocityLossPct).toBe(0)
  })
})
