import { describe, expect, it } from 'vitest'
import { jointAngle, tiltFromVertical } from './geometry'
import { RepTracker } from './engine'
import { correctTilt, imageTilt, needsTiltCorrection, rotatePose, tiltFromOrientation, tiltLevel } from './tilt'
import { squatPose } from './testPoses'
import { LM } from './types'

describe('tiltFromOrientation（スマホの傾き）', () => {
  it('縦持ちで立てていれば 0°（beta=90 付近は gamma がずれても傾きにしない）', () => {
    expect(tiltFromOrientation(90, 0)).toBeCloseTo(0, 5)
    expect(tiltFromOrientation(90, 3)).toBeCloseTo(0, 5)
    // 前後に少し倒れていても、画面の回転方向の傾きではない
    expect(tiltFromOrientation(80, 0)).toBeCloseTo(0, 5)
  })

  it('画面の回転方向に傾けた分が出る（beta=90−ψ, gamma=−90 が、立てたまま ψ だけ回した姿勢）', () => {
    expect(tiltFromOrientation(85, -90)).toBeCloseTo(5, 5)
    expect(tiltFromOrientation(95, -90)).toBeCloseTo(-5, 5)
  })

  it('横持ち（screen.orientation.angle=90）でも、立てていれば 0°', () => {
    // 横持ちで立てた姿勢：端末の x 軸が真上を向く（beta=0, gamma=−90）
    expect(tiltFromOrientation(0, -90, 90)).toBeCloseTo(0, 5)
  })

  it('内カメラは画像の傾きの符号が逆になる', () => {
    expect(imageTilt(5, 'environment')).toBe(5)
    expect(imageTilt(5, 'user')).toBe(-5)
  })
})

describe('傾きの境界：|3°| 以下 ok、|7°| 以下 caution、それより大きいと ng', () => {
  it('境界', () => {
    expect(tiltLevel(0)).toBe('ok')
    expect(tiltLevel(3)).toBe('ok')
    expect(tiltLevel(-3)).toBe('ok')
    expect(tiltLevel(3.1)).toBe('caution')
    expect(tiltLevel(-7)).toBe('caution')
    expect(tiltLevel(7.1)).toBe('ng')
  })
  it('補正をかけるのは caution の範囲だけ。不明（undefined）はかけない', () => {
    expect(needsTiltCorrection(2)).toBe(false)
    expect(needsTiltCorrection(5)).toBe(true)
    expect(needsTiltCorrection(-5)).toBe(true)
    expect(needsTiltCorrection(9)).toBe(false)
    expect(needsTiltCorrection(undefined)).toBe(false)
  })
})

describe('傾き補正', () => {
  const upright = squatPose(100, 30)
  const knee = (p: typeof upright) => jointAngle(p[LM.leftHip], p[LM.leftKnee], p[LM.leftAnkle])
  const trunk = (p: typeof upright) => tiltFromVertical(p[LM.leftHip], p[LM.leftShoulder])

  it('傾いて撮った画像（立てた姿勢を t だけ回したもの）に −t 回すと、元の鉛直基準の値に戻る', () => {
    for (const t of [-7, -4, 4, 7]) {
      const tilted = rotatePose(upright, t)
      // 補正前は体幹の前傾が傾きぶんずれる
      expect(Math.abs(trunk(tilted) - 30)).toBeGreaterThan(3)
      const fixed = correctTilt(tilted, t)
      expect(trunk(fixed)).toBeCloseTo(30, 3)
    }
  })

  it('膝の角度（3点の角度）は傾きで変わらず、補正でも変わらない', () => {
    const tilted = rotatePose(upright, 6)
    expect(knee(tilted)).toBeCloseTo(knee(upright), 5)
    expect(knee(correctTilt(tilted, 6))).toBeCloseTo(100, 5)
  })

  it('RepTracker：傾きが caution のとき、体幹の前傾は補正され、膝の角度は同じ', () => {
    const tilted = rotatePose(squatPose(100, 30), 5)
    const plain = new RepTracker('squat').push(tilted, 0)
    const fixed = new RepTracker('squat').push(tilted, 0, undefined, { tiltDeg: 5 })
    expect(Math.abs(plain.angles.torso - 30)).toBeGreaterThan(3)
    expect(fixed.angles.torso).toBeCloseTo(30, 3)
    expect(fixed.angles.knee).toBeCloseTo(plain.angles.knee, 5)
    expect(fixed.angles.knee).toBeCloseTo(100, 3)
  })

  it('RepTracker：傾きが ok（≤3°）・ng（>7°）・不明のときは補正しない', () => {
    const tilted = rotatePose(squatPose(100, 30), 2)
    const a = new RepTracker('squat').push(tilted, 0, undefined, { tiltDeg: 2 }).angles.torso
    const b = new RepTracker('squat').push(tilted, 0).angles.torso
    expect(a).toBeCloseTo(b, 8)
    const c = new RepTracker('squat').push(rotatePose(squatPose(100, 30), 9), 0, undefined, { tiltDeg: 9 }).angles.torso
    const d = new RepTracker('squat').push(rotatePose(squatPose(100, 30), 9), 0).angles.torso
    expect(c).toBeCloseTo(d, 8)
  })
})
