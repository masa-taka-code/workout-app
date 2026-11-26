import { useState } from 'react'
import { bodyWeightAlert } from '../weight'
import type { AppData } from '../types'
import { readDismissed, writeDismissed } from './weightAlertState'
import './WeightAlert.css'

interface Props {
  data: AppData
  today: string
}

/** 体重が数週間続けて減っているときだけ出す注意カード。閉じた状態はその週だけ覚える */
export default function WeightAlert({ data, today }: Props) {
  const [hidden, setHidden] = useState(() => readDismissed(today))
  const alert = bodyWeightAlert(data, today)
  if (!alert || hidden) return null

  return (
    <aside className="wt-alert" aria-label="体重のお知らせ">
      <div className="wt-alert-head">
        <span className="wt-alert-icon" aria-hidden="true">⚠</span>
        <h2 className="wt-alert-title">体重のお知らせ</h2>
      </div>
      <p className="wt-alert-msg">{alert.message}</p>
      <button
        type="button"
        className="btn wt-alert-close"
        onClick={() => {
          writeDismissed(today)
          setHidden(true)
        }}
      >
        今週は閉じる
      </button>
    </aside>
  )
}
