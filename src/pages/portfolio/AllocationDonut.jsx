import { parseNum, fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { EmptyChart } from './EmptyState'

const DONUT_COLORS = [
  '#4ade80', '#60a5fa', '#f97316', '#a78bfa', '#f472b6',
  '#34d399', '#fbbf24', '#818cf8', '#fb923c', '#2dd4bf',
  '#e879f9', '#38bdf8', '#a3e635', '#f87171', '#94a3b8',
]

function buildSlices(items, total) {
  let cumulative = 0
  return items.map((item, i) => {
    const pct = total > 0 ? item.value / total : 0
    const startAngle = cumulative * 360
    cumulative += pct
    const endAngle = cumulative * 360
    return {
      ...item,
      pct,
      startAngle,
      endAngle,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
    }
  })
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  if (endAngle - startAngle >= 359.99) {
    // Full circle — draw two arcs
    const mid = polarToCartesian(cx, cy, r, startAngle + 180)
    const start = polarToCartesian(cx, cy, r, startAngle)
    return [
      `M${start.x},${start.y}`,
      `A${r},${r},0,1,1,${mid.x},${mid.y}`,
      `A${r},${r},0,1,1,${start.x},${start.y}`,
    ].join(' ')
  }
  const start = polarToCartesian(cx, cy, r, startAngle)
  const end = polarToCartesian(cx, cy, r, endAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M${start.x},${start.y} A${r},${r},0,${largeArc},1,${end.x},${end.y}`
}

export default function AllocationDonut({ rows }) {
  const items = rows
    .map((row) => ({
      symbol: row.SYMBOL || 'Other',
      value: parseNum(row['MARKET VALUE']),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)

  // Group small positions into "Other"
  const topCount = 12
  const top = items.slice(0, topCount)
  const rest = items.slice(topCount)
  if (rest.length > 0) {
    top.push({ symbol: 'Other', value: rest.reduce((s, i) => s + i.value, 0) })
  }

  const total = top.reduce((s, i) => s + i.value, 0)
  const slices = buildSlices(top, total)

  const cx = 100
  const cy = 100
  const outerR = 90
  const innerR = 62

  return (
    <ChartPanel title="Allocation" meta={`${items.length} positions`} large>
      {slices.length === 0 ? <EmptyChart /> : (
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          {/* Donut */}
          <div className="shrink-0">
            <svg viewBox="0 0 200 200" className="h-48 w-48">
              {slices.map((slice, i) => {
                if (slice.pct < 0.003) return null
                return (
                  <path
                    key={i}
                    d={describeArc(cx, cy, (outerR + innerR) / 2, slice.startAngle + 0.5, slice.endAngle - 0.5)}
                    fill="none"
                    stroke={slice.color}
                    strokeWidth={outerR - innerR}
                    strokeLinecap="butt"
                    className="transition-opacity hover:opacity-80"
                  />
                )
              })}
              {/* Center text */}
              <text x={cx} y={cy - 6} textAnchor="middle" className="fill-white text-[11px] font-medium">
                {fmtCurrency(total)}
              </text>
              <text x={cx} y={cy + 10} textAnchor="middle" className="fill-white/40 text-[8px]">
                Total
              </text>
            </svg>
          </div>

          {/* Legend */}
          <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2">
            {slices.slice(0, 12).map((slice, i) => (
              <div key={i} className="flex items-center gap-2 overflow-hidden">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                <span className="truncate text-[11px] text-white/60">{slice.symbol}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] tabular text-white/35">
                  {(slice.pct * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ChartPanel>
  )
}
