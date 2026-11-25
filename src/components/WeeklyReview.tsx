import { weekReview } from '../review'
import { addDays } from '../logic'
import { nextScheduled, plannedThisWeek } from '../schedule'
import type { AppData } from '../types'
import './WeeklyReview.css'

interface Props {
  data: AppData
  today: string
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

export default function WeeklyReview({ data, today }: Props) {
  const r = weekReview(data, today)
  const hasHistory = data.sessions.length > 0
  if (r.sessions === 0 && !hasHistory) return null

  const schedule = data.schedule
  const next = nextScheduled(schedule, today)
  const planned = plannedThisWeek(schedule, today)

  return (
    <div className="card">
      <h2 className="card-title">先週の振り返り（{md(r.week)}〜{md(addDays(r.week, 6))}）</h2>
      <p className="wr-summary">
        {r.sessions}回・{r.totalSets}セット{r.rate !== undefined && `・目標達成率 ${Math.round(r.rate * 100)}%`}
      </p>

      {r.muscles.length > 0 && (
        <div className="wr-chips">
          {r.muscles.map(m => (
            <span key={m.muscle} className={`wr-chip ${m.met ? 'wr-chip--good' : 'wr-chip--warn'}`}>
              {m.muscle} {m.volume}/{m.target}{m.met && ' ✓'}
            </span>
          ))}
        </div>
      )}

      {r.prs.map(p => (
        <p key={p.name} className="wr-pr">
          自己ベスト更新：{p.name} {p.e1rm}kg（+{Math.round((p.e1rm - p.previous) * 10) / 10}）
        </p>
      ))}

      <p>
        直近{r.activeWeeks.of}週のうち {r.activeWeeks.count}週 で週2回以上トレーニングできました
      </p>
      {r.activeWeeks.count <= 2 && <p className="muted">今週から少しずつ再開しましょう。1回休んでも影響は小さいです</p>}

      {schedule && planned > 0 && (
        <p className="muted">
          今週の予定 {planned}回
          {next && `（次は ${md(next)} ${DAY_LABELS[new Date(`${next}T00:00:00`).getDay()]} ${schedule.time}）`}
        </p>
      )}
    </div>
  )
}
