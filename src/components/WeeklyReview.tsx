import { weekReview } from '../review'
import { addDays, doneSets, weekStart } from '../logic'
import { nextScheduled, plannedThisWeek } from '../schedule'
import type { AppData } from '../types'
import MuscleBars from './MuscleBars'
import './WeeklyReview.css'

interface Props {
  data: AppData
  today: string
}

/** 自己ベストを並べる件数（これを超えた分は「ほか◯件」） */
const PR_SHOWN = 3

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

export default function WeeklyReview({ data, today }: Props) {
  const r = weekReview(data, today)
  // 今週より前に記録がない（使い始めの週）なら振り返るものがないので出さない
  const hasHistory = data.sessions.some(s => s.date < weekStart(today) && s.entries.some(e => doneSets(e).length > 0))
  if (!hasHistory) return null

  const schedule = data.schedule
  const next = nextScheduled(schedule, today)
  const planned = plannedThisWeek(schedule, today)

  return (
    <div className="card">
      <h2 className="card-title">先週の振り返り（{md(r.week)}〜{md(addDays(r.week, 6))}）</h2>
      <div className="wr-tiles">
        <div className="wr-tile">
          <span className="wr-tile-num">{r.sessions}<span className="wr-tile-unit">回</span></span>
          <span className="wr-tile-label">回数</span>
        </div>
        <div className="wr-tile">
          <span className="wr-tile-num">{r.totalSets}<span className="wr-tile-unit">セット</span></span>
          <span className="wr-tile-label">合計</span>
        </div>
        <div className="wr-tile">
          <span className="wr-tile-num">
            {r.rate === undefined ? '―' : <>{Math.round(r.rate * 100)}<span className="wr-tile-unit">%</span></>}
          </span>
          <span className="wr-tile-label">目標達成率</span>
        </div>
      </div>

      {r.muscles.length > 0 && <MuscleBars items={r.muscles} weekEnded />}

      {r.prs.length > 0 && (
        <ul className="wr-prs" aria-label="自己ベスト更新">
          {r.prs.slice(0, PR_SHOWN).map(p => (
            <li key={p.name} className="wr-pr">
              <span className="wr-star" aria-hidden="true">★</span> 自己ベスト更新：{p.name} {p.e1rm}kg（+{Math.round((p.e1rm - p.previous) * 10) / 10}）
            </li>
          ))}
          {r.prs.length > PR_SHOWN && <li className="wr-pr wr-more">ほか{r.prs.length - PR_SHOWN}件</li>}
        </ul>
      )}

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
