export type TabIconName = 'today' | 'history' | 'analysis' | 'exercises' | 'settings'

/** タブバーの線アイコン（24px、stroke 2、色は currentColor）。文字ラベルが別にあるので読み上げからは外す */
export default function TabIcon({ name }: { name: TabIconName }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'today' && (
        // ダンベル
        <>
          <path d="M6 7v10M18 7v10M3 9.5v5M21 9.5v5M6 12h12" />
        </>
      )}
      {name === 'history' && (
        // カレンダー
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </>
      )}
      {name === 'analysis' && (
        // 棒グラフ
        <path d="M5 20v-8M12 20V4M19 20v-5" />
      )}
      {name === 'exercises' && (
        // リスト
        <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
      )}
      {name === 'settings' && (
        // 歯車
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
        </>
      )}
    </svg>
  )
}
