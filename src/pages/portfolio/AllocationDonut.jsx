import { parseNum, fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { EmptyChart } from './EmptyState'

const COLORS = ['#ffffff', '#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#27272a']

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  if (endAngle - startAngle >= 359.99) {
    const mid = polarToCartesian(cx, cy, r, startAngle + 180)
    const start = polarToCartesian(cx, cy, r, startAngle)
    return `M${start.x},${start.y} A${r},${r},0,1,1,${mid.x},${mid.y} A${r},${r},0,1,1,${start.x},${start.y}`
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

  // Top 5 only, rest grouped
  const top = items.slice(0, 5)
  const rest = items.slice(5)
  if (rest.length > 0) {
    top.push({ symbol: 'Other', value: rest.reduce((s, i) => s + i.value, 0) })
  }

  const total = top.reduce((s, i) => s + i.value, 0)

  let cumulative = 0
  const slices = top.map((item, i) => {
    const pct = total > 0 ? item.value / total : 0
    const startAngle = cumulative * 360
    cumulative += pct
    const endAngle = cumulative * 360
    return { ...item, pct, startAngle, endAngle, color: COLORS[i % COLORS.length] }
  })

  const cx = 100
  const cy = 100
  const r = 76
  const strokeW = 18
  const gap = 1.2

  return (
    <ChartPanel title="Allocation" large>
      {slices.length === 0 ? <EmptyChart /> : (
        <div className="flex flex-col items-center">
          {/* Donut */}
          <svg viewBox="0 0 200 200" className="h-44 w-44">
            {slices.map((slice, i) => {
              if (slice.pct < 0.005) return null
              return (
                <path
                  key={i}
                  d={describeArc(cx, cy, r, slice.startAngle + gap, slice.endAngle - gap)}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={strokeW}
                  strokeLinecap="round"
                  opacity={1 - i * 0.12}
                />
              )
            })}
          </svg>

          {/* Legend */}
          <div className="mt-5 w-full max-w-xs space-y-2">
            {slices.map((slice, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: slice.color, opacity: 1 - i * 0.12 }} />
                  <span className="text-[12px] text-white/60">{slice.symbol}</span>
                </div>
                <span className="font-mono text-[11px] tabular text-white/30">{(slice.pct * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ChartPanel>
  )
}
