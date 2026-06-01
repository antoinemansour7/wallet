import { parseNum } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { EmptyChart } from './EmptyState'

const COLORS = ['#ffffff', '#a1a1aa', '#6b7280', '#4b5563', '#374151']

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

  const top = items.slice(0, 5)
  const rest = items.slice(5)
  if (rest.length > 0) {
    top.push({ symbol: `+${rest.length} others`, value: rest.reduce((s, i) => s + i.value, 0) })
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
  const r = 82
  const strokeW = 6
  const gap = 2.5

  return (
    <ChartPanel title="Allocation" large>
      {slices.length === 0 ? <EmptyChart /> : (
        <div className="flex items-center justify-center gap-10">
          {/* Ring */}
          <svg viewBox="0 0 200 200" className="h-40 w-40 shrink-0">
            {/* Background track */}
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={strokeW} />
            {slices.map((slice, i) => {
              if (slice.pct < 0.008) return null
              return (
                <path
                  key={i}
                  d={describeArc(cx, cy, r, slice.startAngle + gap, slice.endAngle - gap)}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={strokeW}
                  strokeLinecap="round"
                  opacity={1 - i * 0.15}
                />
              )
            })}
          </svg>

          {/* Legend */}
          <div className="space-y-3">
            {slices.map((slice, i) => (
              <div key={i} className="flex items-center gap-3">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: slice.color, opacity: 1 - i * 0.15 }}
                />
                <span className="w-16 text-[12px] text-white/50">{slice.symbol}</span>
                <span className="font-mono text-[11px] tabular text-white/25">
                  {(slice.pct * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ChartPanel>
  )
}
