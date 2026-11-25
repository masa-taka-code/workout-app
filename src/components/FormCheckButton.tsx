import { useState } from 'react'
import type { AppData, Entry, Exercise } from '../types'
import { formKeyFor } from '../form/engine'
import FormCheck from './FormCheck'

export interface FormCheckButtonProps {
  ex: Exercise
  entry: Entry
  data: AppData
  /** 撮影したセットの結果を、今日の次の未完了セットに反映する */
  onApply: (result: { reps: number; formScore: number }) => void
  /** 基準（良いフォームの可動域）を保存する */
  onSaveBaseline: (key: string, baseline: { romDeg: number; minAngle: number; maxAngle: number }) => void
}

export default function FormCheckButton({ ex, data, onApply, onSaveBaseline }: FormCheckButtonProps) {
  const [open, setOpen] = useState(false)
  const key = formKeyFor(ex)
  if (!key) return null
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        フォームを撮影（β）
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
