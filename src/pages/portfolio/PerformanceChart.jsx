import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { loadHistory, loadIntradayPoints } from '../../utils/portfolioHistory'
import { getQuoteSymbolsForRow } from '../../utils/livePrices'
import { fmtCurrency } from '../../utils/portfolioStats'
import { useCountUp } from '../../utils/useCountUp'
import ChartPanel from './ChartPanel'

function CountUpCurrency({ value, className = 'text-2xl' }) {
  const animated = useCountUp(value)
  return (
    <p className={`font-display font-medium tabular text-white ${className}`}>{fmtCurrency(animated)}</p>
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

const W = 600
const H = 200
const PAD = 16

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
  const min = Math.min(...values)
  const max = Math.max(...values)
  return { min, range: max - min || 1 }
}

function pointXY(points, i, scale) {
  const usableW = W - PAD * 2
  const usableH = H - PAD * 2
  return {
    x: PAD + (i / (points.length - 1)) * usableW,
    y: PAD + usableH - ((points[i].marketValue - scale.min) / scale.range) * usableH,
  }
}

function buildPath(points) {
  if (points.length < 2) return ''
  const scale = chartScale(points)
  return points
    .map((_, i) => {
      const { x, y } = pointXY(points, i, scale)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function buildAreaPath(points) {
  if (points.length < 2) return ''
  const line = buildPath(points)
  const scale = chartScale(points)
  const first = pointXY(points, 0, scale)
  const last = pointXY(points, points.length - 1, scale)
  return `${line} L${last.x.toFixed(1)},${H - PAD} L${first.x.toFixed(1)},${H - PAD} Z`
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDateLabel(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PerformanceChart({ stats, rows = [], hero = false }) {
  const { user } = useAuth()
  const [snapshots, setSnapshots] = useState([])
  const [series, setSeries] = useState([])
  const [range, setRange] = useState('3M')
  const [loading, setLoading] = useState(true)
  const [hoverIdx, setHoverIdx] = useState(null)
  const svgRef = useRef(null)

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
    const frac = (e.clientX - rect.left) / rect.width
    const idx = Math.round(frac * (chartPoints.length - 1))
    setHoverIdx(Math.max(0, Math.min(chartPoints.length - 1, idx)))
  }

  const scale = hasChart ? chartScale(chartPoints) : null
  const linePath = hasChart ? buildPath(chartPoints) : ''
  const areaPath = hasChart ? buildAreaPath(chartPoints) : ''
  const scrubXY = hasChart && isScrubbing ? pointXY(chartPoints, activeIdx, scale) : null
  const baselineY = hasChart ? pointXY(chartPoints, 0, scale).y : 0

  const isPositive = hasChart
    ? chartPoints[chartPoints.length - 1].marketValue >= chartPoints[0].marketValue
    : true
  const glowColor = isPositive ? '#34d399' : '#fb7185'
  const strokeColor = isPositive ? '#34d399' : '#fb7185'

  const pointLabel = (p) => (isIntraday ? fmtTime(p.ts) : fmtDateLabel(p.date))

  const rangeButtons = (
    <div className={hero ? 'mt-3 flex gap-1' : 'mb-5 flex gap-1'}>
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => { setRange(r.key); setHoverIdx(null) }}
          className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
            range === r.key
              ? 'bg-white/10 text-white'
              : 'text-white/35 hover:text-white/60'
          }`}
        >
          {r.key}
        </button>
      ))}
    </div>
  )

  const valueSize = hero ? 'text-[34px] leading-none sm:text-[40px]' : 'text-2xl'

  const body = (
    <>
      {!hero && rangeButtons}

      {loading ? (
        <div className="flex h-[240px] items-center justify-center">
          <p className="text-[13px] text-white/30">Building your chart…</p>
        </div>
      ) : !hasChart ? (
        <div className="flex h-[240px] flex-col items-center justify-center">
          {stats?.totalMarketValue ? (
            <>
              <CountUpCurrency value={stats.totalMarketValue} />
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
          {/* Value summary — tracks the scrubbed point */}
          <div className="mb-4">
            {isScrubbing ? (
              <p className={`font-display font-medium tabular text-white ${valueSize}`}>{fmtCurrency(activePoint.marketValue)}</p>
            ) : (
              <CountUpCurrency value={activePoint.marketValue} className={valueSize} />
            )}
            {(() => {
              const change = activePoint.marketValue - basePoint.marketValue
              const pct = basePoint.marketValue > 0 ? (change / basePoint.marketValue) * 100 : 0
              return (
                <p className={`mt-0.5 text-[13px] tabular ${change >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {change >= 0 ? '+' : ''}{fmtCurrency(change)} ({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)
                  <span className="ml-2 text-white/30">{isScrubbing ? pointLabel(activePoint) : `since ${pointLabel(basePoint)}`}</span>
                </p>
              )
            })()}
          </div>

          {/* SVG Chart — pointer scrubbing */}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full cursor-crosshair touch-none select-none"
            preserveAspectRatio="none"
            onPointerMove={handlePointer}
            onPointerDown={handlePointer}
            onPointerLeave={() => setHoverIdx(null)}
          >
            <defs>
              <linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={glowColor} stopOpacity="0.18" />
                <stop offset="100%" stopColor={glowColor} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* dashed baseline at period start */}
            <line x1={PAD} x2={W - PAD} y1={baselineY} y2={baselineY} stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="2 5" />

            <path key={`area-${range}`} className="fade-in-late" d={areaPath} fill="url(#areaGrad)" />
            <path key={`line-${range}`} className="draw-line" pathLength="1" d={linePath} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

            {/* scrub hairline + dot */}
            {scrubXY && (
              <g>
                <line x1={scrubXY.x} x2={scrubXY.x} y1={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                <circle cx={scrubXY.x} cy={scrubXY.y} r="5" fill={isPositive ? '#34d399' : '#fb7185'} stroke="#0a0a0c" strokeWidth="2" />
              </g>
            )}
          </svg>

          {/* Time labels */}
          <div className="mt-2 flex justify-between text-[10px] text-white/25">
            <span>{pointLabel(chartPoints[0])}</span>
            <span>{pointLabel(chartPoints[chartPoints.length - 1])}</span>
          </div>

          {hero && rangeButtons}
        </div>
      )}
    </>
  )

  return hero
    ? <section>{body}</section>
    : <ChartPanel title="Performance" large>{body}</ChartPanel>
}
