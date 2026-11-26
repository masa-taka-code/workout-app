import { useState } from 'react'
import './WeightAlert.css'
import { CORRUPT_KEY, clearCorruptData, downloadRawBackup, readRawData } from './errorBackup'

/** 保存データを読み込めず、元のデータを退避してあるときの注意カード（退避が無ければ何も出さない） */
export default function CorruptNotice() {
  const [present, setPresent] = useState(() => readRawData(CORRUPT_KEY) !== undefined)
  const [failed, setFailed] = useState(false)
  if (!present) return null
  return (
    <div className="wt-alert" role="alert">
      <div className="wt-alert-head">
        <span className="wt-alert-icon" aria-hidden="true">⚠</span>
        <span className="wt-alert-title">保存データを読み込めませんでした</span>
      </div>
      <p className="wt-alert-msg">保存データを読み込めなかったため、初期状態で開きました。元のデータは端末に残してあります。</p>
      {failed && <p className="wt-alert-msg">書き出せませんでした。もう一度お試しください。</p>}
      <div className="wt-alert-head">
        <button type="button" className="btn" onClick={() => setFailed(!downloadRawBackup(CORRUPT_KEY))}>元のデータを書き出す</button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (!confirm('退避してある元のデータを消します。書き出していない場合は元に戻せません。消しますか？')) return
            if (clearCorruptData()) setPresent(false)
            else setFailed(true)
          }}
        >
          消す
        </button>
      </div>
    </div>
  )
}
