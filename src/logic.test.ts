import { describe, expect, it } from 'vitest'
import {
  achieved, achievementRate, addDays, adjustSetsForVolume, e1rm, e1rmTrend, planExercise, rampWeeklyTargets, roundTo, suggestTarget, volumeBetween, weekStart,
} from './logic'
import type { AppData, Entry, Exercise, Session, SetLog } from './types'

const bench: Exercise = {
  id: 'bench', name: 'ベンチプレス', part: '胸', repMin: 6, repMax: 10, increment: 2.5, sets: 3, targetRir: 2,
  primary: ['胸'], secondary: ['上腕三頭筋', '肩前部'],
}

const s = (weight: number, reps: number, rir?: number): SetLog => ({ weight, reps, done: true, rir })
const entry = (sets: SetLog[], target?: Entry['target']): Entry => ({ exerciseId: 'bench', sets, target })
const session = (date: string, entries: Entry[]): Session => ({ id: date, date, entries })
const data = (sessions: Session[], weeklyTargets = {}): AppData => ({ version: 1, exercises: [bench], sessions, restSeconds: 120, weeklyTargets })

describe('基本計算', () => {
  it('RIR で補正した推定1RM', () => {
    expect(e1rm(100, 5)).toBeCloseTo(116.67, 1)
    expect(e1rm(100, 5, 1)).toBe(120)
  })
  it('刻みに丸める', () => {
    expect(roundTo(56.3, 2.5)).toBe(57.5)
    expect(roundTo(54, 2.5)).toBe(55)
  })
  it('週の始まりは月曜', () => {
    expect(weekStart('2026-11-24')).toBe('2026-11-23') // 火曜 → 月曜
    expect(weekStart('2026-11-29')).toBe('2026-11-23') // 日曜 → 同じ週の月曜
  })
})

describe('限界テストのセットの換算', () => {
  // ダンベル種目：8〜12回、目標RIR 1
  const curl: Exercise = { ...bench, id: 'curl', repMin: 8, repMax: 12, increment: 1, targetRir: 1, equipment: 'dumbbell' }
  const amrap = (weight: number, reps: number, rir: number): SetLog => ({ weight, reps, done: true, rir, amrap: true })

  it('限界まで挙げた回数を「目標RIRを残した回数」に換算し、上限到達なら重量を上げる', () => {
    // 12,12 と、限界テストで合計13回（目標RIR1を残すと12回）→ 全セット上限到達
    const t = suggestTarget(curl, [entry([s(10, 12, 1), s(10, 12, 1), amrap(10, 13, 0)])])
    expect(t).toMatchObject({ kind: 'increase', weight: 11 })
  })

  it('限界テストの rir 欄（目標回数時点の予測）は余力の判定に使わない', () => {
    // 予測 RIR 0 と入力していても、換算後は目標RIRどおりとみなす
    const t = suggestTarget(curl, [entry([s(10, 12, 1), s(10, 12, 1), amrap(10, 14, 0)])])
    expect(t.kind).toBe('increase')
  })

  it('換算後に上限へ届かなければ同重量でレップを伸ばす', () => {
    const t = suggestTarget(curl, [entry([s(10, 12, 1), s(10, 12, 1), amrap(10, 12, 0)])])
    expect(t).toMatchObject({ kind: 'reps', weight: 10, reps: 12 })
  })
})

describe('種目ごとの目標', () => {
  it('記録がなければ初回の案内', () => {
    expect(suggestTarget(bench, []).kind).toBe('first')
  })

  it('全セット上限かつ目標RIRどおりなら +1 刻み', () => {
    const t = suggestTarget(bench, [entry([s(60, 10, 2), s(60, 10, 2), s(60, 10, 2)])])
    expect(t).toMatchObject({ kind: 'increase', weight: 62.5, reps: 6 })
  })

  it('余力が3回以上残っていれば +2 刻み', () => {
    const t = suggestTarget(bench, [entry([s(60, 10, 5), s(60, 10, 5), s(60, 10, 5)])])
    expect(t).toMatchObject({ kind: 'increase', weight: 65 })
  })

  it('上限に届いても目標RIRより追い込んでいたら上げない', () => {
    const t = suggestTarget(bench, [entry([s(60, 10, 0), s(60, 10, 0), s(60, 10, 0)])])
    expect(t.kind).toBe('reps')
  })

  it('上限未満なら同重量でレップ +1、余力2以上なら +2', () => {
    expect(suggestTarget(bench, [entry([s(60, 8, 2), s(60, 8, 2), s(60, 7, 2)])])).toMatchObject({ kind: 'reps', weight: 60, reps: 8 })
    expect(suggestTarget(bench, [entry([s(60, 8, 4), s(60, 8, 4), s(60, 8, 4)])])).toMatchObject({ reps: 10 })
  })

  it('2回連続で目標未達ならデロード', () => {
    const target = { kind: 'reps' as const, weight: 60, reps: 9, sets: 3, rir: 2, reason: '' }
    const missed = entry([s(60, 8, 1), s(60, 7, 0), s(60, 6, 0)], target)
    expect(achieved(missed)).toBe(false)
    const t = suggestTarget(bench, [missed, missed])
    expect(t).toMatchObject({ kind: 'deload', weight: 55, sets: 2 })
  })
})

describe('増量の判定（予定セット数）', () => {
  it('前回の予定が2セットなら、2セットとも上限回数・目標RIR以上で増量する', () => {
    const target = { kind: 'reps' as const, weight: 60, reps: 10, sets: 2, rir: 2, reason: '' }
    const t = suggestTarget(bench, [entry([s(60, 10, 2), s(60, 10, 2)], target)])
    expect(t).toMatchObject({ kind: 'increase', weight: 62.5 })
  })
  it('予定が標準（3セット）なら、2セットだけでは増量しない', () => {
    const t = suggestTarget(bench, [entry([s(60, 10, 2), s(60, 10, 2)])])
    expect(t.kind).toBe('reps')
  })
})

describe('デロードは今回だけ', () => {
  const dl = { kind: 'deload' as const, weight: 55, reps: 6, sets: 2, rir: 2, reason: '' }
  const miss = { kind: 'reps' as const, weight: 60, reps: 9, sets: 3, rir: 2, reason: '' }
  const missed = () => entry([s(60, 8, 1), s(60, 7, 0), s(60, 6, 0)], miss)

  it('デロードの次は、デロード前の最大重量に戻して下限の回数から', () => {
    const deload = entry([s(55, 6, 2), s(55, 6, 2)], dl)
    const t = suggestTarget(bench, [deload, missed(), missed()])
    expect(t).toMatchObject({ kind: 'reps', weight: 60, reps: 6, sets: 3 })
    expect(t.reason).toContain('回復の回のあと')
  })
  it('デロード前の記録が無ければ、前回の重量 ÷ 0.9 を刻みに丸める', () => {
    const deload = entry([s(55, 6, 2), s(55, 6, 2)], dl)
    expect(suggestTarget(bench, [deload])).toMatchObject({ kind: 'reps', weight: 60, reps: 6 })
  })
  it('デロードの直後にまた未達でも、再デロードしない', () => {
    const deload = entry([s(55, 5, 0), s(55, 5, 0)], dl)
    // 直近2件: デロード（未達）→ 未達。デロードが挟まるので missedTwice にならない
    const t = suggestTarget(bench, [missed(), deload, missed()])
    expect(t.kind).not.toBe('deload')
  })
})

describe('達成率（未着手の種目）', () => {
  it('完了セットが1つも無い記録は数えない', () => {
    const target = { kind: 'reps' as const, weight: 60, reps: 8, sets: 3, rir: 2, reason: '' }
    const idle = entry([{ weight: 60, reps: 8, done: false }], target)
    const good = entry([s(60, 8), s(60, 8), s(60, 8)], target)
    expect(achievementRate([session('2026-11-17', [idle, good])], '2026-11-16', '2026-11-23')).toBe(1)
    expect(achievementRate([session('2026-11-17', [idle])], '2026-11-16', '2026-11-23')).toBeUndefined()
  })
})

describe('週ボリューム', () => {
  it('主働筋1・補助筋0.5で数える', () => {
    const vol = volumeBetween([session('2026-11-23', [entry([s(60, 8), s(60, 8), s(60, 8)])])], [bench], '2026-11-23', '2026-11-30')
    expect(vol).toEqual({ 胸: 3, 上腕三頭筋: 1.5, 肩前部: 1.5 })
  })

  it('先週が目標未満なら +1、20超なら −1', () => {
    expect(adjustSetsForVolume(bench, 3, { 胸: 6 }, {}).sets).toBe(4)
    expect(adjustSetsForVolume(bench, 3, { 胸: 22 }, {}).sets).toBe(2)
    expect(adjustSetsForVolume(bench, 3, { 胸: 12 }, {}).sets).toBe(3)
  })

  it('先週その筋肉の記録が無い（使い始め・再開）ときは増やさない', () => {
    expect(adjustSetsForVolume(bench, 3, {}, {}).sets).toBe(3)
    expect(adjustSetsForVolume(bench, 3, { 胸: 0 }, {}).sets).toBe(3)
  })

  it('達成率80%以上が3週続けば週目標を +1', () => {
    const target = { kind: 'reps' as const, weight: 60, reps: 8, sets: 3, rir: 2, reason: '' }
    const good = (date: string) => session(date, [entry([s(60, 8), s(60, 8), s(60, 8)], target)])
    const d = data([good('2026-11-02'), good('2026-11-09'), good('2026-11-16')])
    expect(rampWeeklyTargets(d, '2026-11-24')).toMatchObject({ 胸: 11 })
  })
})

describe('週目標の引き上げ対象', () => {
  const target = { kind: 'reps' as const, weight: 60, reps: 8, sets: 3, rir: 2, reason: '' }
  const row: Exercise = { ...bench, id: 'row', name: 'ロウ', part: '背中', primary: ['背中'], secondary: ['上腕二頭筋'] }
  const rowEntry = (sets: SetLog[]): Entry => ({ exerciseId: 'row', sets, target })
  const good = (date: string) => session(date, [entry([s(60, 8), s(60, 8), s(60, 8)], target)])

  it('先週に主働筋として完了セットがあった筋肉だけ +1（補助筋だけ・未実施は上げない）', () => {
    const d: AppData = {
      ...data([good('2026-11-02'), good('2026-11-09'), session('2026-11-16', [
        entry([s(60, 8), s(60, 8), s(60, 8)], target),
        rowEntry([{ weight: 40, reps: 10, done: false }]), // 未完了 → 背中は上げない
      ])]),
      exercises: [bench, row],
    }
    const r = rampWeeklyTargets(d, '2026-11-24')
    expect(r.胸).toBe(11)
    expect(r.背中).toBeUndefined()
    expect(r.上腕三頭筋).toBeUndefined() // 補助筋だけ
    expect(r.肩前部).toBeUndefined()
  })
})

describe('今日の計画', () => {
  it('先週のボリューム不足と調子を反映する', () => {
    const d = data([session('2026-11-17', [entry([s(60, 10, 2), s(60, 10, 2), s(60, 10, 2)])])])
    const t = planExercise(bench, d, '2026-11-24')
    expect(t).toMatchObject({ kind: 'increase', weight: 62.5, sets: 4 }) // 先週の胸は3セット < 10
    // 不調でもセット数は変えず、注意だけ出す
    const bad = planExercise(bench, d, '2026-11-24', 'bad')
    expect(bad.sets).toBe(4)
    expect(bad.caution).toBeTruthy()
    expect(t.caution).toBeUndefined()
  })

  it('1回あたりの上限を守る', () => {
    const d = data([])
    expect(planExercise(bench, d, '2026-11-24', 'normal', { 胸: 8 }).sets).toBe(2)
  })
})

describe('RIR の個人補正', () => {
  const full = [entry([s(60, 10, 1), s(60, 10, 1), s(60, 10, 1)])]

  it('補正 +1 なら記録 RIR 1 でも目標RIR 2 とみなして重量を上げる（補正なしなら上げない）', () => {
    expect(suggestTarget(bench, full).kind).toBe('reps')
    expect(suggestTarget(bench, full, 1)).toMatchObject({ kind: 'increase', weight: 62.5 })
  })

  it('未入力の RIR には補正を足さない', () => {
    const t = suggestTarget(bench, [entry([s(60, 10), s(60, 10), s(60, 10)])], -1)
    expect(t.kind).toBe('increase')
  })

  it('planExercise は補正を理由に書き、4回目に限界テストを返す', () => {
    const dumbbell: Exercise = { ...bench, equipment: 'dumbbell' }
    const amrapSet: SetLog = { weight: 60, reps: 10, done: true, rir: 1, amrap: true }
    const tgt = { kind: 'reps' as const, weight: 60, reps: 8, sets: 3, rir: 2, reason: '' }
    const past = [
      session('2026-10-01', [entry([s(60, 8, 2), s(60, 8, 2), amrapSet], tgt)]), // 誤差 (10-8)-1 = +1
      session('2026-10-08', [entry([s(60, 8, 2), s(60, 8, 2), amrapSet], tgt)]),
      session('2026-10-15', [entry([s(60, 8, 2), s(60, 8, 2), s(60, 8, 2)])]),
    ]
    const d = { ...data(past), exercises: [dumbbell] }
    const t = planExercise(dumbbell, d, '2026-10-22')
    expect(t.amrap).toBe(true)
    expect(t.reason).toContain('RIR補正 +1（あなたは余力を少なめに見積もる傾向）')
    expect(t.reason).toContain('最終セットは限界テスト')
  })

  it('初回・デロードの日とバーベルは限界テストにしない', () => {
    const dumbbell: Exercise = { ...bench, equipment: 'dumbbell' }
    expect(planExercise(dumbbell, { ...data([]), exercises: [dumbbell] }, '2026-10-22').amrap).toBeUndefined()
    const past = [1, 2, 3].map(i => session(`2026-10-0${i}`, [entry([s(60, 8, 2), s(60, 8, 2), s(60, 8, 2)])]))
    const barbell: Exercise = { ...bench, equipment: 'barbell' }
    expect(planExercise(barbell, { ...data(past), exercises: [barbell] }, '2026-10-22').amrap).toBeUndefined()
  })
})

describe('推定1RMの傾向（デロードの誤判定を減らす）', () => {
  const TODAY = '2026-11-30'
  const miss = { kind: 'reps' as const, weight: 60, reps: 9, sets: 3, rir: 2, reason: '' }
  const missed = () => entry([s(60, 8, 1), s(60, 7, 0), s(60, 6, 0)], miss)
  const dl = { kind: 'deload' as const, weight: 55, reps: 6, sets: 2, rir: 2, reason: '' }
  // 今日の daysAgo 日前の日付
  const ago = (n: number) => addDays(TODAY, -n)
  // 4日おきに weights[i] kg × 5回（RIR 2）のセッションを作る（新しい日付ほど後ろ）
  const series = (weights: number[], step = 4) =>
    weights.map((w, i) => session(ago((weights.length - i) * step), [entry([s(w, 5, 2)])]))
  const growing = [60, 60.5, 61, 61.5, 62, 62.5, 63] // 約 +3%/週
  const flat = [60, 60, 60, 60, 60, 60, 60]

  it('2回未達でも傾向が +1%/週 以上ならデロードしない', () => {
    const t = suggestTarget(bench, [missed(), missed()], 0, { slopePctPerWeek: 1, points: 8 })
    expect(t.kind).toBe('reps')
    expect(t.weight).toBe(60)
    expect(t.reason).toContain('2回未達だが直近4週の推定1RMは週+1.0%で伸びているため、重量は据え置き')
  })
  it('2回未達で傾向が 0 または負ならデロードする', () => {
    for (const slope of [0, -1.2]) {
      const t = suggestTarget(bench, [missed(), missed()], 0, { slopePctPerWeek: slope, points: 8 })
      expect(t).toMatchObject({ kind: 'deload', weight: 55, sets: 2 })
      expect(t.reason).toContain('直近4週の推定1RMの伸び')
    }
  })
  it('傾向が undefined（データ不足）なら今のルールどおりデロード', () => {
    expect(suggestTarget(bench, [missed(), missed()], 0, undefined).kind).toBe('deload')
  })
  it('記録が 6 回未満なら傾向は出ず、planExercise は今のルールどおりデロードする', () => {
    // 伸びている 3 件 + 未達 2 件 = 5 件
    const sessions = [...series([60, 61, 62]), session(ago(2), [missed()]), session(ago(1), [missed()])]
    expect(e1rmTrend('bench', bench, sessions, TODAY)).toBeUndefined()
    expect(planExercise(bench, data(sessions), TODAY).kind).toBe('deload')
  })
  it('記録が十分で伸びていれば planExercise はデロードしない', () => {
    // 伸びている 6 件（重量 60→65kg）+ 未達 2 件。傾向は +0.5%/週 以上
    const sessions = [...series([60, 61, 62, 63, 64, 65], 4).map((x, i) => ({ ...x, date: ago(24 - i * 4) })), session(ago(2), [missed()]), session(ago(1), [missed()])]
    const tr = e1rmTrend('bench', bench, sessions, TODAY)
    expect(tr!.slopePctPerWeek).toBeGreaterThanOrEqual(0.5)
    expect(planExercise(bench, data(sessions), TODAY).kind).not.toBe('deload')
  })
  it('傾向の計算：伸びていれば正、横ばいなら 0', () => {
    const up = e1rmTrend('bench', bench, series(growing), TODAY)
    expect(up!.points).toBe(7)
    expect(up!.slopePctPerWeek).toBeGreaterThan(1)
    expect(e1rmTrend('bench', bench, series(flat), TODAY)!.slopePctPerWeek).toBeCloseTo(0, 5)
  })
  it('reps + RIR が 12 を超えるセットは傾向に使われない', () => {
    // 10回 + RIR 2 = 12 は使う／11回 + RIR 2 = 13 は使わない
    const ok = Array.from({ length: 6 }, (_, i) => session(ago(24 - i * 4), [entry([s(50, 10, 2)])]))
    expect(e1rmTrend('bench', bench, ok, TODAY)!.points).toBe(6)
    const high = Array.from({ length: 6 }, (_, i) => session(ago(24 - i * 4), [entry([s(50, 11, 2)])]))
    expect(e1rmTrend('bench', bench, high, TODAY)).toBeUndefined()
    // 高回数セットと通常セットが混ざる記録では通常セットだけが使われる
    const mixed = Array.from({ length: 6 }, (_, i) => session(ago(24 - i * 4), [entry([s(40, 15, 2), s(60, 5, 2)])]))
    expect(e1rmTrend('bench', bench, mixed, TODAY)!.slopePctPerWeek).toBeCloseTo(0, 5)
  })
  it('外れ値が1回あっても傾向が大きく崩れない（Theil-Sen）', () => {
    const w = [60, 60.5, 61, 100, 62, 62.5, 63] // 4 番目だけ極端な外れ値
    const tr = e1rmTrend('bench', bench, series(w), TODAY)!
    expect(tr.slopePctPerWeek).toBeGreaterThan(1)
    expect(tr.slopePctPerWeek).toBeLessThan(2)
  })
  it('デロード回の記録は点に含まれない', () => {
    const sessions = [...series(growing.slice(0, 6)), session(ago(3), [entry([s(55, 5, 2)], dl)]), session(ago(2), [entry([s(55, 5, 2)], dl)])]
    expect(e1rmTrend('bench', bench, sessions, TODAY)!.points).toBe(6)
    expect(e1rmTrend('bench', bench, sessions.slice(0, 6), TODAY)!.points).toBe(6)
  })
  it('期間外（4週より前）の記録は使われない', () => {
    const old = Array.from({ length: 6 }, (_, i) => session(ago(40 + i * 3), [entry([s(60, 5, 2)])]))
    expect(e1rmTrend('bench', bench, old, TODAY)).toBeUndefined()
    const recent = series(flat).slice(0, 6) // 6 件（最古 ago(28) まで含まれる）
    expect(e1rmTrend('bench', bench, [...old, ...recent], TODAY)!.points).toBe(6)
  })
  it('今日以降の記録は使われない', () => {
    expect(e1rmTrend('bench', bench, [...series(flat).slice(0, 5), session(TODAY, [entry([s(60, 5, 2)])])], TODAY)).toBeUndefined()
  })
})
