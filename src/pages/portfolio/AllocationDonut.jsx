import { useEffect, useRef, useState } from 'react'
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
]
const OTHER_COLOR = '#64748b'

const MAX_SLICES = 8

function polarToCartesian(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const sweep = endDeg - startDeg
  // A full circle can't be expressed as a single arc — its start and end points
  // coincide, so the renderer draws nothing. Split it into two halves.
  if (sweep >= 359.99) {
    const a = polarToCartesian(cx, cy, r, 0)
    const b = polarToCartesian(cx, cy, r, 180)
    return `M${a.x},${a.y} A${r},${r},0,1,1,${b.x},${b.y} A${r},${r},0,1,1,${a.x},${a.y}`
  }
  const start = polarToCartesian(cx, cy, r, startDeg)
  const end = polarToCartesian(cx, cy, r, endDeg)
  const large = sweep > 180 ? 1 : 0
  return `M${start.x},${start.y} A${r},${r},0,${large},1,${end.x},${end.y}`
}

export default function AllocationDonut({ rows, stats }) {
  const [hovered, setHovered] = useState(null)
  const [clicked, setClicked] = useState(null)
  const active = clicked ?? hovered
  const rootRef = useRef(null)

  // A pinned slice had exactly one way out: clicking the very same row again.
  // Clicking a different row just moved the pin, clicking anywhere else did
  // nothing, and hover stopped responding entirely because `clicked` takes
  // precedence over it — so the readout read as stuck on whatever was picked
  // last. Dismiss on an outside press and on Escape, the same way every other
  // popover here behaves.
  useEffect(() => {
    if (clicked === null) return undefined
    const clear = () => { setClicked(null); setHovered(null) }
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) clear()
    }
    const onKeyDown = (event) => { if (event.key === 'Escape') clear() }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [clicked])

  const all = aggregatePositionsBySymbol(rows)
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)

  // Tail positions are each a sliver too thin to label or hover. Rolling them
  // into one "Other" slice is what every broker does — it keeps the ring
  // readable instead of fraying into a dozen 0.4% shards.
  const items = all.length > MAX_SLICES
    ? [
        ...all.slice(0, MAX_SLICES),
        all.slice(MAX_SLICES).reduce(
          (acc, item) => ({
            ...acc,
            value: acc.value + item.value,
            dayChange: acc.dayChange + item.dayChange,
            previousValue: acc.previousValue + item.previousValue,
          }),
          {
            symbol: 'Other',
            description: `${all.length - MAX_SLICES} smaller positions`,
            value: 0,
            dayChange: 0,
            previousValue: 0,
            isOther: true,
          },
        ),
      ]
    : all

  const total = items.reduce((s, i) => s + i.value, 0)
  const totalDayChange = stats?.totalDayChange ?? items.reduce((s, i) => s + i.dayChange, 0)
  const totalValue = stats?.totalMarketValue ?? total
  const dayPct = stats?.dayChangePct ?? (totalValue > 0 ? (totalDayChange / (totalValue - totalDayChange)) * 100 : 0)

  if (items.length === 0) return null

  const viewSize = 300
  const cx = viewSize / 2
  const cy = viewSize / 2
  const r = 108
  const strokeW = 22

  // Butt caps, not round. A round cap adds (strokeW / 2) of arc length at each
  // end — here ~5.8° per end, which is wider than any sensible gap, so rounded
  // slices always grow over their neighbours. Butt caps make the gap exact.
  const GAP = items.length > 1 ? 2.2 : 0
  const usable = 360 - GAP * items.length
  // Every slice stays visible and hoverable even at a fraction of a percent.
  const MIN_SWEEP = 1.6

  let cursor = 0
  const rawSweeps = items.map((item) => (total > 0 ? (item.value / total) * usable : 0))
  const deficit = rawSweeps.reduce((s, sweep) => s + Math.max(0, MIN_SWEEP - sweep), 0)
  const shrinkable = rawSweeps.reduce((s, sweep) => s + Math.max(0, sweep - MIN_SWEEP), 0)

  const segments = items.map((item, index) => {
    const raw = rawSweeps[index]
    // Pay for the minimum-width slices proportionally out of the ones that can
    // spare it, so the sweeps still add up to exactly `usable`.
    const sweep = raw < MIN_SWEEP
      ? MIN_SWEEP
      : shrinkable > 0
        ? raw - (raw - MIN_SWEEP) * (deficit / shrinkable)
        : raw
    const start = cursor
    const end = cursor + sweep
    cursor = end + GAP
    const dayChangePct = item.previousValue > 0 ? (item.dayChange / item.previousValue) * 100 : 0
    return {
      ...item,
      dayChangePct,
      pct: total > 0 ? (item.value / total) * 100 : 0,
      start,
      end,
      color: item.isOther ? OTHER_COLOR : SEGMENT_COLORS[index % SEGMENT_COLORS.length],
    }
  })

  const activeSeg = active != null ? segments[active] : null
  const handleClick = (i) => setClicked(clicked === i ? null : i)

  return (
    <div ref={rootRef} className="flex flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-center lg:gap-14">
      {/* Ring — no floating labels. The centre reads out whatever is hovered,
          which is what keeps a 9-slice donut legible at any size. */}
      <div className="shrink-0" style={{ width: viewSize, maxWidth: '100%' }}>
        <svg
          viewBox={`0 0 ${viewSize} ${viewSize}`}
          className="h-auto w-full"
          role="img"
          aria-label="Allocation by position"
          onMouseLeave={() => setHovered(null)}
          // Empty space inside the ring (the hole, the corners) targets the
          // svg itself rather than a slice, so it reads as "clear".
          onClick={(event) => { if (event.target === event.currentTarget) { setClicked(null); setHovered(null) } }}
        >
          {/* Track */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth={strokeW} />

          {/* Leave is handled on the <svg>, not per-slice and not on a <g>.
              Per-slice fired leave-then-enter when crossing between slices, and
              a <g> has no geometry of its own, so the 2.2deg gaps between arcs
              counted as leaving it. Either way the centre flashed back to the
              total mid-sweep. The svg has a real hit box, so the readout only
              resets when the pointer leaves the chart entirely. */}
          <g>
            {segments.map((seg, i) => {
              const isActive = active === i
              const dimmed = active !== null && !isActive
              return (
                <path
                  key={seg.symbol}
                  // Radius only — the stroke width is constant, so an active
                  // slice grows outward without ever crossing into its neighbour.
                  d={arcPath(cx, cy, isActive ? r + 5 : r, seg.start, seg.end)}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={strokeW}
                  strokeLinecap="butt"
                  opacity={dimmed ? 0.22 : isActive ? 1 : 0.8}
                  style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
                  onClick={() => handleClick(i)}
                  onMouseEnter={() => setHovered(i)}
                />
              )
            })}
          </g>

          {/* Centre readout — always the same three lines at the same three
              positions, so switching between slices swaps text content rather
              than remounting nodes at new coordinates. */}
          <text x={cx} y={cy - 14} textAnchor="middle" pointerEvents="none" className="fill-muted-foreground text-[10px] font-medium uppercase tracking-[0.14em]">
            {activeSeg ? activeSeg.symbol : 'Total value'}
          </text>
          <text x={cx} y={cy + 8} textAnchor="middle" pointerEvents="none" className="fill-ink text-[17px] font-bold tabular">
            {fmtCurrency(activeSeg ? activeSeg.value : totalValue)}
          </text>
          <text
            x={cx}
            y={cy + 26}
            textAnchor="middle"
            pointerEvents="none"
            className={`text-[11px] tabular ${
              activeSeg ? 'fill-white/35' : totalDayChange >= 0 ? 'fill-[#5eead4]' : 'fill-[#fca5a5]'
            }`}
          >
            {activeSeg
              ? `${activeSeg.pct.toFixed(1)}% of book`
              : `${totalDayChange >= 0 ? '+' : ''}${fmtCurrency(totalDayChange)} (${dayPct >= 0 ? '+' : ''}${dayPct.toFixed(2)}%)`}
          </text>
        </svg>
      </div>

      {/* Holdings list — the legend does the labelling work */}
      <div className="w-full max-w-md flex-1">
        <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/30">Holdings</h3>
        {/* Leave handled once on the list, not per row — same reason as the ring. */}
        <div onMouseLeave={() => setHovered(null)}>
          {segments.map((seg, i) => {
            const isActive = active === i
            const dimmed = active !== null && !isActive
            return (
              <button
                key={seg.symbol}
                type="button"
                aria-pressed={clicked === i}
                onClick={() => handleClick(i)}
                onMouseEnter={() => setHovered(i)}
                className={`flex w-full items-center gap-3 rounded-lg border-b border-white/[0.04] px-3 py-2.5 text-left transition-colors duration-150 last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
                  isActive ? 'bg-white/[0.06]' : dimmed ? 'opacity-40' : 'hover:bg-white/[0.03]'
                }`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-white/80">{seg.symbol}</p>
                  {seg.description && <p className="truncate text-[10px] text-white/30">{seg.description}</p>}
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular text-white/40">
                  {seg.pct.toFixed(1)}%
                </span>
                <span
                  className={`w-16 shrink-0 text-right font-mono text-[11px] tabular ${
                    seg.dayChangePct >= 0 ? 'text-[#5eead4]' : 'text-[#fca5a5]'
                  }`}
                >
                  {seg.dayChangePct >= 0 ? '+' : ''}{seg.dayChangePct.toFixed(2)}%
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
