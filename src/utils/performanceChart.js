import { MARKET_TIME_KEY } from './livePrices.js'
import { parseNum } from './portfolioStats.js'

export function marketDate(ts) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ts))
}

// Use the unmodified reconstruction, never a snapshot or live daily endpoint.
// The session may be Friday even when the chart is opened on a weekend.
export function previousPortfolioClose(dailySeries, sessionTs) {
  if (!Number.isFinite(sessionTs)) return null
  const sessionDate = marketDate(sessionTs)
  return dailySeries.reduce((previous, point) => (
    point.date < sessionDate && Number.isFinite(point.marketValue)
      && (!previous || point.date > previous.date) ? point : previous
  ), null)
}

// A refresh time is not a trade time. Only a complete, regular-session
// valuation may extend the line, and only to an actual provider timestamp.
export function withIntradayEndpoint(points, liveValue, rows, session, ready) {
  if (!ready || !points.length || !Number.isFinite(liveValue) || liveValue <= 0) return points
  if (!Number.isFinite(session?.start) || !Number.isFinite(session?.end)) return points
  const holdings = rows.filter((row) => parseNum(row.QUANTITY) > 0 || parseNum(row['MARKET VALUE']) !== 0)
  if (!holdings.length || holdings.some((row) => (
    !Number.isFinite(row[MARKET_TIME_KEY])
      || row[MARKET_TIME_KEY] < session.start || row[MARKET_TIME_KEY] > session.end
  ))) return points
  const ts = Math.max(...holdings.map((row) => row[MARKET_TIME_KEY]))
  const last = points.at(-1)
  if (ts < last.ts || ts > Date.now() || last.ts < session.start || last.ts > session.end) return points
  // Preserve each bar's timestamp; even a quote within its five-minute bucket
  // belongs at its actual time, rather than silently relabelling the bar.
  const point = { ts, marketValue: liveValue }
  return ts === last.ts ? [...points.slice(0, -1), point] : [...points, point]
}
