import { useState } from 'react'
import type { AppData, Entry, Exercise, ScreenProps } from '../types'
import { formKeyFor } from '../form/engine'
import FormCheck from './FormCheck'

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

export default function FormCheckButton({ ex, data, onApply, onSaveBaseline, bare }: FormCheckButtonProps) {
  const [open, setOpen] = useState(false)
  const key = formKeyFor(ex)
  if (!key) return null
  return (
    <>
      <button type="button" className={bare ? 'btn' : 'btn btn-ghost'} onClick={() => setOpen(true)}>
        {bare ? '撮影を始める' : 'フォームを撮影（β）'}
      </button>
      {open && (
        <FormCheck
          ex={ex}
          formKey={key}
          baseline={data.formBaselines?.[key]}
          onApply={onApply}
          onSaveBaseline={onSaveBaseline}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
