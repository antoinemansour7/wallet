import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { loadHistory } from '../../utils/portfolioHistory'
import { getQuoteSymbolsForRow } from '../../utils/livePrices'
import { fmtCurrency, parseNum } from '../../utils/portfolioStats'
import { previousPortfolioClose, withIntradayEndpoint } from '../../utils/performanceChart'
import ChangedValue from '../../components/ChangedValue'
import ChartPanel from './ChartPanel'

// One element for both states. A refresh gets a quiet tint after the exact new
// value is shown; scrubbing skips feedback so pointer movement never flickers.
function ChartValue({ value, animate, className }) {
  return (
    <ChangedValue
      as="p"
      value={value}
      enabled={animate}
      className={`rounded font-display font-medium tabular text-ink ${className}`}
    >
      {fmtCurrency(value)}
    </ChangedValue>
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
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function filterByRange(data, days) {
  if (days === Infinity) return data
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return data.filter((d) => d.date >= cutoffStr)
}

function chartScale(points, referenceValue) {
  const values = points.map((p) => p.marketValue)
  if (Number.isFinite(referenceValue)) values.push(referenceValue)
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

function pointFraction(points, i) {
  const duration = points.at(-1).ts - points[0].ts
  return duration > 0 ? (points[i].ts - points[0].ts) / duration : i / Math.max(1, points.length - 1)
}

function pointXY(points, i, scale, w, h) {
  const usableW = w - PAD_X * 2
  const usableH = h - PAD_Y * 2
  return {
    x: PAD_X + pointFraction(points, i) * usableW,
    y: PAD_Y + usableH - ((points[i].marketValue - scale.min) / scale.range) * usableH,
  }
}

function buildPaths(points, w, h, scale) {
  if (points.length < 2) return { line: '', area: '' }
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
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
}

function fmtDateLabel(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * What the comparison is measured against, said the way a person would say
 * it. This used to be `since ${pointLabel(basePoint)}` — on 1D that reads as
 * "since 09:30 AM", the market open stated as a clock time, which puts the
 * whole day's move at the reader's feet as though it just happened. Every
 * other range had the same problem in a quieter form: a bare date
 * ("since Jan 15, 2026") answers "since what moment" but not "over what
 * period", which is the thing the range selector actually chose.
 */
const RANGE_LABELS = {
  '1D': 'today',
  '1W': 'this week',
  '1M': 'this month',
  '3M': 'the last 3 months',
  '6M': 'the last 6 months',
  '1Y': 'this year',
  All: 'since you started',
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

// Compact labels with a quiet underline and generous touch targets.
function RangeSelector({ range, onChange, className = '' }) {
  return (
    <div role="group" aria-label="Performance range" className={`flex w-full max-w-[336px] ${className}`}>
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => onChange(r.key)}
          aria-pressed={range === r.key}
          className={`min-h-11 min-w-0 flex-1 border-b-2 text-xs font-medium transition-colors duration-motion-short focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 ${
            range === r.key ? 'border-ink/70 text-ink' : 'border-transparent text-ink/45 hover:text-ink/80'
          }`}
        >
          {r.key}
        </button>
      ))}
    </div>
  )
}

// The last point can follow the current total only after portfolio hydration,
// quote coverage, and the matching reconstruction have settled. Until then the
// server's last valid bar stays intact; no distance threshold is used, so a
// sharp real move is still shown as soon as the valuation is trustworthy.
export function withLiveEndpoint(points, liveValue, makePoint, ready = true) {
  if (!ready || !Number.isFinite(liveValue) || liveValue <= 0) return points
  const next = [...points]
  const last = next[next.length - 1]
  if (last && makePoint.isSameSlot(last)) next[next.length - 1] = { ...last, marketValue: liveValue }
  else next.push(makePoint.create(liveValue))
  return next
}

export default function PerformanceChart({ stats, rows = [], hero = false, valuationReady = false }) {
  const { user } = useAuth()
  const [snapshots, setSnapshots] = useState([])
  const [seriesResult, setSeriesResult] = useState({ key: null, points: [] })
  // Today first — the question you open the page to answer.
  const [range, setRange] = useState('1D')
  const [loading, setLoading] = useState(true)
  const [hoverIdx, setHoverIdx] = useState(null)
  const svgRef = useRef(null)
  const [width, measureRef] = useMeasuredWidth()

  const H = hero && width >= 640 ? 220 : 180
  const gradientId = useId()

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
        // Lets the server hold a holding it cannot price flat at its known
        // value rather than dropping it out of the total entirely.
        marketValue: parseNum(row['MARKET VALUE']),
      }))
      .filter((p) => p.symbol && p.quantity > 0)
  ), [rows])
  const cashValue = stats?.totalCashValue ?? 0
  const portfolioSeriesKey = JSON.stringify({ positions, cashValue })
  const series = useMemo(() => (
    seriesResult.key === portfolioSeriesKey ? seriesResult.points : []
  ), [portfolioSeriesKey, seriesResult])

  useEffect(() => {
    if (positions.length === 0) {
      setSeriesResult({ key: portfolioSeriesKey, points: [] })
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch('/api/live-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions, cashValue, days: 365 }),
    })
      .then((res) => (res.ok ? res.json() : { series: [] }))
      .then((data) => {
        if (!cancelled) setSeriesResult({
          key: portfolioSeriesKey,
          points: Array.isArray(data.series) ? data.series : [],
        })
      })
      .catch(() => {
        if (!cancelled) setSeriesResult({ key: portfolioSeriesKey, points: [] })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cashValue, portfolioSeriesKey, positions])

  // Prefer the reconstructed series; fall back to recorded snapshots
  const fullData = useMemo(() => {
    const base = series.length >= 2 ? series : snapshots
    const today = new Date().toISOString().slice(0, 10)
    return withLiveEndpoint([...base], stats?.totalMarketValue, {
      isSameSlot: (point) => point.date === today,
      create: (value) => ({ date: today, marketValue: value }),
    }, valuationReady && seriesResult.key === portfolioSeriesKey)
  }, [portfolioSeriesKey, series, seriesResult.key, snapshots, stats?.totalMarketValue, valuationReady])

  // 1D reconstructs today's line from each holding's 5-min bars server-side,
  // so it's complete from market open even if the browser was never opened.
  // Local snapshots use browser time, so cannot represent regular-session bars.
  const isIntraday = range === '1D'
  const [intradayResult, setIntradayResult] = useState({ key: null, points: [] })
  const intradaySeries = useMemo(() => (
    intradayResult.key === portfolioSeriesKey ? intradayResult.points : []
  ), [intradayResult, portfolioSeriesKey])

  useEffect(() => {
    if (!isIntraday || positions.length === 0) return
    let cancelled = false
    fetch('/api/live-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions, cashValue, intraday: true }),
    })
      .then((res) => (res.ok ? res.json() : { series: [] }))
      .then((data) => {
        if (!cancelled) setIntradayResult({
          key: portfolioSeriesKey,
          points: Array.isArray(data.series) ? data.series : [],
          session: data.session ?? null,
        })
      })
      .catch(() => {
        if (!cancelled) setIntradayResult({ key: portfolioSeriesKey, points: [] })
      })
    return () => { cancelled = true }
  }, [cashValue, isIntraday, portfolioSeriesKey, positions])

  const intradayPoints = useMemo(() => withIntradayEndpoint(
    intradaySeries, stats?.totalMarketValue, rows, intradayResult.session,
    valuationReady && intradayResult.key === portfolioSeriesKey,
  ), [intradayResult, intradaySeries, portfolioSeriesKey, rows, stats?.totalMarketValue, valuationReady])

  const selectedRange = RANGES.find((r) => r.key === range)
  const chartPoints = isIntraday ? intradayPoints : filterByRange(fullData, selectedRange?.days ?? Infinity)
  const hasChart = chartPoints.length >= 2

  // Scrubbing: the displayed value/change follow the pointer (Robinhood-style)
  const activeIdx = hoverIdx != null && hoverIdx < chartPoints.length ? hoverIdx : chartPoints.length - 1
  const activePoint = hasChart ? chartPoints[activeIdx] : null
  const basePoint = isIntraday
    ? previousPortfolioClose(series, chartPoints[0]?.ts)
    : hasChart ? chartPoints[0] : null
  const referenceValue = basePoint?.marketValue
  const change = activePoint && Number.isFinite(referenceValue) ? activePoint.marketValue - referenceValue : null
  const pct = change !== null && referenceValue > 0 ? (change / referenceValue) * 100 : null
  const isScrubbing = hoverIdx != null

  const handlePointer = (e) => {
    if (!hasChart || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    if (rect.width === 0) return
    const frac = (e.clientX - rect.left - PAD_X) / Math.max(1, rect.width - PAD_X * 2)
    const idx = chartPoints.reduce((nearest, _, i) => (
      Math.abs(pointFraction(chartPoints, i) - frac) < Math.abs(pointFraction(chartPoints, nearest) - frac) ? i : nearest
    ), 0)
    setHoverIdx(idx)
  }

  const scale = hasChart ? chartScale(chartPoints, referenceValue) : null
  const { line: linePath, area: areaPath } = hasChart
    ? buildPaths(chartPoints, width, H, scale)
    : { line: '', area: '' }
  const scrubXY = hasChart && isScrubbing ? pointXY(chartPoints, activeIdx, scale, width, H) : null
  const baselineY = hasChart && Number.isFinite(referenceValue)
    ? PAD_Y + (H - PAD_Y * 2) * (1 - (referenceValue - scale.min) / scale.range) : null
  const endXY = hasChart ? pointXY(chartPoints, chartPoints.length - 1, scale, width, H) : null

  const isPositive = isIntraday ? change === null || change >= 0
    : !hasChart || chartPoints.at(-1).marketValue >= referenceValue
  const lineColor = change === null ? 'rgb(var(--color-ink) / 0.5)'
    : `rgb(var(--color-${isPositive ? 'gain' : 'loss'}))`

  const pointLabel = (p) => (isIntraday ? fmtTime(p.ts) : fmtDateLabel(p.date))

  const onRangeChange = (key) => { setRange(key); setHoverIdx(null) }
  const valueSize = hero ? 'text-[34px] leading-none sm:text-[40px]' : 'text-2xl'

  const body = (
    <>
      {loading ? (
        <div className="flex h-[220px] items-center justify-center">
          <p className="text-[13px] text-ink/30">Building your chart…</p>
        </div>
      ) : !hasChart ? (
        <div className="flex h-[220px] flex-col items-center justify-center">
          {stats?.totalMarketValue ? (
            <>
              <ChartValue value={stats.totalMarketValue} animate className="text-2xl" />
              <span className="mt-3 h-2.5 w-2.5 rounded-full bg-gradient-accent shadow-glow-sm" />
              <p className="mt-3 text-[13px] text-ink/40">
                {isIntraday
                  ? 'Intraday line appears once the market opens'
                  : 'Not enough price history for this range yet'}
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] text-ink/40">Not enough data yet</p>
              <p className="mt-1 text-[11px] text-ink/25">Upload your portfolio to see its performance</p>
            </>
          )}
        </div>
      ) : (
        <div>
          {/* Value summary — tracks the scrubbed point. Fixed min-height so the
              two-line block never reflows as the label text changes length. */}
          <div className="mb-2 min-h-[70px]">
            <ChartValue value={activePoint.marketValue} animate={!isScrubbing} className={valueSize} />
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] tabular">
              {change !== null ? (
                <p className={change >= 0 ? 'text-gain' : 'text-loss'}>
                  {change >= 0 ? '+' : ''}{fmtCurrency(change)}
                  {pct !== null && <> ({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)</>}
                </p>
              ) : <p className="text-ink/45">Previous close unavailable</p>}
              <span className="text-ink/45">
                {isScrubbing
                  ? isIntraday ? `${fmtDateLabel(new Date(activePoint.ts).toISOString().slice(0, 10))} · ${pointLabel(activePoint)} ET` : pointLabel(activePoint)
                  : RANGE_LABELS[range]}
              </span>
            </div>
          </div>

          {/* Drawn at measured pixel width — no viewBox stretching, so the
              stroke stays 2px and the scrub dot stays round at any size. */}
          <div ref={measureRef} className="w-full">
            <svg
              ref={svgRef}
              role="slider"
              aria-label="Portfolio performance. Use arrow keys to explore values."
              aria-valuemin={0}
              aria-valuemax={chartPoints.length - 1}
              aria-valuenow={activeIdx}
              aria-valuetext={`${fmtCurrency(activePoint.marketValue)}, ${pointLabel(activePoint)}`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setHoverIdx(null); return }
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
                e.preventDefault()
                setHoverIdx(e.key === 'Home' ? 0 : e.key === 'End' ? chartPoints.length - 1
                  : Math.max(0, Math.min(chartPoints.length - 1, activeIdx + (e.key === 'ArrowLeft' ? -1 : 1))))
              }}
              onBlur={() => setHoverIdx(null)}
              width={width}
              height={H}
              viewBox={`0 0 ${width} ${H}`}
              className="block w-full cursor-crosshair touch-pan-y select-none rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/20"
              onPointerMove={handlePointer}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture?.(e.pointerId)
                handlePointer(e)
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture?.(e.pointerId)
                setHoverIdx(null)
              }}
              onPointerLeave={() => setHoverIdx(null)}
              onPointerCancel={() => setHoverIdx(null)}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity="0.10" />
                  <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Previous close on 1D, period start on longer ranges. */}
              {baselineY !== null && <line
                data-reference-value={referenceValue}
                x1={PAD_X} x2={width - PAD_X} y1={baselineY} y2={baselineY}
                stroke="rgb(var(--color-ink) / 0.18)" strokeWidth="1" strokeDasharray="2 5"
              />}

              <path d={areaPath} fill={`url(#${gradientId})`} />
              <path
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
                <circle cx={endXY.x} cy={endXY.y} r="3.5" fill={lineColor} stroke="rgb(var(--color-wall-surface))" strokeWidth="2" />
              )}

              {/* scrub hairline + dot */}
              {scrubXY && (
                <g>
                  <line x1={scrubXY.x} x2={scrubXY.x} y1={PAD_Y} y2={H - PAD_Y} stroke="rgb(var(--color-ink) / 0.22)" strokeWidth="1" />
                  <circle cx={scrubXY.x} cy={scrubXY.y} r="3.5" fill={lineColor} stroke="rgb(var(--color-wall-surface))" strokeWidth="2" />
                </g>
              )}
            </svg>
          </div>

          {/* Time labels */}
          <div className="mt-1 flex justify-between text-[10px] text-ink/45">
            <span>{pointLabel(chartPoints[0])}</span>
            <span>{pointLabel(chartPoints[chartPoints.length - 1])}</span>
          </div>

        </div>
      )}
      <RangeSelector range={range} onChange={onRangeChange} className="mt-2" />
    </>
  )

  return hero
    ? <section>{body}</section>
    : <ChartPanel title="Performance">{body}</ChartPanel>
}
