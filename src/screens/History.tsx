import { useState } from 'react'
import type { Condition, Entry, ScreenProps, Session } from '../types'
import { achieved, bestE1rm, doneSets } from '../logic'
import OverflowMenu from '../components/OverflowMenu'
import UndoToast from '../components/UndoToast'
import { isPersonalBest } from '../components/analysisView'
import { restoreSession } from '../components/todayLogic'
import './History.css'

const PAGE = 50
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
/** 調子は文字で出す。不調だけ注意色（warn-text） */
const CONDITION_TEXT: Record<Condition, { label: string; cls: string }> = {
  good: { label: '好調', cls: '' },
  normal: { label: '普通', cls: '' },
  bad: { label: '不調', cls: 'hist-cond-bad' },
}

const num = (n: number) => String(Math.round(n * 100) / 100)
const yen = (n: number) => Math.round(n).toLocaleString('en-US')

/** YYYY-MM-DD を「11月24日（火）」に */
function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`
}

/** 日付の列に出す「24」と「火」 */
function dayParts(date: string): { day: number; weekday: string } {
  const d = new Date(`${date}T00:00:00`)
  return { day: d.getDate(), weekday: WEEKDAYS[d.getDay()] }
}

/** 月ごとの見出し「2026年11月」 */
function monthLabel(date: string): string {
  const [y, m] = date.split('-')
  return `${y}年${Number(m)}月`
}

function setsText(entry: Entry): string {
  const sets = doneSets(entry)
  const sameWeight = sets.every(s => s.weight === sets[0].weight)
  return sameWeight
    ? `${num(sets[0].weight)}kg × ${sets.map(s => s.reps).join(', ')}`
    : sets.map(s => `${num(s.weight)}kg×${s.reps}`).join(', ')
}

const hasRecord = (s: Session) =>
  s.entries.some(e => doneSets(e).length > 0) || (s.note ?? '').trim() !== ''

export default function History({ data, setData }: ScreenProps) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [limit, setLimit] = useState(PAGE)
  // 削除した記録を5秒間だけ取り消せるように覚えておく
  const [deleted, setDeleted] = useState<{ session: Session; message: string } | null>(null)

  const exById = new Map(data.exercises.map(e => [e.id, e]))
  const sessions = data.sessions
    .filter(hasRecord)
    .sort((a, b) => b.date.localeCompare(a.date))
  const shown = sessions.slice(0, limit)

  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // 取り消せるので確認ダイアログは出さない（手順を減らす）
  const remove = (s: Session) => {
    setData(prev => ({ ...prev, sessions: prev.sessions.filter(x => x.id !== s.id) }))
    setDeleted({ session: s, message: `${dateLabel(s.date).replace(/（.）$/, '')}の記録を削除しました` })
  }

  return (
    <section className="screen">
      <h1 className="screen-title">履歴</h1>

      {sessions.length === 0 && (
        <p className="empty">まだ記録がありません。記録タブで今日のトレーニングを始めましょう</p>
      )}

      {shown.map((s, i) => {
        const entries = s.entries.filter(e => doneSets(e).length > 0)
        const totalSets = entries.reduce((n, e) => n + doneSets(e).length, 0)
        const volume = entries.reduce((n, e) => n + doneSets(e).reduce((v, x) => v + x.weight * x.reps, 0), 0)
        const isOpen = open.has(s.id)
        const cond = s.condition ? CONDITION_TEXT[s.condition] : undefined
        const { day, weekday } = dayParts(s.date)
        const hasPr = entries.some(e => {
          const ex = exById.get(e.exerciseId)
          return ex ? isPersonalBest(e, ex, data.sessions, s.date) : false
        })
        const month = monthLabel(s.date)
        const heading = i === 0 || monthLabel(shown[i - 1].date) !== month ? month : undefined
        const note = (s.note ?? '').trim()
        const hasSetNote = entries.some(e => doneSets(e).some(x => (x.note ?? '').trim() !== ''))

        return (
          <div key={s.id} className="stack">
            {heading && <h2 className="hist-month">{heading}</h2>}
            <article className="card">
              <div className="hist-head">
                <button
                  className="hist-toggle"
                  aria-expanded={isOpen}
                  aria-controls={`hist-${s.id}`}
                  onClick={() => toggle(s.id)}
                >
                  <span className="hist-date" aria-hidden="true">
                    <span className="hist-day">{day}</span>
                    <span className="hist-weekday">{weekday}</span>
                  </span>
                  <span className="sr-only">{dateLabel(s.date)}　</span>
                  <span className="hist-main">
                    <span className="hist-names">
                      {entries.map(e => exById.get(e.exerciseId)?.name ?? '削除された種目').join('・')}
                    </span>
                    <span className="hist-sub">
                      <span>{totalSets}セット</span>
                      {cond && <span className={cond.cls}>{cond.cls ? '⚠ ' : ''}調子：{cond.label}</span>}
                      {s.bodyWeight ? <span>体重{num(s.bodyWeight)}kg</span> : null}
                      {hasSetNote || note ? <span>メモあり</span> : null}
                      {hasPr && <span className="badge badge-pr">★ 自己ベスト</span>}
                    </span>
                  </span>
                  <span className="hist-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                </button>
                <OverflowMenu
                  label={`${dateLabel(s.date)}の記録のメニュー`}
                  items={[{ label: 'この記録を削除', danger: true, onSelect: () => remove(s) }]}
                />
              </div>

              {isOpen && (
                <div id={`hist-${s.id}`} className="hist-detail">
                  {entries.map(e => {
                    const ex = exById.get(e.exerciseId)
                    const t = e.target
                    const ach = achieved(e)
                    const best = ex ? bestE1rm(e, ex) : 0
                    const noted = e.sets
                      .map((x, idx) => ({ n: idx + 1, x }))
                      .filter(({ x }) => x.done && (x.note ?? '').trim() !== '')
                    const rirs = doneSets(e).filter(x => x.rir !== undefined).map(x => x.rir)
                    return (
                      <div key={e.exerciseId} className="hist-entry">
                        <div className="hist-line">
                          <span className="hist-entry-name">{ex ? ex.name : '削除された種目'}</span>
                          <span>{setsText(e)}</span>
                          {rirs.length > 0 && <span className="muted small">RIR {rirs.join(',')}</span>}
                        </div>
                        {t && t.kind !== 'first' && (
                          <div className="hist-line muted small">
                            <span>目標 {num(t.weight)}kg × {t.reps}</span>
                            {ach !== undefined && (
                              <span className={`badge ${ach ? 'badge-good' : 'hist-miss'}`}>{ach ? '✓ 達成' : `△ 未達（目標 ${t.reps}回）`}</span>
                            )}
                          </div>
                        )}
                        {noted.length > 0 && (
                          <ul className="hist-set-notes muted small">
                            {noted.map(({ n, x }) => (
                              <li key={n}>{n}セット目：{(x.note ?? '').trim()}</li>
                            ))}
                          </ul>
                        )}
                        {best > 0 && (
                          <span className="hist-line">
                            <span className="muted small">推定1RM {num(best)}kg</span>
                            {ex && isPersonalBest(e, ex, data.sessions, s.date) && <span className="badge badge-pr">★ 自己ベスト</span>}
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {note && <p className="hist-note muted">{note}</p>}
                  <p className="hist-total">総挙上量 {yen(volume)}kg</p>
                </div>
              )}
            </article>
          </div>
        )
      })}

      {sessions.length > limit && (
        <button className="btn hist-more" onClick={() => setLimit(n => n + PAGE)}>さらに表示</button>
      )}

      {deleted && (
        <UndoToast
          message={deleted.message}
          onUndo={() => {
            const snap = deleted.session
            setData(prev => restoreSession(prev, snap))
            setDeleted(null)
          }}
          onExpire={() => setDeleted(null)}
        />
      )}
    </section>
  )
}
