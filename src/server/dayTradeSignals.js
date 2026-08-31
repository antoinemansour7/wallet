// ─── Day-trade signal sources ──────────────────────────────────────────────────
// The signals that actually cause single-session moves: companies reporting
// earnings in the next session, and premarket gappers. Both convert into
// screener-style signals so the board and feedback loop treat them like any
// other source (and learn their win rates).

const FINVIZ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept': 'text/html',
}

const FINVIZ_SKIP = new Set(['USA', 'JSON', 'HTML', 'DARK', 'ETF', 'RSS', 'API', 'SEC', 'CEO', 'IPO', 'NYSE', 'FAQ'])

async function fetchFinvizTickers(url) {
  const res = await fetch(url, { headers: FINVIZ_HEADERS, signal: AbortSignal.timeout(15000) })
  if (!res.ok) return []
  const html = await res.text()
  const tickers = []
  const seen = new Set()
  const re = />([A-Z]{1,5})<\/a>/g
  let match
  while ((match = re.exec(html)) !== null) {
    const ticker = match[1]
    if (ticker.length >= 2 && !seen.has(ticker) && !FINVIZ_SKIP.has(ticker)) {
      seen.add(ticker)
      tickers.push(ticker)
    }
  }
  return tickers
}

/**
 * Companies reporting earnings in the next session. The nightly run (previous
 * evening ET) wants tomorrow's reporters; the premarket run wants today's.
 * Liquid names only (small-cap+, >300k avg volume).
 */
export async function fetchEarningsCandidates({ when = 'tomorrow' } = {}) {
  const day = when === 'today' ? 'today' : 'tomorrow'
  const urls = [
    { timing: 'before open', url: `https://finviz.com/screener.ashx?v=111&f=cap_smallover,earningsdate_${day}before,sh_avgvol_o300&ft=4&r=1` },
    { timing: 'after close', url: `https://finviz.com/screener.ashx?v=111&f=cap_smallover,earningsdate_${day}after,sh_avgvol_o300&ft=4&r=1` },
  ]

  const results = await Promise.all(urls.map(async ({ timing, url }) => {
    try {
      const tickers = await fetchFinvizTickers(url)
      return tickers.slice(0, 12).map((ticker) => ({ ticker, timing }))
    } catch (err) {
      console.error(`[dayTradeSignals] earnings (${timing}) fetch failed:`, err.message)
      return []
    }
  }))

  return results.flat()
}

/** Top % gainers from Polygon's snapshot (reflects premarket on the morning run). */
export async function fetchPremarketMovers({ limit = 10 } = {}) {
  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey) return []

  try {
    const res = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${apiKey}`,
      { signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.tickers || [])
      .filter((t) => Number.isFinite(t.todaysChangePerc) && t.todaysChangePerc >= 4)
      .slice(0, limit)
      .map((t) => ({ ticker: t.ticker, changePerc: Number(t.todaysChangePerc.toFixed(1)) }))
  } catch (err) {
    console.error('[dayTradeSignals] premarket movers fetch failed:', err.message)
    return []
  }
}

export function earningsToSignals(candidates, { when = 'tomorrow' } = {}) {
  return candidates.map((c, i) => ({
    id: `earnings-${c.ticker}-${Date.now()}-${i}`,
    text: `${c.ticker} reports earnings ${when} ${c.timing} — scheduled single-session catalyst`,
    tickers: [c.ticker],
    themes: ['earnings'],
    score: 7,
    sourceType: 'screener',
    sourceRole: 'conviction',
    sourceLabels: ['earnings-calendar'],
    username: 'earnings-calendar',
    createdAt: new Date().toISOString(),
  }))
}

export function moversToSignals(movers) {
  return movers.map((m, i) => ({
    id: `mover-${m.ticker}-${Date.now()}-${i}`,
    text: `${m.ticker} up ${m.changePerc}% in early/premarket trading on unusual volume — momentum continuation candidate`,
    tickers: [m.ticker],
    themes: ['breakout'],
    score: 6.5,
    sourceType: 'screener',
    sourceRole: 'conviction',
    sourceLabels: ['premarket-movers'],
    username: 'premarket-movers',
    createdAt: new Date().toISOString(),
  }))
}

/** Collect all day-trade signals for a run mode ('nightly' | 'premarket'). */
export async function collectDayTradeSignals(mode = 'nightly') {
  const when = mode === 'premarket' ? 'today' : 'tomorrow'
  const [earnings, movers] = await Promise.all([
    fetchEarningsCandidates({ when }),
    mode === 'premarket' ? fetchPremarketMovers() : Promise.resolve([]),
  ])
  return [...earningsToSignals(earnings, { when }), ...moversToSignals(movers)]
}
