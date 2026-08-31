import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { loadHistory, loadIntradayPoints } from '../../utils/portfolioHistory'
import { getQuoteSymbolsForRow } from '../../utils/livePrices'
import { fmtCurrency } from '../../utils/portfolioStats'
import { useCountUp } from '../../utils/useCountUp'
import ChartPanel from './ChartPanel'

// One element for both states. Scrubbing shows the exact value immediately —
// animating toward the pointer would lag behind the cursor and read as jitter.
function ChartValue({ value, animate, className }) {
  const animated = useCountUp(value)
  return (
    <p className={`font-display font-medium tabular text-white ${className}`}>
      {fmtCurrency(animate ? animated : value)}
    </p>
  )
}

const RANGES = [
  { key: '1D', days: 1 },
  { key: '1W', days: 7 },
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '6M', days: 180 },
  { key: '1Y', days: 365 },
  { key: 'All', days: Infinity },
]

// The SVG is drawn at true pixel size (see useMeasuredWidth) instead of being
// stretched from a fixed viewBox — a non-uniform stretch is what made the
// stroke weight, the scrub dot and the vertical scale wobble with window width.
// PAD_X must clear the end-cap dot (r 3.5 + 2 stroke), or the latest point
// gets shaved off against the right edge.
const PAD_X = 7
const PAD_Y = 12

function parseQty(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function filterByRange(data, days) {
  if (days === Infinity) return data
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return data.filter((d) => d.date >= cutoffStr)
}

function chartScale(points) {
  const values = points.map((p) => p.marketValue)
  let min = Math.min(...values)
  let max = Math.max(...values)
  // A flat line would divide by zero and pin to an edge — centre it instead.
  if (max === min) {
    const nudge = Math.abs(max) * 0.01 || 1
    min -= nudge
    max += nudge
  }
  // Headroom so the peak and trough never touch the frame.
  const breathing = (max - min) * 0.08
  return { min: min - breathing, range: (max - min) + breathing * 2 }
}

function pointXY(points, i, scale, w, h) {
  const usableW = w - PAD_X * 2
  const usableH = h - PAD_Y * 2
  return {
    x: PAD_X + (i / Math.max(1, points.length - 1)) * usableW,
    y: PAD_Y + usableH - ((points[i].marketValue - scale.min) / scale.range) * usableH,
  }
}

function buildPaths(points, w, h) {
  if (points.length < 2) return { line: '', area: '' }
  const scale = chartScale(points)
  const line = points
    .map((_, i) => {
      const { x, y } = pointXY(points, i, scale, w, h)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const first = pointXY(points, 0, scale, w, h)
  const last = pointXY(points, points.length - 1, scale, w, h)
  return { line, area: `${line} L${last.x.toFixed(1)},${h} L${first.x.toFixed(1)},${h} Z` }
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDateLabel(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// Tracks the real rendered width so the chart can be drawn 1:1 in CSS pixels.
// A callback ref (not useEffect) so it reattaches whenever the node remounts —
// the chart is swapped out for the loading and empty states.
function useMeasuredWidth(fallback = 720) {
  const [width, setWidth] = useState(fallback)
  const observerRef = useRef(null)

  const ref = useCallback((node) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    const measure = (w) => { if (w > 0) setWidth(Math.round(w)) }
    measure(node.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width))
    ro.observe(node)
    observerRef.current = ro
  }, [])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return [width, ref]
}

// Equal-width segmented control with a sliding indicator — the pill moves
// instead of each label re-flowing, so nothing shifts as you switch ranges.
function RangeSelector({ range, onChange, className = '' }) {
  const activeIndex = Math.max(0, RANGES.findIndex((r) => r.key === range))
  return (
    <div className={`relative grid w-full max-w-[380px] grid-cols-7 rounded-full border border-white/[0.06] bg-white/[0.03] p-0.5 ${className}`}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0.5 rounded-full bg-white/[0.10] transition-transform duration-300 ease-ws"
        style={{ width: `calc((100% - 4px) / ${RANGES.length})`, left: 2, transform: `translateX(${activeIndex * 100}%)` }}
      />
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => onChange(r.key)}
          aria-pressed={range === r.key}
          className={`relative z-10 rounded-full py-1.5 text-[11px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
            range === r.key ? 'text-white' : 'text-white/35 hover:text-white/70'
          }`}
        >
          {r.key}
        </button>
      ))}
    </div>
  )
}

export default function PerformanceChart({ stats, rows = [], hero = false }) {
  const { user } = useAuth()
  const [snapshots, setSnapshots] = useState([])
  const [series, setSeries] = useState([])
  const [range, setRange] = useState('3M')
  const [loading, setLoading] = useState(true)
  const [hoverIdx, setHoverIdx] = useState(null)
  const svgRef = useRef(null)
  const [width, measureRef] = useMeasuredWidth()

  const H = hero ? 240 : 200

  // Snapshot history (fallback when reconstruction is unavailable)
  useEffect(() => {
    if (!user?.uid) return
    loadHistory(user.uid).then(setSnapshots).catch(() => {})
  }, [user?.uid])

  // Broker-style reconstruction: value today's holdings against each symbol's
  // historical closes, so the chart is complete from the first visit.
  const positions = useMemo(() => (
    rows
      .map((row) => ({
        symbol: getQuoteSymbolsForRow(row)[0],
        quantity: parseQty(row.QUANTITY),
        accountCurrency: row['ACCOUNT CURRENCY'] || '',
      }))
      .filter((p) => p.symbol && p.quantity > 0)
  ), [rows])

  useEffect(() => {
    if (positions.length === 0) {
      setLoading(false)
      return
    }
    let cancelled = false
    fetch('/api/live-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions, cashValue: stats?.totalCashValue ?? 0, days: 365 }),
    })
      .then((res) => (res.ok ? res.json() : { series: [] }))
      .then((data) => {
        if (!cancelled) setSeries(Array.isArray(data.series) ? data.series : [])
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(positions)])

  // Prefer the reconstructed series; fall back to recorded snapshots
  const fullData = useMemo(() => {
    const base = series.length >= 2 ? series : snapshots
    const today = new Date().toISOString().slice(0, 10)
    const data = [...base]
    if (stats?.totalMarketValue && !data.some((d) => d.date === today)) {
      data.push({ date: today, marketValue: stats.totalMarketValue })
    }
    return data
  }, [series, snapshots, stats])

  // 1D reconstructs today's line from each holding's 5-min bars server-side,
  // so it's complete from market open even if the browser was never opened.
  // Device-recorded localStorage points are a fallback (pre-open / weekends).
  const isIntraday = range === '1D'
  const [intradaySeries, setIntradaySeries] = useState([])

  useEffect(() => {
    if (!isIntraday || positions.length === 0) return
    let cancelled = false
    fetch('/api/live-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions, cashValue: stats?.totalCashValue ?? 0, intraday: true }),
    })
      .then((res) => (res.ok ? res.json() : { series: [] }))
      .then((data) => { if (!cancelled) setIntradaySeries(Array.isArray(data.series) ? data.series : []) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIntraday, JSON.stringify(positions)])

  const intradayPoints = useMemo(() => {
    if (!isIntraday) return []
    const base = intradaySeries.length >= 2 ? [...intradaySeries] : [...loadIntradayPoints()]
    const last = base[base.length - 1]
    if (stats?.totalMarketValue && (!last || last.marketValue !== stats.totalMarketValue)) {
      base.push({ ts: Date.now(), marketValue: stats.totalMarketValue })
    }
    return base
  }, [isIntraday, intradaySeries, stats])

  const selectedRange = RANGES.find((r) => r.key === range)
  const chartPoints = isIntraday ? intradayPoints : filterByRange(fullData, selectedRange?.days ?? Infinity)
  const hasChart = chartPoints.length >= 2

  // Scrubbing: the displayed value/change follow the pointer (Robinhood-style)
  const activeIdx = hoverIdx != null && hoverIdx < chartPoints.length ? hoverIdx : chartPoints.length - 1
  const activePoint = hasChart ? chartPoints[activeIdx] : null
  const basePoint = hasChart ? chartPoints[0] : null
  const isScrubbing = hoverIdx != null

  const handlePointer = (e) => {
    if (!hasChart || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    if (rect.width === 0) return
    const frac = (e.clientX - rect.left - PAD_X) / Math.max(1, rect.width - PAD_X * 2)
    const idx = Math.round(frac * (chartPoints.length - 1))
    setHoverIdx(Math.max(0, Math.min(chartPoints.length - 1, idx)))
  }

  const scale = hasChart ? chartScale(chartPoints) : null
  const { line: linePath, area: areaPath } = hasChart
    ? buildPaths(chartPoints, width, H)
    : { line: '', area: '' }
  const scrubXY = hasChart && isScrubbing ? pointXY(chartPoints, activeIdx, scale, width, H) : null
  const baselineY = hasChart ? pointXY(chartPoints, 0, scale, width, H).y : 0
  const endXY = hasChart ? pointXY(chartPoints, chartPoints.length - 1, scale, width, H) : null

  const isPositive = hasChart
    ? chartPoints[chartPoints.length - 1].marketValue >= chartPoints[0].marketValue
    : true
  const lineColor = isPositive ? '#34d399' : '#fb7185'
  const gradientId = `perf-area-${hero ? 'hero' : 'panel'}`

  const pointLabel = (p) => (isIntraday ? fmtTime(p.ts) : fmtDateLabel(p.date))

  const onRangeChange = (key) => { setRange(key); setHoverIdx(null) }
  const valueSize = hero ? 'text-[34px] leading-none sm:text-[40px]' : 'text-2xl'

  const body = (
    <>
      {!hero && <RangeSelector range={range} onChange={onRangeChange} className="mb-5" />}

      {loading ? (
        <div className="flex h-[240px] items-center justify-center">
          <p className="text-[13px] text-white/30">Building your chart…</p>
        </div>
      ) : !hasChart ? (
        <div className="flex h-[240px] flex-col items-center justify-center">
          {stats?.totalMarketValue ? (
            <>
              <ChartValue value={stats.totalMarketValue} animate className="text-2xl" />
              <span className="mt-3 h-2.5 w-2.5 rounded-full bg-gradient-accent shadow-glow-sm" />
              <p className="mt-3 text-[13px] text-white/40">
                {isIntraday
                  ? 'Intraday line appears once the market opens'
                  : 'Not enough price history for this range yet'}
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] text-white/40">Not enough data yet</p>
              <p className="mt-1 text-[11px] text-white/25">Upload your portfolio to see its performance</p>
            </>
          )}
        </div>
      ) : (
        <div>
          {/* Value summary — tracks the scrubbed point. Fixed min-height so the
              two-line block never reflows as the label text changes length. */}
          <div className="mb-4 min-h-[62px]">
            <ChartValue value={activePoint.marketValue} animate={!isScrubbing} className={valueSize} />
            {(() => {
              const change = activePoint.marketValue - basePoint.marketValue
              const pct = basePoint.marketValue > 0 ? (change / basePoint.marketValue) * 100 : 0
              return (
                <p className={`mt-1 text-[13px] tabular ${change >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {change >= 0 ? '+' : ''}{fmtCurrency(change)} ({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)
                  <span className="ml-2 text-white/30">{isScrubbing ? pointLabel(activePoint) : `since ${pointLabel(basePoint)}`}</span>
                </p>
              )
            })()}
          </div>

          {/* Drawn at measured pixel width — no viewBox stretching, so the
              stroke stays 2px and the scrub dot stays round at any size. */}
          <div ref={measureRef} className="w-full">
            <svg
              ref={svgRef}
              width={width}
              height={H}
              viewBox={`0 0 ${width} ${H}`}
              className="block w-full cursor-crosshair touch-none select-none"
              onPointerMove={handlePointer}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture?.(e.pointerId)
                handlePointer(e)
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture?.(e.pointerId)
                if (e.pointerType !== 'mouse') setHoverIdx(null)
              }}
              onPointerLeave={() => setHoverIdx(null)}
              onPointerCancel={() => setHoverIdx(null)}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity="0.20" />
                  <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* dashed baseline at period start */}
              <line
                x1={PAD_X} x2={width - PAD_X} y1={baselineY} y2={baselineY}
                stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="2 5"
              />

              <path key={`area-${range}`} className="fade-in-late" d={areaPath} fill={`url(#${gradientId})`} />
              <path
                key={`line-${range}`}
                className="draw-line"
                pathLength="1"
                d={linePath}
                fill="none"
                stroke={lineColor}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />

              {/* live end-cap, hidden while scrubbing so there is one focus point */}
              {endXY && !isScrubbing && (
                <circle cx={endXY.x} cy={endXY.y} r="3.5" fill={lineColor} stroke="#0a0a0c" strokeWidth="2" />
              )}

              {/* scrub hairline + dot */}
              {scrubXY && (
                <g>
                  <line x1={scrubXY.x} x2={scrubXY.x} y1={PAD_Y} y2={H - PAD_Y} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                  <circle cx={scrubXY.x} cy={scrubXY.y} r="5" fill={lineColor} stroke="#0a0a0c" strokeWidth="2" />
                </g>
              )}
            </svg>
          </div>

          {/* Time labels */}
          <div className="mt-2 flex justify-between text-[10px] text-white/25">
            <span>{pointLabel(chartPoints[0])}</span>
            <span>{pointLabel(chartPoints[chartPoints.length - 1])}</span>
          </div>

          {hero && <RangeSelector range={range} onChange={onRangeChange} className="mt-5" />}
        </div>
      )}
    </>
  )

  return hero
    ? <section>{body}</section>
    : <ChartPanel title="Performance" large>{body}</ChartPanel>
}
