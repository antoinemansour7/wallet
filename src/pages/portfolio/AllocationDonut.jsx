import { useState } from 'react'
import { parseNum, fmtCurrency } from '../../utils/portfolioStats'

function segmentColor(dayChangePct) {
  if (dayChangePct > 1.5) return '#34d399'
  if (dayChangePct > 0)   return '#6ee7b7'
  if (dayChangePct < -1.5) return '#f87171'
  if (dayChangePct < 0)   return '#fca5a5'
  return '#94a3b8'
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

  const items = rows
    .map((row) => ({
      symbol: row.SYMBOL || '?',
      description: row.DESCRIPTION || '',
      value: parseNum(row['MARKET VALUE']),
      dayChange: parseNum(row['DAY CHANGE']),
      dayChangePct: parseNum(row['DAY CHANGE %']),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const total = items.reduce((s, i) => s + i.value, 0)
  const totalDayChange = stats?.totalDayChange ?? items.reduce((s, i) => s + i.dayChange, 0)
  const totalValue = stats?.totalMarketValue ?? total
  const dayPct = stats?.dayChangePct ?? (totalValue > 0 ? (totalDayChange / (totalValue - totalDayChange)) * 100 : 0)

  if (items.length === 0) return null

  const GAP_DEG = 2.5
  const totalGap = GAP_DEG * items.length
  const usableDeg = 360 - totalGap

  let cursor = 0
  const segments = items.map((item) => {
    const pct = total > 0 ? item.value / total : 0
    const sweep = usableDeg * pct
    const startDeg = cursor
    const endDeg = cursor + sweep
    cursor = endDeg + GAP_DEG
    return { ...item, pct: pct * 100, startDeg, endDeg, color: segmentColor(item.dayChangePct) }
  })

  const cx = 150
  const cy = 150
  const r = 108
  const strokeW = 22
  const hoverStrokeW = 26

  return (
    <div className="col-span-full">
      <div className="flex flex-col items-center gap-10 lg:flex-row lg:items-start lg:justify-center lg:gap-14">
        {/* Ring */}
        <div className="relative shrink-0">
          <svg viewBox="0 0 300 300" className="h-64 w-64 sm:h-72 sm:w-72">
            <defs>
              <filter id="seg-glow">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Track */}
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth={strokeW} />

            {/* Segments */}
            {segments.map((seg, i) => (
              <path
                key={i}
                d={arcPath(cx, cy, r, seg.startDeg, seg.endDeg)}
                fill="none"
                stroke={seg.color}
                strokeWidth={hovered === i ? hoverStrokeW : strokeW}
                strokeLinecap="round"
                opacity={hovered === null ? 0.75 : hovered === i ? 1 : 0.25}
                filter={hovered === i ? 'url(#seg-glow)' : undefined}
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              />
            ))}

            {/* Center */}
            <text x={cx} y={cy - 8} textAnchor="middle" className="fill-white text-[15px] font-semibold">
              {fmtCurrency(totalValue)}
            </text>
            <text x={cx} y={cy + 12} textAnchor="middle" className={`text-[10px] ${totalDayChange >= 0 ? 'fill-[#6ee7b7]' : 'fill-[#fca5a5]'}`}>
              {totalDayChange >= 0 ? '+' : ''}{fmtCurrency(totalDayChange)} ({dayPct >= 0 ? '+' : ''}{dayPct.toFixed(2)}%)
            </text>
          </svg>

          {/* Tooltip (desktop) */}
          {hovered !== null && segments[hovered] && (
            <div className="pointer-events-none absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 translate-x-full rounded-lg border border-white/[0.06] bg-[#141418]/95 px-4 py-3 shadow-2xl backdrop-blur-sm sm:block">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segments[hovered].color }} />
                <span className="text-[13px] font-medium text-white">{segments[hovered].symbol}</span>
              </div>
              {segments[hovered].description && <p className="mt-0.5 text-[10px] text-white/35">{segments[hovered].description}</p>}
              <div className="mt-2.5 space-y-1.5 text-[11px]">
                <div className="flex justify-between gap-6"><span className="text-white/35">Value</span><span className="tabular text-white/70">{fmtCurrency(segments[hovered].value)}</span></div>
                <div className="flex justify-between gap-6"><span className="text-white/35">Weight</span><span className="tabular text-white/70">{segments[hovered].pct.toFixed(1)}%</span></div>
                <div className="flex justify-between gap-6"><span className="text-white/35">Day</span><span className={`tabular ${segments[hovered].dayChange >= 0 ? 'text-[#6ee7b7]' : 'text-[#fca5a5]'}`}>{segments[hovered].dayChange >= 0 ? '+' : ''}{fmtCurrency(segments[hovered].dayChange)}</span></div>
              </div>
            </div>
          )}
        </div>

        {/* Holdings list */}
        <div className="w-full max-w-xs">
          {segments.map((seg, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 border-b border-white/[0.04] px-2 py-2.5 transition-colors duration-150 last:border-0 ${hovered === i ? 'bg-white/[0.04]' : ''}`}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: seg.color, opacity: hovered === null ? 0.75 : hovered === i ? 1 : 0.3 }} />
              <span className="flex-1 text-[12px] text-white/60">{seg.symbol}</span>
              <span className="font-mono text-[11px] tabular text-white/30">{seg.pct.toFixed(1)}%</span>
              <span className={`w-12 text-right font-mono text-[11px] tabular ${seg.dayChangePct >= 0 ? 'text-[#6ee7b7]' : 'text-[#fca5a5]'}`}>
                {seg.dayChangePct >= 0 ? '+' : ''}{seg.dayChangePct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
