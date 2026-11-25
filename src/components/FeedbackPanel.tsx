import type { Entry, Exercise, Feedback } from '../types'
import './FeedbackPanel.css'

interface Props {
  ex: Exercise
  entry: Entry
  onChange: (feedback: Feedback) => void
}

type ScaleKey = 'pump' | 'workload' | 'soreness'

const SCALES: { key: ScaleKey; label: string; options: [string, string, string] }[] = [
  { key: 'pump', label: 'パンプ', options: ['弱い', 'ふつう', '強い'] },
  { key: 'workload', label: 'きつさ', options: ['楽', 'ちょうど', 'きつい'] },
  { key: 'soreness', label: '前回からの筋肉痛', options: ['なし', 'ちょうど回復', 'まだ残る'] },
]

export default function FeedbackPanel({ entry, onChange }: Props) {
  const fb: Feedback = entry.feedback ?? {}
  const complete = fb.pump !== undefined && fb.workload !== undefined && fb.soreness !== undefined && fb.joint !== undefined

  const setScale = (key: ScaleKey, value: 0 | 1 | 2) =>
    onChange({ ...entry.feedback, [key]: fb[key] === value ? undefined : value })
  const setJoint = (value: boolean) =>
    onChange({ ...entry.feedback, joint: fb.joint === value ? undefined : value })

  return (
    <div className="feedback">
      <div className="feedback-title">振り返り（来週のセット数の調整に使います）</div>
      {SCALES.map(({ key, label, options }) => (
        <div className="feedback-row" key={key}>
          <div className="small muted">{label}</div>
          <div className="seg">
            {options.map((text, i) => (
              <button
                key={text}
                type="button"
                className="btn feedback-btn"
                aria-pressed={fb[key] === i}
                onClick={() => setScale(key, i as 0 | 1 | 2)}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="feedback-row">
        <div className="small muted">関節の痛み</div>
        <div className="seg">
          <button type="button" className="btn feedback-btn" aria-pressed={fb.joint === false} onClick={() => setJoint(false)}>なし</button>
          <button type="button" className="btn feedback-btn" aria-pressed={fb.joint === true} onClick={() => setJoint(true)}>あり</button>
        </div>
      </div>
      {fb.joint === true && <div className="feedback-warn small">痛みが続く場合は種目の入れ替えを検討してください</div>}
      {complete && <div className="small muted">記録しました</div>}
    </div>
  )
}
