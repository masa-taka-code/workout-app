import { useState } from 'react'
import type { AppData, Entry, Exercise, ScreenProps } from '../types'
import { emphasisTargets, toSessionSummary } from '../form/analysis'
import { formKeyFor } from '../form/engine'
import { localToday } from '../logic'
import FormCheck from './FormCheck'
import type { FormCheckSaved } from './FormCheck'
import FormReportView from './FormReportView'
import './FormCheck.css'

const MAX_SESSIONS = 200
const MAX_REPORTS = 20

export interface FormCheckButtonProps {
  /** true ならチップの中身として「撮影を始める」ボタンだけ出す */
  bare?: boolean
  ex: Exercise
  entry: Entry
  data: AppData
  /**
   * 撮影したセットの結果を、今日の次の未完了セットに反映する。
   * endedAt は撮影が終わった時刻（Date.now() の値）。休憩タイマーはこの時刻から数える。
   */
  onApply: (result: { reps: number; formScore: number; endedAt?: number }) => void
  /** フォームの要約・詳細レポート・狙いの部位・音声やカメラの設定を保存するため */
  setData?: ScreenProps['setData']
  /** 基準（良いフォームの可動域）を保存する */
  onSaveBaseline: (key: string, baseline: { romDeg: number; minAngle: number; maxAngle: number }) => void
}

/** 直近の同種目の最大重量（完了したセットから。なければ undefined） */
function recentBest(data: AppData, exerciseId: string): number | undefined {
  let best = 0
  for (const s of data.sessions) {
    for (const e of s.entries) {
      if (e.exerciseId !== exerciseId) continue
      for (const set of e.sets) if (set.done && set.weight > best) best = set.weight
    }
  }
  return best > 0 ? best : undefined
}

export default function FormCheckButton({ ex, entry, data, onApply, setData, onSaveBaseline, bare }: FormCheckButtonProps) {
  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState(false)
  const key = formKeyFor(ex)
  if (!key) return null

  const last = data.formReports?.find(r => r.exerciseId === ex.id)
  const weight = entry.sets.find(s => !s.done)?.weight ?? 0

  /** 要約とレポートを先頭に追加して保存する */
  const save = ({ report, reps, ctx }: FormCheckSaved) => {
    if (!setData) return
    const date = localToday()
    const summary = toSessionSummary(report, reps, ctx, date)
    const id = `${date}-${ex.id}-${Date.now()}`
    setData(prev => ({
      ...prev,
      formSessions: [summary, ...(prev.formSessions ?? [])].slice(0, MAX_SESSIONS),
      formReports: [{ id, date, exerciseId: ex.id, report, reps }, ...(prev.formReports ?? [])].slice(0, MAX_REPORTS),
    }))
  }

  return (
    <>
      <button type="button" className={bare ? 'btn' : 'btn btn-ghost'} onClick={() => setOpen(true)}>
        {bare ? '撮影を始める' : 'フォームを撮影（β）'}
      </button>
      {last && (
        <button type="button" className="btn" onClick={() => setViewing(true)}>
          前回の解析を見る
        </button>
      )}
      {open && (
        <FormCheck
          ex={ex}
          formKey={key}
          baseline={data.formBaselines?.[key]}
          history={(data.formSessions ?? []).filter(h => h.exerciseId === ex.id)}
          weight={weight}
          recentBestWeight={recentBest(data, ex.id)}
          targetId={data.formTargets?.[ex.id]}
          voiceOn={data.formVoice ?? true}
          initialFacing={data.formCamera ?? 'user'}
          onTargetChange={id => setData?.(prev => ({ ...prev, formTargets: { ...prev.formTargets, [ex.id]: id } }))}
          onFacingChange={f => setData?.(prev => ({ ...prev, formCamera: f }))}
          onApply={(result, saved) => {
            save(saved)
            onApply(result)
          }}
          onSaveBaseline={onSaveBaseline}
          onClose={() => setOpen(false)}
        />
      )}
      {viewing && last && (
        <div className="fc" role="dialog" aria-modal="true" aria-label={`${ex.name}の前回の解析`}>
          <header className="fc-head">
            <div className="fc-head-row">
              <h2 className="fc-title">{ex.name}　前回の解析（{last.date}）</h2>
              <button type="button" className="btn" onClick={() => setViewing(false)}>閉じる</button>
            </div>
          </header>
          <div className="fc-body fc-body-result">
            <FormReportView
              ex={ex}
              reps={last.reps}
              report={last.report}
              targets={emphasisTargets(key)}
              targetId={last.report.emphasis.target?.id}
              readOnly
            />
            <button type="button" className="btn fc-close-bottom" onClick={() => setViewing(false)}>閉じる</button>
          </div>
        </div>
      )}
    </>
  )
}
