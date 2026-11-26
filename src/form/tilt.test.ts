import { describe, expect, it } from 'vitest'
import { jointAngle, tiltFromVertical } from './geometry'
import { RepTracker } from './engine'
import { TILT_SHIFT_NG_DEG, correctTilt, imageTilt, needsTiltCorrection, rotatePose, tiltFromOrientation, tiltLevel } from './tilt'
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
  it('傾きが分かっていれば常に補正する（ok・caution・ng の区別なし）。不明（undefined）・数値でないときだけかけない', () => {
    expect(needsTiltCorrection(0)).toBe(true)
    expect(needsTiltCorrection(2)).toBe(true)
    expect(needsTiltCorrection(-5)).toBe(true)
    expect(needsTiltCorrection(9)).toBe(true)
    expect(needsTiltCorrection(undefined)).toBe(false)
    expect(needsTiltCorrection(Number.NaN)).toBe(false)
  })
  it('計測中の許容：固定値から 3° ずれたら ng（設計値・暫定）', () => {
    expect(TILT_SHIFT_NG_DEG).toBe(3)
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

  it('RepTracker：傾きが分かっていれば、ok（≤3°）・ng（>7°）でも補正する。不明のときは補正しない', () => {
    for (const t of [2, 9]) {
      const tilted = rotatePose(squatPose(100, 30), t)
      const fixed = new RepTracker('squat').push(tilted, 0, undefined, { tiltDeg: t }).angles.torso
      const plain = new RepTracker('squat').push(tilted, 0).angles.torso
      expect(fixed).toBeCloseTo(30, 3)
      expect(Math.abs(plain - 30)).toBeGreaterThan(1.5)
    }
  })

  it('RepTracker：固定した傾き（3°）で補正すれば、実際の揺れが 2.8〜3.2° でも体幹の角度に段差が出ない', () => {
    const tracker = new RepTracker('squat')
    const torso: number[] = []
    // 揺れ 2.8, 3.2, 2.9, 3.1, ... を固定値 3° で補正する（補正のオン・オフが 3° で切り替わると 3° ぶんの段差が出る）
    for (let i = 0; i < 12; i++) {
      const actual = i % 2 === 0 ? 2.8 + 0.02 * i : 3.2 - 0.02 * i
      const f = tracker.push(rotatePose(squatPose(100, 30), actual), i * 33, undefined, { tiltDeg: 3 })
      torso.push(f.angles.torso)
    }
    // 補正後の差は実際の揺れ（最大 0.4°）の範囲に収まる
    expect(Math.max(...torso) - Math.min(...torso)).toBeLessThan(0.5)
    for (const v of torso) expect(Math.abs(v - 30)).toBeLessThan(0.3)
  })
})
