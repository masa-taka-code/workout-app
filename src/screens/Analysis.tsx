import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { WEEKLY_MAX, localToday } from '../logic'
import {
  exerciseAchievement, exerciseSeries, exercisesWithHistory, muscleVolumeThisWeek, personalBests, weeklySummary,
} from '../stats'
import type { ScreenProps } from '../types'
import './Analysis.css'
import WeeklyReview from '../components/WeeklyReview'

const STORAGE_KEY = 'workout-app:analysis-exercise'

const cssVar = (name: string, fallback: string) => {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  } catch {
    return fallback
  }
}

/** 2026-11-24 → 11/24 */
const mmdd = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

const num = (n: number) => String(Math.round(n * 10) / 10)

function loadSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function save(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // 保存できなくても表示には影響しない
  }
}

export default function Analysis({ data }: ScreenProps) {
  const today = localToday()
  const colors = {
    accent: cssVar('--accent', '#2563eb'),
    border: cssVar('--border', '#d4d4d8'),
    muted: cssVar('--muted', '#71717a'),
  }
  const axis = { stroke: colors.border, tick: { fill: colors.muted, fontSize: 12 } }

  const muscles = useMemo(() => muscleVolumeThisWeek(data, today), [data, today])
  const exercises = useMemo(() => exercisesWithHistory(data), [data])
  const weeks = useMemo(() => weeklySummary(data, today), [data, today])

  const [saved, setSaved] = useState<string | null>(loadSaved)
  const exerciseId = exercises.find(e => e.id === saved)?.id ?? exercises[0]?.id
  const series = useMemo(() => (exerciseId ? exerciseSeries(exerciseId, data) : []), [exerciseId, data])
  const bests = exerciseId ? personalBests(exerciseId, data) : undefined
  const ach = exerciseId ? exerciseAchievement(exerciseId, data, today) : { achieved: 0, total: 0 }

  const thisWeekRate = weeks[weeks.length - 1]?.rate

  return (
    <section className="screen stack">
      <WeeklyReview data={data} today={today} />
      <div className="card">
        <h2 className="card-title">今週のボリューム</h2>
        {muscles.length === 0 ? (
          <p className="empty">記録すると、筋肉ごとの週のセット数がここに出ます</p>
        ) : (
          muscles.map(m => (
            <div className="vol-row" key={m.muscle}>
              <span className="vol-name">{m.muscle}</span>
              <div className="vol-track">
                <div className={`vol-bar ${m.status}`} style={{ width: `${Math.min(100, (m.volume / WEEKLY_MAX) * 100)}%` }} />
                <div className="vol-mark" style={{ left: `calc(${Math.min(100, (m.target / WEEKLY_MAX) * 100)}% - 1px)` }} />
              </div>
              <span className="vol-num">{num(m.volume)} / {num(m.target)}セット</span>
            </div>
          ))
        )}
        <p className="muted analysis-note">
          主働筋1、補助筋0.5で数えています。目標は毎週、種目後の振り返りに合わせて±1（振り返りがなければ達成率80%以上が3週続くと+1）、10〜20の範囲で自動調整されます。
        </p>
      </div>

      <div className="card">
        <h2 className="card-title">種目ごとの伸び</h2>
        {!exerciseId ? (
          <p className="empty">記録をつけると、種目ごとの伸びがここに出ます</p>
        ) : (
          <>
            <select
              className="analysis-select"
              aria-label="種目"
              value={exerciseId}
              onChange={e => {
                setSaved(e.target.value)
                save(e.target.value)
              }}
            >
              {exercises.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={colors.border} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={mmdd} {...axis} />
                  <YAxis unit="kg" width={52} domain={['auto', 'auto']} {...axis} />
                  <Tooltip
                    content={({ active, payload }) => {
                      const p = active ? payload?.[0]?.payload as (typeof series)[number] | undefined : undefined
                      if (!p) return null
                      return (
                        <div className="chart-tip">
                          <div>{p.date}</div>
                          <div>推定1RM {p.e1rm}kg</div>
                          <div>最大重量 {p.topWeight}kg</div>
                        </div>
                      )
                    }}
                  />
                  <Line type="monotone" dataKey="e1rm" stroke={colors.accent} strokeWidth={2} dot={{ r: 3, fill: colors.accent, stroke: colors.accent }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {bests && (
              <div className="pb-tiles">
                <div className="pb-tile">
                  <div className="pb-label">自己ベスト 推定1RM</div>
                  <div className="pb-value">{bests.e1rm.value}kg</div>
                  <div className="pb-date">{mmdd(bests.e1rm.date)}</div>
                </div>
                <div className="pb-tile">
                  <div className="pb-label">自己ベスト 最大重量</div>
                  <div className="pb-value">{bests.weight.value}kg × {bests.weight.reps}</div>
                  <div className="pb-date">{mmdd(bests.weight.date)}</div>
                </div>
              </div>
            )}
            {ach.total > 0 && (
              <p className="muted">
                目標達成 {ach.achieved} / {ach.total}回（{Math.round((ach.achieved / ach.total) * 100)}%）
              </p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2 className="card-title">週ごとの記録</h2>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weeks} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={colors.border} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" tickFormatter={mmdd} {...axis} />
              <YAxis allowDecimals={false} width={28} {...axis} />
              <Tooltip
                cursor={false}
                content={({ active, payload }) => {
                  const p = active ? payload?.[0]?.payload as (typeof weeks)[number] | undefined : undefined
                  if (!p) return null
                  return (
                    <div className="chart-tip">
                      <div>{mmdd(p.week)}の週</div>
                      <div>{p.sessions}回</div>
                      <div>目標達成率 {p.rate === undefined ? 'なし' : `${Math.round(p.rate * 100)}%`}</div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="sessions" fill={colors.accent} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="muted">
          {thisWeekRate === undefined ? '今週はまだ目標つきの記録がありません' : `今週の目標達成率 ${Math.round(thisWeekRate * 100)}%`}
        </p>
      </div>
    </section>
  )
}
