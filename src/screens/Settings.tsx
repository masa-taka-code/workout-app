import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Muscle, ScreenProps } from '../types'
import { MUSCLES } from '../types'
import { WEEKLY_MAX, WEEKLY_MIN, localToday, weeklyTarget } from '../logic'
import { defaultData } from '../storage'
import { exportFileName, parseBackup, serialize } from '../backup'
import { playTest } from '../sound'
import { toIcs } from '../schedule'
import './Settings.css'

const REST_OPTIONS = [60, 90, 120, 150, 180, 240]
const EXPORT_KEY = 'workout-app:last-export'
const STALE_DAYS = 14
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const DEFAULT_TIME = '19:00'

const formatRest = (sec: number) => {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s}秒`
  return s === 0 ? `${m}分` : `${m}分${s}秒`
}

function readLastExport(): string | undefined {
  try {
    return localStorage.getItem(EXPORT_KEY) ?? undefined
  } catch {
    return undefined
  }
}

const formatDateTime = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}

const isStale = (iso: string | undefined) => {
  if (!iso) return true
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return true
  return Date.now() - t >= STALE_DAYS * 24 * 60 * 60 * 1000
}

export default function Settings({ data, setData }: ScreenProps) {
  const [lastExport, setLastExport] = useState<string | undefined>(readLastExport)
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const fileRef = useRef<HTMLInputElement>(null)

  const soundOn = data.sound ?? true
  const setSound = (sound: boolean) => setData(prev => ({ ...prev, sound }))

  const setRest = (restSeconds: number) => setData(prev => ({ ...prev, restSeconds }))

  const changeTarget = (m: Muscle, delta: number) =>
    setData(prev => {
      const next = Math.min(WEEKLY_MAX, Math.max(WEEKLY_MIN, weeklyTarget(prev.weeklyTargets, m) + delta))
      return { ...prev, weeklyTargets: { ...prev.weeklyTargets, [m]: next } }
    })

  const resetTargets = () => {
    if (!window.confirm(`すべての週目標を${WEEKLY_MIN}セットに戻します。よろしいですか？`)) return
    setData(prev => ({ ...prev, weeklyTargets: {} }))
  }

  const scheduleDays = data.schedule?.days ?? []
  const scheduleTime = data.schedule?.time ?? DEFAULT_TIME
  const saveSchedule = (days: number[], time: string) =>
    setData(prev => {
      if (days.length === 0) return { ...prev, schedule: undefined }
      return { ...prev, schedule: { days: [...days].sort((a, b) => a - b), time } }
    })
  const toggleDay = (d: number) =>
    saveSchedule(scheduleDays.includes(d) ? scheduleDays.filter(x => x !== d) : [...scheduleDays, d], scheduleTime)
  const changeTime = (time: string) => {
    if (time) saveSchedule(scheduleDays, time)
  }

  const exportIcs = async () => {
    setError(undefined)
    setMessage(undefined)
    try {
      const ics = toIcs({ days: scheduleDays, time: scheduleTime }, localToday(), new Date())
      if (!ics) return
      const name = 'workout-schedule.ics'
      const blob = new Blob([ics], { type: 'text/calendar' })
      const file = new File([blob], name, { type: 'text/calendar' })
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] })
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return
          throw err
        }
      } else {
        const url = URL.createObjectURL(blob)
        try {
          const a = document.createElement('a')
          a.href = url
          a.download = name
          document.body.appendChild(a)
          a.click()
          a.remove()
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }
      }
    } catch {
      setError('カレンダー用のファイルを作れませんでした')
    }
  }

  const markExported = () => {
    const now = new Date().toISOString()
    try {
      localStorage.setItem(EXPORT_KEY, now)
    } catch {
      /* 保存できない環境では無視 */
    }
    setLastExport(now)
  }

  const exportData = async () => {
    setError(undefined)
    setMessage(undefined)
    try {
      const name = exportFileName(localToday())
      const blob = new Blob([serialize(data)], { type: 'application/json' })
      const file = new File([blob], name, { type: 'application/json' })
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] })
        } catch (err) {
          // キャンセルは書き出していないので、最終バックアップを更新しない
          if (err instanceof DOMException && err.name === 'AbortError') return
          throw err
        }
      } else {
        const url = URL.createObjectURL(blob)
        try {
          const a = document.createElement('a')
          a.href = url
          a.download = name
          document.body.appendChild(a)
          a.click()
          a.remove()
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }
      }
      markExported()
    } catch {
      setError('書き出せませんでした')
    }
  }

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(undefined)
    setMessage(undefined)
    let text: string
    try {
      text = await file.text()
    } catch {
      setError('ファイルを読み込めませんでした')
      return
    }
    const r = parseBackup(text)
    if (!r.ok) {
      setError(r.error)
      return
    }
    const { sessions, exercises, from, to } = r.summary
    const range = from && to ? `（${from}〜${to}）` : ''
    if (!window.confirm(`記録${sessions}件・種目${exercises}件${range}を読み込みます。今のデータは置き換えられます。よろしいですか？`)) return
    setData(() => r.data)
    setMessage('読み込みました')
  }

  const wipe = () => {
    if (!window.confirm('すべての記録と種目の設定を削除します')) return
    if (!window.confirm('本当に削除しますか？元に戻せません')) return
    setData(() => defaultData())
  }

  return (
    <section className="screen">
      <h1 className="screen-title">設定</h1>

      <div className="card">
        <h2 className="card-title">休憩タイマー</h2>
        <div className="set-rest">
          {REST_OPTIONS.map(s => (
            <button key={s} type="button" className="btn" aria-pressed={data.restSeconds === s} onClick={() => setRest(s)}>
              {formatRest(s)}
            </button>
          ))}
        </div>
        <p className="muted">単関節種目は90秒、多関節種目は2〜3分が目安</p>
        <div className="set-sound">
          <span className="set-sound-label">休憩終了の音</span>
          <div className="seg" role="group" aria-label="休憩終了の音">
            <button type="button" className="btn" aria-pressed={soundOn} onClick={() => setSound(true)}>オン</button>
            <button type="button" className="btn" aria-pressed={!soundOn} onClick={() => setSound(false)}>オフ</button>
          </div>
          <button type="button" className="btn" onClick={playTest}>音を試す</button>
        </div>
        <p className="muted">iPhone では振動しないため、音でお知らせします。マナーモードでは鳴らないことがあります。トレーニング中は画面が自動で消えないようにしています。</p>
      </div>

      <div className="card">
        <h2 className="card-title">トレーニング予定</h2>
        <div className="set-days" role="group" aria-label="トレーニングする曜日">
          {WEEK_ORDER.map(d => (
            <button key={d} type="button" className="btn" aria-pressed={scheduleDays.includes(d)} onClick={() => toggleDay(d)}>
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
        <label className="set-time">
          <span className="set-sound-label">開始時刻</span>
          <input type="time" value={scheduleTime} onChange={e => changeTime(e.target.value)} />
        </label>
        <button type="button" className="btn" disabled={scheduleDays.length === 0} onClick={exportIcs}>カレンダーに登録（.ics）</button>
        <p className="muted">iPhone の Web アプリは予約通知ができないため、カレンダーに登録して通知してもらいます。予定を変えたら登録し直してください。</p>
      </div>

      <div className="card">
        <h2 className="card-title">週の目標セット数</h2>
        <div className="stack">
          {MUSCLES.map(m => {
            const v = weeklyTarget(data.weeklyTargets, m)
            return (
              <div key={m} className="set-target-row">
                <span className="set-target-name">{m}</span>
                <button type="button" className="btn" aria-label={`${m}の目標を減らす`} disabled={v <= WEEKLY_MIN} onClick={() => changeTarget(m, -1)}>−</button>
                <span className="set-target-val">{v}</span>
                <button type="button" className="btn" aria-label={`${m}の目標を増やす`} disabled={v >= WEEKLY_MAX} onClick={() => changeTarget(m, 1)}>＋</button>
              </div>
            )
          })}
        </div>
        <p className="muted">毎週、種目後の振り返りに合わせて±1（振り返りがなければ達成率80%以上が3週続くと+1）、10〜20の範囲で自動調整されます</p>
        <button type="button" className="btn" onClick={resetTargets}>すべて{WEEKLY_MIN}に戻す</button>
      </div>

      <div className="card">
        <h2 className="card-title">バックアップ</h2>
        <p className="muted">{lastExport ? `最終バックアップ：${formatDateTime(lastExport)}` : '最終バックアップ：まだありません'}</p>
        {isStale(lastExport) && <p className="set-warn">バックアップをおすすめします</p>}
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={exportData}>書き出す（JSON）</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>読み込む</button>
          <input ref={fileRef} className="set-file" type="file" accept="application/json,.json" onChange={importFile} />
        </div>
        {error && <p className="set-error" role="alert">{error}</p>}
        {message && <p className="muted" role="status">{message}</p>}
      </div>

      <div className="card">
        <h2 className="card-title">データの初期化</h2>
        <button type="button" className="btn btn-danger" onClick={wipe}>すべてのデータを削除</button>
      </div>

      <div className="card">
        <h2 className="card-title">このアプリについて</h2>
        <p className="set-about">データはこの端末のブラウザにだけ保存されます。ブラウザのデータを消すと記録も消えるため、定期的にバックアップしてください。</p>
      </div>
    </section>
  )
}
