import { useEffect, useState } from 'react'
import { useAppData } from './storage'
import { localToday, rampWeeklyTargets, weekStart } from './logic'
import Today from './screens/Today'
import Analysis from './screens/Analysis'

type Tab = 'today' | 'analysis'
const TAB_KEY = 'workout-app:tab'

function loadTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'analysis' ? 'analysis' : 'today'
  } catch {
    return 'today'
  }
}

export default function App() {
  const [data, setData] = useAppData()
  const [tab, setTab] = useState<Tab>(loadTab)

  // 週が変わっていたら、週目標を1回だけ見直す
  useEffect(() => {
    const today = localToday()
    setData(prev =>
      weekStart(today) === prev.lastRampWeek
        ? prev
        : { ...prev, weeklyTargets: rampWeeklyTargets(prev, today), lastRampWeek: weekStart(today) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const select = (t: Tab) => {
    setTab(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* 保存できない環境では無視 */
    }
  }

  return (
    <>
      {tab === 'today' ? <Today data={data} setData={setData} /> : <Analysis data={data} setData={setData} />}
      <nav className="tabbar" aria-label="メニュー">
        <button aria-current={tab === 'today' ? 'page' : undefined} onClick={() => select('today')}>記録</button>
        <button aria-current={tab === 'analysis' ? 'page' : undefined} onClick={() => select('analysis')}>分析</button>
      </nav>
    </>
  )
}
