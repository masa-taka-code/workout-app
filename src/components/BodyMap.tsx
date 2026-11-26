import Model from 'react-body-highlighter'
import type { Muscle as Region } from 'react-body-highlighter'
import { regionIntensities } from '../bodymap'
import type { Muscle } from '../types'
import './BodyMap.css'

export interface BodyMapProps {
  /** 筋肉ごとの強さ 0〜1（0 または未指定は塗らない） */
  highlights: Partial<Record<Muscle, number>>
  /** 'sm' は種目カード用の小さな表示、'md' は分析画面用 */
  size?: 'sm' | 'md'
  /** 読み上げ用の説明 */
  label?: string
}

/** 強さを段階（1〜LEVELS）に分けて、段階ごとの色を用意する */
const LEVELS = 10
const COLORS = Array.from({ length: LEVELS }, (_, i) => {
  // 一番薄い段階の濃さは --map-min（ライト 25、ダーク 40）。そこから 100% まで等間隔
  const ratio = (i + 1) / LEVELS
  return `color-mix(in srgb, var(--data) calc((var(--map-min) + (100 - var(--map-min)) * ${ratio}) * 1%), transparent)`
})

const HEIGHT = { sm: 100, md: 220 }

export default function BodyMap({ highlights, size = 'sm', label }: BodyMapProps) {
  const intensities = regionIntensities(highlights)
  const data = Object.entries(intensities).map(([region, v]) => ({
    name: region,
    muscles: [region as Region],
    frequency: Math.max(1, Math.min(LEVELS, Math.round((v ?? 0) * LEVELS))),
  }))
  const h = HEIGHT[size]
  const figure = (type: 'anterior' | 'posterior') => (
    <Model
      type={type}
      data={data}
      bodyColor="var(--map-body)"
      highlightedColors={COLORS}
      style={{ height: h, width: h / 2 }}
      svgStyle={{ display: 'block', pointerEvents: 'none' }}
    />
  )
  return (
    <div className={`bodymap bodymap-${size}`} role="img" aria-label={label ?? '筋肉マップ'}>
      <div className="bodymap-figures" aria-hidden="true">
        {figure('anterior')}
        {figure('posterior')}
      </div>
      {size === 'sm' && <p className="bodymap-legend" aria-hidden="true">濃い：主に効く／薄い：補助</p>}
    </div>
  )
}
