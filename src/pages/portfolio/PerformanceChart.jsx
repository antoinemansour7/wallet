import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { loadHistory } from '../../utils/portfolioHistory'
import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'

const RANGES = [
  { key: '1W', days: 7 },
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '6M', days: 180 },
  { key: '1Y', days: 365 },
  { key: 'All', days: Infinity },
]

function filterByRange(data, days) {
  if (days === Infinity) return data
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return data.filter((d) => d.date >= cutoffStr)
}

function buildPath(points, width, height, padding) {
  if (points.length < 2) return ''

  const values = points.map((p) => p.marketValue)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const usableW = width - padding * 2
  const usableH = height - padding * 2

  return points
    .map((p, i) => {
      const x = padding + (i / (points.length - 1)) * usableW
      const y = padding + usableH - ((p.marketValue - min) / range) * usableH
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function buildAreaPath(points, width, height, padding) {
  if (points.length < 2) return ''

  const values = points.map((p) => p.marketValue)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const usableW = width - padding * 2
  const usableH = height - padding * 2

  const linePoints = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * usableW
    const y = padding + usableH - ((p.marketValue - min) / range) * usableH
    return { x, y }
  })

  const line = linePoints.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')
  const lastX = linePoints[linePoints.length - 1].x
  const firstX = linePoints[0].x
  const bottom = height - padding

  return `${line} L${lastX.toFixed(1)},${bottom} L${firstX.toFixed(1)},${bottom} Z`
}

export default function PerformanceChart({ stats }) {
  const { user } = useAuth()
  const [history, setHistory] = useState([])
  const [range, setRange] = useState('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.uid) return
    loadHistory(user.uid).then((data) => {
      setHistory(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [user?.uid])

  // Add today's value as last point if stats available
  const fullData = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const dataWithToday = [...history]
    if (stats && !history.some((d) => d.date === today)) {
      dataWithToday.push({
        date: today,
        marketValue: stats.totalMarketValue,
        bookValue: stats.totalBookValue,
        pnl: stats.totalPnl,
      })
    }
    return dataWithToday
  }, [history, stats])

  const selectedRange = RANGES.find((r) => r.key === range)
  const filtered = filterByRange(fullData, selectedRange?.days ?? Infinity)

  const W = 600
  const H = 200
  const PAD = 16

  const linePath = buildPath(filtered, W, H, PAD)
  const areaPath = buildAreaPath(filtered, W, H, PAD)

  const isPositive = filtered.length >= 2
    ? filtered[filtered.length - 1].marketValue >= filtered[0].marketValue
    : true

  const strokeColor = isPositive ? '#4ade80' : '#f87171'

  return (
    <ChartPanel title="Performance" large>
      {/* Range buttons */}
      <div className="mb-5 flex gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              range === r.key
                ? 'bg-white/10 text-white'
                : 'text-white/35 hover:text-white/60'
            }`}
          >
            {r.key}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-[200px] items-center justify-center">
          <p className="text-[13px] text-white/30">Loading history…</p>
        </div>
      ) : filtered.length < 2 ? (
        <div className="flex h-[200px] flex-col items-center justify-center">
          <p className="text-[13px] text-white/40">Not enough data yet</p>
          <p className="mt-1 text-[11px] text-white/25">Values are recorded daily as you use the app</p>
        </div>
      ) : (
        <div>
          {/* Value summary */}
          <div className="mb-4">
            <p className="text-2xl font-semibold tabular text-white">{fmtCurrency(filtered[filtered.length - 1].marketValue)}</p>
            {filtered.length >= 2 && (() => {
              const change = filtered[filtered.length - 1].marketValue - filtered[0].marketValue
              const pct = filtered[0].marketValue > 0 ? (change / filtered[0].marketValue) * 100 : 0
              return (
                <p className={`mt-0.5 text-[13px] tabular ${change >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {change >= 0 ? '+' : ''}{fmtCurrency(change)} ({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)
                </p>
              )
            })()}
          </div>

          {/* SVG Chart */}
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity="0.15" />
                <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#areaGrad)" />
            <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>

          {/* Date labels */}
          <div className="mt-2 flex justify-between text-[10px] text-white/25">
            <span>{filtered[0].date}</span>
            <span>{filtered[filtered.length - 1].date}</span>
          </div>
        </div>
      )}
    </ChartPanel>
  )
}
