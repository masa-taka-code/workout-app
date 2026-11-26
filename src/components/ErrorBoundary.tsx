import { Component, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { downloadRawBackup } from './errorBackup'
import './ErrorBoundary.css'

/** エラー時の表示。バックアップは保存データの生の文字列をそのまま書き出す */
export function ErrorFallback({ onReset }: { onReset: () => void }) {
  const [failed, setFailed] = useState(false)
  return (
    <main className="screen error-fallback" role="alert">
      <h1 className="screen-title">画面の表示中に問題が起きました</h1>
      <p className="muted">記録は端末に残っています。先にバックアップを書き出してから、記録画面に戻ってください。</p>
      <button type="button" className="btn btn-primary" onClick={() => setFailed(!downloadRawBackup())}>
        バックアップを書き出す
      </button>
      {failed && <p className="error-fallback-msg">保存データを読めませんでした</p>}
      <button type="button" className="btn" onClick={onReset}>
        記録画面に戻る
      </button>
    </main>
  )
}

interface Props {
  children: ReactNode
  onReset: () => void
}
interface State {
  failed: boolean
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (this.state.failed) return <ErrorFallback onReset={this.props.onReset} />
    return this.props.children
  }
}
