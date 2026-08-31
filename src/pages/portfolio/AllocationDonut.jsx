import { useState } from 'react'
import { fmtCurrency } from '../../utils/portfolioStats'
import { aggregatePositionsBySymbol } from './helpers'

// Categorical allocation palette — distinct, professional, no purple
const SEGMENT_COLORS = [
  '#38bdf8',
  '#22d3ee',
  '#2dd4bf',
  '#34d399',
  '#a3e635',
  '#fbbf24',
  '#f59e0b',
  '#fb7185',
  '#60a5fa',
  '#94a3b8',
]

function segmentColor(index) {
  return SEGMENT_COLORS[index % SEGMENT_COLORS.length]
}

function polarToCartesian(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const start = polarToCartesian(cx, cy, r, startDeg)
  const end = polarToCartesian(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M${start.x},${start.y} A${r},${r},0,${large},1,${end.x},${end.y}`
}

export default function AllocationDonut({ rows, stats }) {
  const [hovered, setHovered] = useState(null)
  const [clicked, setClicked] = useState(null)
  const active = clicked ?? hovered

  const items = aggregatePositionsBySymbol(rows)
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const total = items.reduce((s, i) => s + i.value, 0)
  const totalDayChange = stats?.totalDayChange ?? items.reduce((s, i) => s + i.dayChange, 0)
  const totalValue = stats?.totalMarketValue ?? total
  const dayPct = stats?.dayChangePct ?? (totalValue > 0 ? (totalDayChange / (totalValue - totalDayChange)) * 100 : 0)

  if (items.length === 0) return null

  // Build segments
  const GAP = 3
  const totalGap = GAP * items.length
  const usable = 360 - totalGap

  let cursor = 0
  const segments = items.map((item, index) => {
    const pct = total > 0 ? item.value / total : 0
    const sweep = usable * pct
    const start = cursor
    const end = cursor + sweep
    cursor = end + GAP
    const midAngle = (start + end) / 2
    return { ...item, pct: pct * 100, start, end, midAngle, color: segmentColor(index) }
  })

  const viewSize = 420
  const cx = viewSize / 2
  const cy = viewSize / 2
  const r = 120
  const strokeW = 28
  const badgeR = r + 50

  const handleClick = (i) => setClicked(clicked === i ? null : i)

  return (
    <div>
      <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-center lg:gap-12">
        {/* Ring with badges */}
        <div className="relative shrink-0" style={{ width: viewSize, height: viewSize, overflow: 'visible' }}>
          <svg viewBox={`0 0 ${viewSize} ${viewSize}`} className="h-full w-full" style={{ overflow: 'visible' }}>
            {/* Track */}
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth={strokeW} />

            {/* Arc segments */}
            {segments.map((seg, i) => {
              const isActive = active === i
              const dimmed = active !== null && !isActive
              return (
                <path
                  key={i}
                  d={arcPath(cx, cy, isActive ? r + 4 : r, seg.start, seg.end)}
                  fill="none"
                  stroke={isActive ? '#ffffff' : seg.color}
                  strokeWidth={isActive ? strokeW + 6 : strokeW}
                  strokeLinecap="round"
                  opacity={dimmed ? 0.2 : isActive ? 1 : 0.75}
                  style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                  onClick={() => handleClick(i)}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
              )
            })}

            {/* Center text */}
            <text x={cx} y={cy - 12} textAnchor="middle" className="fill-white text-[16px] font-bold" style={{ fontFamily: 'Inter, system-ui' }}>
              {fmtCurrency(totalValue)}
            </text>
            <text x={cx} y={cy + 8} textAnchor="middle" className={`text-[11px] font-medium ${totalDayChange >= 0 ? 'fill-[#5eead4]' : 'fill-[#fca5a5]'}`}>
              {totalDayChange >= 0 ? '+' : ''}{fmtCurrency(totalDayChange)}
            </text>
            <text x={cx} y={cy + 24} textAnchor="middle" className="fill-white/30 text-[10px]">
              {dayPct >= 0 ? '+' : ''}{dayPct.toFixed(2)}% today
            </text>
          </svg>

          {/* Outside badges — pointer-events-none to prevent hover glitches */}
          {segments.map((seg, i) => {
            const pos = polarToCartesian(cx, cy, badgeR, seg.midAngle)
            const isActive = active === i
            const dimmed = active !== null && !isActive
            return (
              <div
                key={i}
                className={`pointer-events-none absolute flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium transition-all duration-200 ${
                  isActive
                    ? 'border-white/20 bg-white/10 text-white shadow-lg scale-105'
                    : dimmed
                    ? 'border-white/[0.04] bg-wall-surface/80 text-white/25'
                    : 'border-white/[0.06] bg-wall-surface text-white/60'
                }`}
                style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seg.color, opacity: dimmed ? 0.3 : 1 }} />
                <span>{seg.symbol}</span>
                <span className="tabular text-white/35">{seg.pct.toFixed(0)}%</span>
              </div>
            )
          })}
        </div>

        {/* Holdings list */}
        <div className="w-full flex-1 max-w-sm">
          <h3 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-white/30">Holdings</h3>
          <div className="space-y-0">
            {segments.map((seg, i) => {
              const isActive = active === i
              const dimmed = active !== null && !isActive
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 border-b border-white/[0.04] px-3 py-3 transition-all duration-150 last:border-0 cursor-pointer rounded-lg ${
                    isActive ? 'bg-white/[0.06]' : dimmed ? 'opacity-40' : 'hover:bg-white/[0.03]'
                  }`}
                  onClick={() => handleClick(i)}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-white/80">{seg.symbol}</p>
                    {seg.description && <p className="truncate text-[10px] text-white/30">{seg.description}</p>}
                  </div>
                  <span className="font-mono text-[11px] tabular text-white/40">{seg.pct.toFixed(1)}%</span>
                  <span className={`w-14 text-right font-mono text-[11px] tabular ${seg.dayChangePct >= 0 ? 'text-[#5eead4]' : 'text-[#fca5a5]'}`}>
                    {seg.dayChangePct >= 0 ? '+' : ''}{seg.dayChangePct.toFixed(2)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
