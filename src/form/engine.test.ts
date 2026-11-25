import { describe, expect, it } from 'vitest'
import type { Exercise } from '../types'
import { RepTracker, baselineFrom, formKeyFor, setupGuide, summarizeSet } from './engine'
import { jointAngle, tiltFromVertical } from './geometry'
import {
  benchPose, combineSides, curlPose, repPath, setJointVisibility, setVisibility, squatPose,
} from './testPoses'
import type { PathFrame } from './testPoses'
import type { FormExerciseKey, FrameResult, Pose, RepResult } from './types'

/** 動きの全フレームを流し込み、最後の結果を返す */
function run(
  tracker: RepTracker,
  frames: PathFrame[],
  make: (f: PathFrame) => Pose,
): { last: FrameResult; all: FrameResult[] } {
  const all = frames.map((f) => tracker.push(make(f), f.t))
  return { last: all[all.length - 1], all }
}

const issueCodes = (r: RepResult) => r.issues.map((i) => i.code)

const squatPath = (bottoms: number[], downSec = 1.5, upSec = 1) =>
  repPath({ top: 170, bottoms, downSec, upSec })

describe('geometry', () => {
  it('jointAngle は頂点の角度を返す', () => {
    expect(jointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 5)
    expect(jointAngle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180, 5)
    expect(jointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45, 5)
  })
  it('tiltFromVertical は鉛直からの角度を返す（y は下向きが正）', () => {
    expect(tiltFromVertical({ x: 0, y: 1 }, { x: 0, y: 0 })).toBeCloseTo(0, 5)
    expect(tiltFromVertical({ x: 0, y: 1 }, { x: 1, y: 0 })).toBeCloseTo(45, 5)
    expect(tiltFromVertical({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90, 5)
  })
  it('生成した姿勢から入力どおりの角度が出る', () => {
    const t = new RepTracker('squat')
    const f = t.push(squatPose(100, 30), 0)
    expect(f.visible).toBe(true)
    expect(f.angles.knee).toBeCloseTo(100, 3)
    expect(f.angles.torso).toBeCloseTo(30, 3)
    const c = new RepTracker('curl').push(curlPose(80, 20, 10), 0)
    expect(c.angles.elbow).toBeCloseTo(80, 3)
    expect(c.angles.upperArm).toBeCloseTo(20, 3)
    expect(c.angles.torso).toBeCloseTo(10, 3)
    const b = new RepTracker('bench').push(benchPose(120), 0)
    expect(b.angles.elbow).toBeCloseTo(120, 3)
  })
  it('角度は指数移動平均（α=0.5）で平滑化される', () => {
    const t = new RepTracker('squat')
    t.push(squatPose(170, 0), 0)
    const f = t.push(squatPose(100, 0), 33)
    expect(f.angles.knee).toBeCloseTo(135, 3)
  })
})

describe('左右の選択と visibility', () => {
  it('visibility の平均が高い側を使い、差が 0.1 未満なら前回の側を維持する', () => {
    const left = squatPose(170, 0)
    const right = squatPose(100, 0)
    const t = new RepTracker('squat')
    let f = t.push(setVisibility(setVisibility(combineSides(left, right), 'left', 0.9), 'right', 0.6), 0)
    expect(f.angles.knee).toBeCloseTo(170, 3)
    // 右がわずかに高い（差 0.05）→ 左のまま
    f = t.push(setVisibility(setVisibility(combineSides(left, right), 'left', 0.8), 'right', 0.85), 33)
    expect(f.angles.knee).toBeCloseTo(170, 3)
    // 右が 0.15 高い → 右へ切り替わり、平滑化で 170 から 100 へ近づく
    f = t.push(setVisibility(setVisibility(combineSides(left, right), 'left', 0.8), 'right', 0.95), 66)
    expect(f.angles.knee).toBeCloseTo(135, 3)
  })
  it('最初のフレームは visibility が高い右側を選べる', () => {
    const t = new RepTracker('squat')
    const f = t.push(setVisibility(setVisibility(combineSides(squatPose(170, 0), squatPose(100, 0)), 'left', 0.6), 'right', 0.9), 0)
    expect(f.angles.knee).toBeCloseTo(100, 3)
  })
  it('必要な関節の visibility が 0.5 未満なら visible: false で状態を変えない', () => {
    const t = new RepTracker('squat')
    const frames = squatPath([70])
    const mid = Math.floor(frames.length / 2)
    let invisibleCount = 0
    const all = frames.map((f, i) => {
      let pose = squatPose(f.angle, 15)
      if (i >= mid - 3 && i < mid) {
        pose = setJointVisibility(pose, 'knee', 0.4)
        invisibleCount++
      }
      return t.push(pose, f.t)
    })
    const hidden = all.slice(mid - 3, mid)
    expect(invisibleCount).toBe(3)
    expect(hidden.every((r) => !r.visible && Object.keys(r.angles).length === 0)).toBe(true)
    expect(all[all.length - 1].reps).toHaveLength(1)
  })
  it('pose が undefined のフレームは無視される', () => {
    const t = new RepTracker('squat')
    const f = t.push(undefined, 0)
    expect(f.visible).toBe(false)
    expect(f.phase).toBe('idle')
    expect(f.reps).toEqual([])
  })
  it('見えない側の関節は無視される（片側だけ見えていれば採点できる）', () => {
    const t = new RepTracker('squat')
    const pose = setVisibility(squatPose(100, 0), 'right', 0.1)
    expect(t.push(pose, 0).visible).toBe(true)
  })
})

describe('スクワット', () => {
  it('深いスクワットは1レップで満点、時間と可動域が測れる', () => {
    const t = new RepTracker('squat')
    const { last } = run(t, squatPath([70]), (f) => squatPose(f.angle, 20))
    expect(last.reps).toHaveLength(1)
    const r = last.reps[0]
    expect(r.index).toBe(1)
    expect(r.issues).toEqual([])
    expect(r.score).toBe(100)
    expect(Math.abs(r.minAngle - 70)).toBeLessThan(1)
    expect(Math.abs(r.maxAngle - 170)).toBeLessThan(1)
    expect(Math.abs(r.romDeg - 100)).toBeLessThan(2)
    expect(r.romPct).toBeUndefined()
    // 下ろす 1.5 秒（開始判定の遅れで ±0.3 秒）、上げる 1 秒
    expect(Math.abs(r.eccentricSec - 1.5)).toBeLessThan(0.4)
    expect(Math.abs(r.concentricSec - 1)).toBeLessThan(0.4)
    expect(last.phase).toBe('top')
  })
  it('浅いスクワットは shallow で 30 点減点', () => {
    const t = new RepTracker('squat')
    const { last } = run(t, squatPath([120]), (f) => squatPose(f.angle, 20))
    expect(last.reps).toHaveLength(1)
    expect(issueCodes(last.reps[0])).toEqual(['shallow'])
    expect(last.reps[0].score).toBe(70)
    expect(last.reps[0].issues[0].message).toBe('しゃがみが浅い')
  })
  it('前傾しすぎは lean で 15 点減点、動作中に cue「胸を起こして」が出る', () => {
    const t = new RepTracker('squat')
    const { last, all } = run(t, squatPath([70]), (f) => squatPose(f.angle, 65))
    expect(issueCodes(last.reps[0])).toEqual(['lean'])
    expect(last.reps[0].score).toBe(85)
    expect(all.some((r) => r.cue === '胸を起こして')).toBe(true)
  })
  it('前傾が 55° 以下なら lean にならない', () => {
    const t = new RepTracker('squat')
    const { last, all } = run(t, squatPath([70]), (f) => squatPose(f.angle, 50))
    expect(last.reps[0].issues).toEqual([])
    expect(all.every((r) => r.cue !== '胸を起こして')).toBe(true)
  })
  it('完了から2秒間だけ、最も減点の大きい issue の message が cue に出る', () => {
    const t = new RepTracker('squat')
    // 浅い（30）と前傾（15）の両方 → cue は「しゃがみが浅い」
    const frames = repPath({ top: 170, bottoms: [120], downSec: 1.5, upSec: 1, holdTopSec: 2.5 })
    const { all } = run(t, frames, (f) => squatPose(f.angle, 65))
    const doneAt = all.findIndex((r) => r.reps.length === 1)
    expect(all[doneAt].cue).toBe('しゃがみが浅い')
    // 完了の 1 秒後（30 フレーム後）はまだ出ている
    expect(all[doneAt + 30].cue).toBe('しゃがみが浅い')
    // 完了の 2 秒より後には消える
    const last = frames[frames.length - 1]
    expect(last.t - frames[doneAt].t).toBeGreaterThan(2000)
    expect(all[all.length - 1].cue).toBeUndefined()
  })
  it('下ろす動作が1秒未満なら fast-down で 10 点減点', () => {
    const t = new RepTracker('squat')
    const { last } = run(t, squatPath([70], 0.5, 1), (f) => squatPose(f.angle, 20))
    expect(issueCodes(last.reps[0])).toEqual(['fast-down'])
    expect(last.reps[0].score).toBe(90)
    expect(last.reps[0].eccentricSec).toBeLessThan(1)
  })
  it('小さな動きはレップにならない', () => {
    const t = new RepTracker('squat')
    // 170 → 140 → 170（最小角度が top − 30 = 130 より大きい）
    const { last } = run(t, squatPath([140]), (f) => squatPose(f.angle, 20))
    expect(last.reps).toHaveLength(0)
  })
  it('曲げ始めから8秒以上戻らなければレップにならない', () => {
    const slow = new RepTracker('squat')
    const r = run(slow, squatPath([70], 1.5, 9), (f) => squatPose(f.angle, 20))
    expect(r.last.reps).toHaveLength(0)
  })
  it('2.5秒下ろし＋1.5秒上げ（計4秒）のレップは数えられる', () => {
    const t = new RepTracker('squat')
    const { last } = run(t, squatPath([70], 2.5, 1.5), (f) => squatPose(f.angle, 20))
    expect(last.reps).toHaveLength(1)
    expect(last.reps[0].issues).toEqual([])
  })
  it('3レップ目で可動域が最初の85%未満になると rom-drop', () => {
    const t = new RepTracker('squat')
    const { last } = run(t, squatPath([70, 70, 90]), (f) => squatPose(f.angle, 20))
    expect(last.reps).toHaveLength(3)
    expect(issueCodes(last.reps[0])).toEqual([])
    expect(issueCodes(last.reps[1])).toEqual([])
    expect(issueCodes(last.reps[2])).toEqual(['rom-drop'])
    expect(last.reps[2].score).toBe(90)
    expect(last.reps.map((r) => r.index)).toEqual([1, 2, 3])
  })
})

describe('基準（baseline）', () => {
  it('基準より可動域が狭いと short-rom と romPct が付く', () => {
    const base = { romDeg: 100, minAngle: 70, maxAngle: 170 }
    const t = new RepTracker('squat', base)
    const { last } = run(t, squatPath([90]), (f) => squatPose(f.angle, 20))
    const r = last.reps[0]
    expect(r.romPct).toBeCloseTo(0.8, 2)
    expect(issueCodes(r)).toEqual(['short-rom'])
    expect(r.issues[0].message).toBe('いつもより可動域が20%狭い')
    expect(r.issues[0].fix).toBe('基準動画と同じ深さ・伸びまで動かしましょう')
    expect(r.score).toBe(80)
  })
  it('基準と同じ可動域なら short-rom にならない', () => {
    const t = new RepTracker('squat', { romDeg: 100, minAngle: 70, maxAngle: 170 })
    const { last } = run(t, squatPath([70]), (f) => squatPose(f.angle, 20))
    expect(last.reps[0].romPct).toBeGreaterThanOrEqual(0.98)
    expect(last.reps[0].issues).toEqual([])
  })
  it('baselineFrom はレップから基準を作る', () => {
    const t = new RepTracker('squat')
    const { last } = run(t, squatPath([70]), (f) => squatPose(f.angle, 20))
    const r = last.reps[0]
    expect(baselineFrom(r)).toEqual({ romDeg: r.romDeg, minAngle: r.minAngle, maxAngle: r.maxAngle })
  })
  it('reset でレップと状態が消える', () => {
    const t = new RepTracker('squat')
    run(t, squatPath([70]), (f) => squatPose(f.angle, 20))
    t.reset()
    const f = t.push(squatPose(170, 0), 0)
    expect(f.reps).toEqual([])
    expect(f.phase).toBe('top')
  })
})

describe('ベンチプレス', () => {
  const path = (bottom: number) => repPath({ top: 170, bottoms: [bottom], downSec: 1.5, upSec: 1 })
  it('胸まで下ろせば減点なし', () => {
    const t = new RepTracker('bench')
    const { last } = run(t, path(60), (f) => benchPose(f.angle))
    expect(last.reps).toHaveLength(1)
    expect(last.reps[0].issues).toEqual([])
  })
  it('最小角度が 100° より大きいと shallow で 25 点減点', () => {
    const t = new RepTracker('bench')
    const { last } = run(t, path(110), (f) => benchPose(f.angle))
    expect(issueCodes(last.reps[0])).toEqual(['shallow'])
    expect(last.reps[0].issues[0].message).toBe('バーを胸まで下ろせていない')
    expect(last.reps[0].score).toBe(75)
  })
})

describe('カール', () => {
  const path = (bottom: number, down = 1.2, up = 2.5) =>
    repPath({ top: 165, bottoms: [bottom], downSec: down, upSec: up })
  it('下ろす動作は後半。きれいなレップは減点なし', () => {
    const t = new RepTracker('curl')
    const { last } = run(t, path(40), (f) => curlPose(f.angle, 5, 3))
    expect(last.reps).toHaveLength(1)
    expect(last.reps[0].issues).toEqual([])
    // 巻き上げ 1.2 秒（concentric＝前半）。下ろし 2.5 秒（eccentric＝後半）は、130° より上の分を角度の比率で推定して約 2.5 秒
    expect(last.reps[0].eccentricSec).toBeGreaterThan(2.2)
    expect(last.reps[0].eccentricSec).toBeLessThan(2.9)
    expect(Math.abs(last.reps[0].concentricSec - 1.2)).toBeLessThan(0.4)
  })
  it('巻き上げが速くても fast-down にならず、下ろしが速いと fast-down になる', () => {
    const quickUp = new RepTracker('curl')
    expect(run(quickUp, path(40, 0.5), (f) => curlPose(f.angle, 5, 3)).last.reps[0].issues).toEqual([])
    const quickDown = new RepTracker('curl')
    const r = run(quickDown, path(40, 1.2, 0.5), (f) => curlPose(f.angle, 5, 3)).last.reps[0]
    expect(issueCodes(r)).toEqual(['fast-down'])
  })
  it('130° より上の伸ばしきりまでの下ろし時間も角度の比率で推定し、1.5 秒の下ろしは fast-down にしない', () => {
    // 165° → 80° を 1.0 秒で巻き上げ、80° → 165° を 1.5 秒で下ろす。130° 到達までは約 0.9 秒しか測れない
    const t = new RepTracker('curl')
    const frames = repPath({ top: 165, bottoms: [80], downSec: 1.0, upSec: 1.5 })
    const r = run(t, frames, (f) => curlPose(f.angle, 5, 3)).last.reps[0]
    expect(issueCodes(r)).not.toContain('fast-down')
    expect(r.eccentricSec).toBeGreaterThan(1.2)
    expect(r.eccentricSec).toBeLessThan(1.8)
  })
  it('140° と 40° を往復すると、数えたうえで partial-bottom で 25 点減点', () => {
    const t = new RepTracker('curl')
    const frames = repPath({ top: 140, bottoms: [40], downSec: 1.2, upSec: 1.5 })
    const { last } = run(t, frames, (f) => curlPose(f.angle, 5, 3))
    expect(last.reps).toHaveLength(1)
    expect(issueCodes(last.reps[0])).toEqual(['partial-bottom'])
    expect(last.reps[0].score).toBe(75)
    expect(last.reps[0].issues[0].message).toBe('腕を伸ばしきれていない')
  })
  it('155° まで伸ばせば partial-bottom にならない', () => {
    const t = new RepTracker('curl')
    const frames = repPath({ top: 155, bottoms: [40], downSec: 1.2, upSec: 1.5 })
    const { last } = run(t, frames, (f) => curlPose(f.angle, 5, 3))
    expect(last.reps).toHaveLength(1)
    expect(last.reps[0].issues).toEqual([])
  })
  it('120° までしか曲げ始めない小さな動きはレップにならない', () => {
    const t = new RepTracker('curl')
    const frames = repPath({ top: 165, bottoms: [115], downSec: 1.2, upSec: 1.5 })
    expect(run(t, frames, (f) => curlPose(f.angle, 5, 3)).last.reps).toHaveLength(0)
  })
  it('上まで曲げないと partial-top で 10 点減点', () => {
    const t = new RepTracker('curl')
    const { last } = run(t, path(80), (f) => curlPose(f.angle, 5, 3))
    expect(issueCodes(last.reps[0])).toEqual(['partial-top'])
    expect(last.reps[0].score).toBe(90)
  })
  it('肘が前後に動くと swing で 15 点減点', () => {
    const t = new RepTracker('curl')
    const { last } = run(t, path(40), (f) => curlPose(f.angle, 5 + 60 * f.progress, 3))
    expect(issueCodes(last.reps[0])).toEqual(['swing'])
    expect(last.reps[0].score).toBe(85)
  })
  it('上体が揺れると body-english で 10 点減点', () => {
    const t = new RepTracker('curl')
    const { last } = run(t, path(40), (f) => curlPose(f.angle, 5, 3 + 40 * f.progress))
    expect(issueCodes(last.reps[0])).toEqual(['body-english'])
    expect(last.reps[0].score).toBe(90)
  })
})

describe('summarizeSet', () => {
  const rep = (over: Partial<RepResult>): RepResult => ({
    index: 1, score: 100, romDeg: 100, eccentricSec: 2, concentricSec: 1, minAngle: 70, maxAngle: 170,
    issues: [], ...over,
  })
  const iss = (code: string, penalty = 10) => ({ code, message: code, fix: '', penalty })

  it('レップ0なら全部 0', () => {
    expect(summarizeSet([])).toEqual({ reps: 0, avgScore: 0, mainIssues: [], lengthenedOk: false })
  })
  it('平均点は四捨五入、issue は回数の多い順に最大3件でまとめる', () => {
    const reps = [
      rep({ score: 70, issues: [iss('a'), iss('b')] }),
      rep({ score: 85, issues: [iss('b'), iss('c')] }),
      rep({ score: 90, issues: [iss('b'), iss('d'), iss('a')] }),
    ]
    const s = summarizeSet(reps)
    expect(s.reps).toBe(3)
    expect(s.avgScore).toBe(82) // 81.67
    expect(s.mainIssues.map((i) => i.code)).toEqual(['b', 'a', 'c'])
  })
  it('romPct があれば全レップ 0.9 以上で lengthenedOk', () => {
    expect(summarizeSet([rep({ romPct: 1 }), rep({ romPct: 0.9 })]).lengthenedOk).toBe(true)
    expect(summarizeSet([rep({ romPct: 1 }), rep({ romPct: 0.89 })]).lengthenedOk).toBe(false)
  })
  it('romPct がなければ種目ごとに shallow / partial-bottom で判定する', () => {
    const shallow = [rep({ issues: [iss('shallow')] })]
    const partial = [rep({ issues: [iss('partial-bottom')] })]
    expect(summarizeSet(shallow, 'squat').lengthenedOk).toBe(false)
    expect(summarizeSet(shallow, 'bench').lengthenedOk).toBe(false)
    expect(summarizeSet(shallow, 'curl').lengthenedOk).toBe(true)
    expect(summarizeSet(partial, 'curl').lengthenedOk).toBe(false)
    expect(summarizeSet(partial, 'squat').lengthenedOk).toBe(true)
    // 種目なしは両方を見る
    expect(summarizeSet(shallow).lengthenedOk).toBe(false)
    expect(summarizeSet(partial).lengthenedOk).toBe(false)
    expect(summarizeSet([rep({})]).lengthenedOk).toBe(true)
  })
})

describe('formKeyFor / setupGuide', () => {
  const ex = (name: string) => ({ name }) as Exercise
  it('種目名から種目キーを決める', () => {
    expect(formKeyFor(ex('バーベルスクワット'))).toBe('squat')
    expect(formKeyFor(ex('ブルガリアンスクワット'))).toBeUndefined()
    expect(formKeyFor(ex('スプリットスクワット'))).toBeUndefined()
    expect(formKeyFor(ex('ベンチプレス'))).toBe('bench')
    expect(formKeyFor(ex('ダンベルベンチプレス'))).toBeUndefined()
    expect(formKeyFor(ex('インクラインベンチプレス'))).toBeUndefined()
    expect(formKeyFor(ex('バーベルカール'))).toBe('curl')
    expect(formKeyFor(ex('レッグカール'))).toBeUndefined()
    expect(formKeyFor(ex('ラットプルダウン'))).toBeUndefined()
  })
  it('撮影のしかたが全種目にある', () => {
    for (const k of ['squat', 'bench', 'curl'] as FormExerciseKey[]) expect(setupGuide(k).length).toBeGreaterThan(10)
    expect(setupGuide('squat')).toContain('真横')
  })
})

describe('縦横比の補正', () => {
  it('縦長 3:4 の映像で、補正しないと膝角度がずれ、補正すると実際の角度に戻る', async () => {
    const { jointAngle, toAspectCorrected } = await import('./geometry')
    const W = 3, H = 4 // 画像の幅と高さ（同じ単位）
    // 実空間で膝が 115° に曲がった3点（股関節・膝・足首）
    const rad = (115 * Math.PI) / 180
    const knee = { x: 1.5, y: 2.4 }
    const hip = { x: knee.x - 0.8, y: knee.y }
    const ankle = { x: knee.x - 0.8 * Math.cos(rad), y: knee.y + 0.8 * Math.sin(rad) }
    expect(Math.round(jointAngle(hip, knee, ankle))).toBe(115)
    // MediaPipe と同じく、x を幅・y を高さで割って正規化する
    const norm = [hip, knee, ankle].map(p => ({ x: p.x / W, y: p.y / H }))
    expect(Math.abs(jointAngle(norm[0], norm[1], norm[2]) - 115)).toBeGreaterThan(5)
    const fixed = toAspectCorrected(norm, W / H)
    expect(Math.round(jointAngle(fixed[0], fixed[1], fixed[2]))).toBe(115)
  })

  it('正方形（縦横比 1）や不正な値では何もしない', async () => {
    const { toAspectCorrected } = await import('./geometry')
    const pose = [{ x: 0.3, y: 0.4 }]
    expect(toAspectCorrected(pose, 1)).toBe(pose)
    expect(toAspectCorrected(pose, 0)).toBe(pose)
    expect(toAspectCorrected(pose, Number.NaN)).toBe(pose)
  })
})
