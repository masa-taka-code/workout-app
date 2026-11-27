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
  /** 'role' は種目用（1＝主働筋、それ未満＝補助筋の2色）、'level' は4段階の濃淡（既定） */
  mode?: 'level' | 'role'
  /** 'level' のとき「少ない〜目標に近い」の凡例を出す（週ボリューム用） */
  showLevelLegend?: boolean
}

/** 段階（分析用：4段階）と役割（種目用：補助・主働の2段階）の色。値は index.css のトークン */
const LEVEL_COLORS = ['var(--map-l1)', 'var(--map-l2)', 'var(--map-l3)', 'var(--map-l4)']
const ROLE_COLORS = ['var(--map-secondary)', 'var(--map-primary)']

const HEIGHT = { sm: 100, md: 220 }

export default function BodyMap({ highlights, size = 'sm', label, mode = 'level', showLevelLegend = false }: BodyMapProps) {
  const intensities = regionIntensities(highlights)
  const data = Object.entries(intensities).map(([region, v]) => ({
    name: region,
    muscles: [region as Region],
    frequency: mode === 'role' ? ((v ?? 0) >= 1 ? 2 : 1) : Math.max(1, Math.min(LEVEL_COLORS.length, Math.ceil((v ?? 0) * LEVEL_COLORS.length - 1e-9))),
  }))
  const h = HEIGHT[size]
  const figure = (type: 'anterior' | 'posterior') => (
    <Model
      type={type}
      data={data}
      bodyColor="var(--map-body)"
      highlightedColors={mode === 'role' ? ROLE_COLORS : LEVEL_COLORS}
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
      {mode === 'role' ? (
        <p className="bodymap-legend" aria-hidden="true">
          <span className="bodymap-swatch" style={{ background: 'var(--map-primary)' }} />主に効く
          <span className="bodymap-swatch" style={{ background: 'var(--map-secondary)' }} />補助で効く
        </p>
      ) : showLevelLegend && (
        <p className="bodymap-legend" aria-hidden="true">
          少ない<span className="bodymap-ramp">{LEVEL_COLORS.map(c => <span key={c} className="bodymap-swatch" style={{ background: c }} />)}</span>目標に近い
        </p>
      )}
    </div>
  )
}
