import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import { useAppData } from './storage'
import { localToday, weekStart } from './logic'
import { nextWeeklyTargets } from './weekly'
import type { ScreenProps } from './types'
import Today from './screens/Today'
import History from './screens/History'
import Analysis from './screens/Analysis'
import Exercises from './screens/Exercises'
import Settings from './screens/Settings'

const TABS = [
  { id: 'today', label: '記録', Screen: Today },
  { id: 'history', label: '履歴', Screen: History },
  { id: 'analysis', label: '分析', Screen: Analysis },
  { id: 'exercises', label: '種目', Screen: Exercises },
  { id: 'settings', label: '設定', Screen: Settings },
] as const satisfies readonly { id: string; label: string; Screen: ComponentType<ScreenProps> }[]

type Tab = (typeof TABS)[number]['id']
const TAB_KEY = 'workout-app:tab'

function loadTab(): Tab {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    return TABS.find(t => t.id === saved)?.id ?? 'today'
  } catch {
    return 'today'
  }
}

export default function App() {
  const [data, setData] = useAppData()
  const [tab, setTab] = useState<Tab>(loadTab)

  // 週が変わっていたら、週目標を1回だけ見直す（起動時と、アプリを開いたまま週をまたいで表示に戻ったとき）
  useEffect(() => {
    const review = () => {
      const today = localToday()
      setData(prev =>
        weekStart(today) === prev.lastRampWeek
          ? prev
          : { ...prev, weeklyTargets: nextWeeklyTargets(prev, today), lastRampWeek: weekStart(today) },
      )
    }
    review()
    const onVisible = () => {
      if (document.visibilityState === 'visible') review()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [setData])

  const select = (t: Tab) => {
    setTab(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* 保存できない環境では無視 */
    }
  }

  const { Screen } = TABS.find(t => t.id === tab) ?? TABS[0]

  return (
    <>
      <Screen data={data} setData={setData} />
      <nav className="tabbar" aria-label="メニュー">
        {TABS.map(t => (
          <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => select(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  )
}
