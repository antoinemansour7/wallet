import { useEffect, useMemo, useRef, useState } from 'react'
import { getQuoteSymbolsForRow } from '../../utils/livePrices'
import { parseNum, fmtPct } from '../../utils/portfolioStats'
import { comparisonHasGap, comparisonTimePosition, normalizeComparison } from './chartAnalytics'
import ChartPanel from './ChartPanel'

const RANGES = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 }
const BENCHMARKS = { '^GSPC': 'S&P 500', '^GSPTSE': 'S&P/TSX' }
const dateLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

function ComparisonPlot({ points, benchmark }) {
  const [active, setActive] = useState(null)
  const plotRef = useRef(null)
  const [size, setSize] = useState({ width: 1000, height: 300 })
  useEffect(() => {
    const element = plotRef.current
    const measure = () => setSize({ width: element.clientWidth || 1000, height: element.clientHeight || 300 })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const { width, height } = size
  const left = 7, right = 47, top = 24, bottom = 22
  const all = points.flatMap((point) => [point.portfolio, point.benchmark])
  const low = Math.min(0, ...all), high = Math.max(0, ...all)
  const pad = Math.max((high - low) * 0.17, 1)
  const min = low - pad, max = high + pad
  const x = (index) => left + comparisonTimePosition(points, index) * (width - left - right)
  const y = (value) => top + (max - value) / (max - min) * (height - top - bottom)
  const path = (field) => points.map((point, index) => `${index && !comparisonHasGap(points[index - 1], point) ? 'L' : 'M'}${x(index).toFixed(2)},${y(point[field]).toFixed(2)}`).join(' ')
  const index = Math.max(0, Math.min(points.length - 1, active ?? points.length - 1))
  const point = points[index]
  const ticks = [min + (max - min) * .2, min + (max - min) * .5, min + (max - min) * .8]
  const move = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const relative = (event.clientX - rect.left) / rect.width * width
    setActive(points.reduce((nearest, _point, candidate) => Math.abs(x(candidate) - relative) < Math.abs(x(nearest) - relative) ? candidate : nearest, 0))
  }
  const keyboard = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    setActive(event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1))))
  }
  return <>
    <div ref={plotRef} className="comparison-plot" role="slider" tabIndex={0} aria-label="Explore historical comparison by date" aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={index} aria-valuetext={`${dateLabel(point.date)}: holdings ${fmtPct(point.portfolio)}, ${benchmark} ${fmtPct(point.benchmark)}`} onKeyDown={keyboard} onBlur={() => setActive(null)} onPointerMove={move} onPointerDown={move} onPointerLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {ticks.map((tick) => <g key={tick}><line className="comparison-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} /><text className="comparison-axis" x={width - right + 13} y={y(tick) + 4}>{tick.toFixed(1)}%</text></g>)}
        <line className="comparison-zero" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
        <path className="comparison-market" d={path('benchmark')} vectorEffect="non-scaling-stroke" />
        <path className="comparison-holdings" d={path('portfolio')} vectorEffect="non-scaling-stroke" />
        {points.map((point, index) => comparisonHasGap(points[index - 1], point) || index === points.length - 1 ? <g key={point.date}><circle className="comparison-dot" cx={x(index)} cy={y(point.portfolio)} r="3" /><circle className="comparison-market-dot" cx={x(index)} cy={y(point.benchmark)} r="3" /></g> : null)}
        {active !== null && <><line className="comparison-cursor" x1={x(index)} x2={x(index)} y1={top} y2={height - bottom} /><circle className="comparison-dot" cx={x(index)} cy={y(point.portfolio)} r="4" /><circle className="comparison-market-dot" cx={x(index)} cy={y(point.benchmark)} r="4" /></>}
      </svg>
      {active !== null && <div className="comparison-tooltip" style={{ left: `${Math.max(16, Math.min(80, x(index) / width * 100))}%` }}><strong>{dateLabel(point.date)}</strong><span><i className="analytics-key" />Your holdings <b>{fmtPct(point.portfolio)}</b></span><span><i className="analytics-key is-market" />{benchmark}<b>{fmtPct(point.benchmark)}</b></span></div>}
    </div>
    <div className="comparison-dates"><span>{dateLabel(points[0].date)}</span><span>{dateLabel(new Date((Date.parse(points[0].date) + Date.parse(points.at(-1).date)) / 2).toISOString().slice(0, 10))}</span><span>{dateLabel(points.at(-1).date)}</span></div>
    <span className="sr-only">Use the left and right arrow keys to explore dates, or open the data table below.</span>
  </>
}

export default function ComparisonChart({ scope }) {
  const [range, setRange] = useState('3M')
  const [benchmark, setBenchmark] = useState('^GSPC')
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supported = ['CAD', 'USD'].includes(scope.currency)
  // A stable primitive dependency also prevents live UI rerenders from
  // restarting an in-flight history request with identical inputs.
  const request = JSON.stringify({ comparison: true, positions: scope.rows.map((row) => ({ symbol: getQuoteSymbolsForRow(row)[0] || '', quantity: parseNum(row.QUANTITY), marketValue: parseNum(row['MARKET VALUE']) })), cashValue: scope.cash, currency: scope.currency, benchmark })
  useEffect(() => {
    if (!supported) return
    const controller = new AbortController()
    let cancelled = false
    const timeout = setTimeout(() => controller.abort(), 30000)
    setLoading(true); setResult(null); setError('')
    fetch('/api/live-prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: request, signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error('History is unavailable'); return response.json() })
      .then((data) => { if (!cancelled) setResult(data) })
      .catch(() => { if (!cancelled) setError('We couldn’t load price history. Please try again.') })
      .finally(() => { clearTimeout(timeout); if (!cancelled) setLoading(false) })
    return () => { cancelled = true; clearTimeout(timeout); controller.abort() }
  }, [request, supported, attempt])
  const points = useMemo(() => normalizeComparison(result?.series || [], RANGES[range]), [result, range])
  const latest = points.at(-1)
  const name = BENCHMARKS[benchmark]
  const difference = latest ? latest.portfolio - latest.benchmark : 0
  const ready = !loading && !error && points.length >= 2
  const hasGaps = points.some((point, index) => comparisonHasGap(points[index - 1], point))
  return <ChartPanel title="Holdings vs. market" className="comparison-panel" meta={<span className="analytics-panel-tag">HISTORICAL COMPARISON</span>}>
    <div className="comparison-controls"><p>Price change of what you own today</p><label><span className="sr-only">Market benchmark</span><select aria-label="Market benchmark" value={benchmark} onChange={(event) => setBenchmark(event.target.value)}>{Object.entries(BENCHMARKS).map(([symbol, label]) => <option key={symbol} value={symbol}>{label}</option>)}</select></label></div>
    <div className="comparison-summary"><div><span><i className="analytics-key" />Your holdings</span><strong>{ready ? fmtPct(latest.portfolio) : '—'}</strong></div><div><span><i className="analytics-key is-market" />{name}</span><strong>{ready ? fmtPct(latest.benchmark) : '—'}</strong></div><div className="comparison-difference"><span>Difference</span><strong>{ready ? `${difference >= 0 ? '+' : '−'}${Math.abs(difference).toFixed(2)}` : '—'}{ready && <small> pp</small>}</strong></div></div>
    <div className="comparison-range-row"><span>{scope.currency} · Price change</span><div className="analytics-segmented" aria-label="Comparison period">{Object.keys(RANGES).map((value) => <button type="button" key={value} aria-pressed={range === value} onClick={() => setRange(value)}>{value}</button>)}</div></div>
    {ready ? <ComparisonPlot key={`${range}-${benchmark}`} points={points} benchmark={name} /> : <div className="comparison-state" role="status">{loading ? <><span className="analytics-loader" /><strong>Loading price history</strong><p>Matching your holdings with the market.</p></> : <><strong>{!supported ? 'Choose CAD or USD to compare' : error ? 'Price history is unavailable' : 'Not enough history yet'}</strong><p>{!supported ? 'These holdings need a supported, recorded currency for a fair comparison.' : error || 'We need at least two matching dates to draw a comparison.'}</p>{supported && <button type="button" className="analytics-retry" onClick={() => setAttempt((value) => value + 1)}>Try again</button>}</>}</div>}
    <div className="comparison-foot"><p>Today’s quantities, repriced over time. This is a model of your current holdings, not your actual investment return.</p>{ready && result.coverage?.total > 0 && <p>Price history: {result.coverage.priced} of {result.coverage.total} positions · {points.length} shared dates{result.coverage.percent != null ? ` · ${result.coverage.percent.toFixed(0)}% of holdings value` : ''}.</p>}{ready && hasGaps && <p>Some price history is missing. Gaps longer than five days are left unconnected.</p>}<details><summary>How to read this chart</summary><p>Both lines start at 0% on the first shared date. The difference is in percentage points (pp). Prices are shown in {scope.currency}, including historical exchange-rate changes. Cash and holdings without usable history stay at their recorded value. Trades, deposits, withdrawals, dividends, and fees aren’t included. The benchmark is a market reference, not a match for your portfolio’s risk or investment mix.</p>{result?.missingSymbols?.length > 0 && <p>Held constant: {result.missingSymbols.join(', ')}.</p>}</details>{ready && <details><summary>View chart data</summary><div className="comparison-table"><table><caption className="sr-only">Historical price change in {scope.currency}</caption><thead><tr><th>Date</th><th>Your holdings</th><th>{name}</th></tr></thead><tbody>{points.map((point) => <tr key={point.date}><td>{dateLabel(point.date)}</td><td>{fmtPct(point.portfolio)}</td><td>{fmtPct(point.benchmark)}</td></tr>)}</tbody></table></div></details>}</div>
  </ChartPanel>
}
