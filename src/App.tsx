import { useAppData } from './storage'

// 仮の画面。概要設計書の確定後に各タブ（今日・履歴・分析・種目・設定）を実装する。
export default function App() {
  const [data] = useAppData()
  return (
    <main style={{ padding: 16 }}>
      <h1>筋トレログ</h1>
      <p>開発中です。登録済みの種目: {data.exercises.length} 件</p>
    </main>
  )
}
