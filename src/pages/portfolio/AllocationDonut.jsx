import { useState } from 'react'
import { parseNum, fmtCurrency } from '../../utils/portfolioStats'

function petalPath(cx, cy, angle, innerR, outerR, width) {
  const rad = ((angle - 90) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const perpCos = Math.cos(rad + Math.PI / 2)
  const perpSin = Math.sin(rad + Math.PI / 2)

  const hw = width / 2

  // Inner point
  const ix = cx + innerR * cos
  const iy = cy + innerR * sin

  // Outer point (tip)
  const ox = cx + outerR * cos
  const oy = cy + outerR * sin

  // Control points for bulge
  const midR = (innerR + outerR) / 2
  const mx = cx + midR * cos
  const my = cy + midR * sin

  const left1x = mx + hw * 1.3 * perpCos
  const left1y = my + hw * 1.3 * perpSin
  const right1x = mx - hw * 1.3 * perpCos
  const right1y = my - hw * 1.3 * perpSin

  // Base width
  const blx = ix + hw * 0.6 * perpCos
  const bly = iy + hw * 0.6 * perpSin
  const brx = ix - hw * 0.6 * perpCos
  const bry = iy - hw * 0.6 * perpSin

  return `M${ix},${iy} C${blx},${bly} ${left1x},${left1y} ${ox},${oy} C${right1x},${right1y} ${brx},${bry} ${ix},${iy} Z`
}

function getPerformanceColor(dayChangePct) {
  if (dayChangePct > 1) return { fill: '#22c55e', glow: '#22c55e40' }
  if (dayChangePct > 0) return { fill: '#4ade80', glow: '#4ade8030' }
  if (dayChangePct < -1) return { fill: '#ef4444', glow: '#ef444440' }
  if (dayChangePct < 0) return { fill: '#f87171', glow: '#f8717130' }
  return { fill: '#6b7280', glow: '#6b728020' }
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
      pnl: parseNum(row['UNREALIZED GAIN/LOSS']),
      pnlPct: parseNum(row['UNREALIZED GAIN/LOSS %']),
      qty: parseNum(row.QUANTITY),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12)

  const total = items.reduce((s, i) => s + i.value, 0)
  const totalDayChange = stats?.totalDayChange ?? items.reduce((s, i) => s + i.dayChange, 0)
  const totalValue = stats?.totalMarketValue ?? total
  const dayChangePct = stats?.dayChangePct ?? (totalValue > 0 ? (totalDayChange / (totalValue - totalDayChange)) * 100 : 0)

  if (items.length === 0) return null

  const cx = 160
  const cy = 160
  const innerR = 68
  const baseOuter = 110
  const maxOuter = 145

  // Distribute petals evenly
  const angleStep = 360 / items.length
  const maxValue = Math.max(...items.map((i) => i.value))

  const petals = items.map((item, i) => {
    const angle = i * angleStep
    const sizeRatio = 0.5 + 0.5 * (item.value / maxValue)
    const outerR = baseOuter + (maxOuter - baseOuter) * sizeRatio
    const width = 18 + 14 * sizeRatio
    const pct = total > 0 ? (item.value / total) * 100 : 0
    const colors = getPerformanceColor(item.dayChangePct)
    return { ...item, angle, outerR, width, pct, colors }
  })

  const hoveredItem = hovered !== null ? petals[hovered] : null

  return (
    <div className="col-span-full">
      <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-start lg:justify-center lg:gap-16">
        {/* Blossom Ring */}
        <div className="relative shrink-0">
          <svg viewBox="0 0 320 320" className="h-72 w-72 sm:h-80 sm:w-80">
            <defs>
              {petals.map((petal, i) => (
                <radialGradient key={i} id={`petal-grad-${i}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={petal.colors.fill} stopOpacity="0.9" />
                  <stop offset="100%" stopColor={petal.colors.fill} stopOpacity="0.4" />
                </radialGradient>
              ))}
              <filter id="petal-glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Subtle ring track */}
            <circle cx={cx} cy={cy} r={innerR + 4} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />

            {/* Petals */}
            {petals.map((petal, i) => (
              <g key={i} className="transition-transform duration-200 origin-center" filter={hovered === i ? 'url(#petal-glow)' : undefined}>
                <path
                  d={petalPath(cx, cy, petal.angle, innerR + 6, petal.outerR, petal.width)}
                  fill={`url(#petal-grad-${i})`}
                  opacity={hovered === null ? 0.85 : hovered === i ? 1 : 0.35}
                  className="cursor-pointer transition-opacity duration-200"
                  style={{ transform: hovered === i ? `scale(1.06)` : 'scale(1)', transformOrigin: `${cx}px ${cy}px` }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
                {/* Ticker label */}
                {petal.pct >= 4 && (() => {
                  const labelR = (innerR + petal.outerR) / 2 + 4
                  const rad = ((petal.angle - 90) * Math.PI) / 180
                  const lx = cx + labelR * Math.cos(rad)
                  const ly = cy + labelR * Math.sin(rad)
                  return (
                    <text
                      x={lx} y={ly}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="pointer-events-none select-none fill-white/80 text-[7px] font-medium"
                      style={{ opacity: hovered === null || hovered === i ? 1 : 0.3 }}
                    >
                      {petal.symbol}
                    </text>
                  )
                })()}
              </g>
            ))}

            {/* Center */}
            <text x={cx} y={cy - 10} textAnchor="middle" className="fill-white text-[13px] font-semibold">
              {fmtCurrency(totalValue)}
            </text>
            <text x={cx} y={cy + 8} textAnchor="middle" className={`text-[9px] ${totalDayChange >= 0 ? 'fill-[#4ade80]' : 'fill-[#f87171]'}`}>
              {totalDayChange >= 0 ? '+' : ''}{fmtCurrency(totalDayChange)} ({dayChangePct >= 0 ? '+' : ''}{dayChangePct.toFixed(2)}%)
            </text>
          </svg>

          {/* Hover tooltip */}
          {hoveredItem && (
            <div className="pointer-events-none absolute left-1/2 top-full z-10 -translate-x-1/2 -translate-y-4 rounded-xl border border-white/[0.08] bg-[#1a1a1f]/95 px-4 py-3 shadow-xl backdrop-blur-md">
              <p className="text-[13px] font-semibold text-white">{hoveredItem.symbol}</p>
              {hoveredItem.description && <p className="text-[11px] text-white/40">{hoveredItem.description}</p>}
              <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 text-[11px]">
                <span className="text-white/40">Weight</span>
                <span className="text-right tabular text-white/70">{hoveredItem.pct.toFixed(1)}%</span>
                <span className="text-white/40">Value</span>
                <span className="text-right tabular text-white/70">{fmtCurrency(hoveredItem.value)}</span>
                <span className="text-white/40">Day</span>
                <span className={`text-right tabular ${hoveredItem.dayChange >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                  {hoveredItem.dayChange >= 0 ? '+' : ''}{fmtCurrency(hoveredItem.dayChange)} ({hoveredItem.dayChangePct >= 0 ? '+' : ''}{hoveredItem.dayChangePct.toFixed(2)}%)
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Holdings list */}
        <div className="w-full max-w-sm space-y-2">
          {petals.map((item, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 transition-colors duration-150 ${
                hovered === i ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
              }`}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Color dot */}
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.colors.fill }} />
              {/* Ticker + name */}
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-white/80">{item.symbol}</p>
                <p className="truncate text-[10px] text-white/30">{item.description}</p>
              </div>
              {/* Value + change */}
              <div className="shrink-0 text-right">
                <p className="font-mono text-[11px] tabular text-white/60">{fmtCurrency(item.value)}</p>
                <p className={`font-mono text-[10px] tabular ${item.dayChangePct >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                  {item.dayChangePct >= 0 ? '+' : ''}{item.dayChangePct.toFixed(2)}%
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
