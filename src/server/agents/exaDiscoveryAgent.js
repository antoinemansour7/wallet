// ─── Exa Discovery Agent ──────────────────────────────────────────────────────
// Uses Exa AI search to discover emerging stock picks from financial media,
// analyst reports, and market commentary. This runs BEFORE ticker extraction
// to feed new tickers into the signal board alongside X signals.
// ────────────────────────────────────────────────────────────────────────────────

import Exa from 'exa-js'

const DISCOVERY_QUERIES = [
  {
    id: 'breakout-stocks',
    query: 'stocks breaking out momentum small cap high growth 2026',
    weight: 1.4,
    theme: 'growth',
  },
  {
    id: 'analyst-upgrades',
    query: 'stock analyst upgrade price target raised outperform',
    weight: 1.35,
    theme: 'earnings',
  },
  {
    id: 'unusual-activity',
    query: 'unusual options activity stock sweep large block trade',
    weight: 1.45,
    theme: 'squeeze',
  },
  {
    id: 'catalyst-upcoming',
    query: 'upcoming catalyst FDA approval earnings surprise contract award',
    weight: 1.4,
    theme: 'biotech',
  },
  {
    id: 'emerging-sector',
    query: 'emerging stocks space defense AI semiconductor drone satellite',
    weight: 1.3,
    theme: 'defense',
  },
  {
    id: 'under-radar',
    query: 'under the radar stock pick hidden gem small cap undervalued',
    weight: 1.25,
    theme: 'growth',
  },
]

const TICKER_REGEX = /\$([A-Z]{2,5})\b|\b([A-Z]{2,5})\b/g

const TICKER_STOPWORDS = new Set([
  'A', 'AI', 'ALL', 'AM', 'API', 'ARE', 'AS', 'AT', 'ATH', 'BE', 'BEAT', 'BUY', 'BY',
  'CALL', 'CASH', 'CEO', 'CFO', 'CPI', 'CUT', 'DATA', 'DAY', 'DD', 'DEAL', 'DM',
  'EPS', 'ETF', 'ETFS', 'EU', 'EV', 'FDA', 'FED', 'FOR', 'FREE', 'FROM', 'FULL',
  'GDP', 'GM', 'GPT', 'HAS', 'HERE', 'HIGH', 'HOLD', 'HOME', 'HUGE',
  'IN', 'INTO', 'IPO', 'IRS', 'IS', 'IT', 'JUST', 'KEEP', 'LAST',
  'LIKE', 'LIST', 'LIVE', 'LONG', 'LOOK', 'LOW', 'MAKE', 'MANY', 'MORE', 'MOST', 'MUCH',
  'NEAR', 'NEED', 'NEWS', 'NEXT', 'NOTE', 'NOW', 'NYSE', 'OF', 'ON', 'ONLY', 'OPEN', 'OR', 'OVER',
  'PART', 'PICK', 'PLAN', 'PLAY', 'POST', 'PULL', 'PUSH', 'PUTS',
  'QQQ', 'RATE', 'REAL', 'RISK', 'SAFE', 'SALE', 'SEC', 'SELL', 'SHOW',
  'SIZE', 'SOME', 'SOON', 'SPY', 'STAY', 'STOP', 'SURE',
  'TAKE', 'TALK', 'TERM', 'TEST', 'THAT', 'THE', 'THEM', 'THEN', 'THIS', 'TIME', 'TO', 'TRUE', 'TSX',
  'UK', 'USA', 'USD', 'US', 'USED', 'VERY', 'VIEW', 'VIX',
  'WAIT', 'WANT', 'WAYS', 'WEEK', 'WHAT', 'WHEN', 'WHO', 'WILL', 'WITH', 'WORK', 'WSB',
  'X', 'YEAR', 'ZERO',
  // Mega caps we don't want to discover (already too well-known)
  'AAPL', 'AMZN', 'GOOG', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA',
])

function extractTickersFromContent(text) {
  if (!text) return []
  const found = new Set()
  for (const match of text.matchAll(TICKER_REGEX)) {
    const ticker = (match[1] || match[2] || '').toUpperCase()
    if (ticker.length >= 2 && ticker.length <= 5 && !TICKER_STOPWORDS.has(ticker)) {
      found.add(ticker)
    }
  }
  return [...found]
}

function getDateNDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * Searches Exa for stock-related content and extracts tickers + context.
 * Returns signals in the same format as X signals so they can be merged.
 */
export async function runExaDiscovery({ topThemes = [], topTickers = [] } = {}) {
  const exaKey = process.env.EXA_API_KEY
  if (!exaKey) {
    console.warn('[exaDiscovery] EXA_API_KEY not set, skipping')
    return []
  }

  const exa = new Exa(exaKey)
  const signals = []

  // Build adaptive queries based on what's trending from X
  const queries = [...DISCOVERY_QUERIES]

  // Add theme-specific discovery queries based on X seed
  for (const theme of topThemes.slice(0, 2)) {
    queries.push({
      id: `adaptive:${theme}`,
      query: `${theme} stocks to buy momentum breakout catalyst 2026`,
      weight: 1.45,
      theme,
    })
  }

  // Add ticker-specific deep searches for hot names from X
  for (const ticker of topTickers.slice(0, 3)) {
    queries.push({
      id: `ticker-deep:${ticker}`,
      query: `${ticker} stock analysis price target catalyst outlook`,
      weight: 1.5,
      theme: 'growth',
    })
  }

  console.log(`[exaDiscovery] running ${queries.length} discovery queries`)

  const results = await Promise.allSettled(
    queries.map(async (q) => {
      const result = await exa.searchAndContents(q.query, {
        type: 'auto',
        numResults: 8,
        text: { maxCharacters: 600 },
        startPublishedDate: getDateNDaysAgo(2),
        category: 'news',
      })
      return { query: q, results: result.results || [] }
    })
  )

  for (const outcome of results) {
    if (outcome.status !== 'fulfilled') continue
    const { query, results: articles } = outcome.value

    for (const article of articles) {
      const content = [article.title, article.text].filter(Boolean).join(' ')
      const tickers = extractTickersFromContent(content)
      if (tickers.length === 0) continue

      // Create a signal for each ticker found in this article
      for (const ticker of tickers.slice(0, 3)) {
        signals.push({
          id: `exa:${query.id}:${article.url || ''}:${ticker}`,
          text: `[Exa] ${article.title || ''} — ${(article.text || '').slice(0, 200)}`,
          username: 'exa-discovery',
          createdAt: article.publishedDate || new Date().toISOString(),
          url: article.url || null,
          sourceType: 'search',
          sourceRole: 'conviction',
          sourceLabels: ['exa-discovery'],
          queryLabels: [query.id],
          queryTypes: ['exa'],
          sourceWeight: query.weight,
          // Without this the board's `maxScore * 0.42` term evaluated to zero
          // for every Exa-only ticker, while a Finviz hit contributed 6.5.
          // Scaled off the query's own weight so a stronger discovery query
          // carries more, landing in the same band as the screener's 6.5.
          score: Number((4.6 * query.weight).toFixed(2)),
          tickers: [ticker],
          themes: query.theme ? [query.theme] : [],
          publicMetrics: {},
        })
      }
    }
  }

  // Deduplicate by ticker+source — keep highest weight
  const byKey = new Map()
  for (const signal of signals) {
    const key = `${signal.tickers[0]}:${signal.url}`
    const existing = byKey.get(key)
    if (!existing || signal.sourceWeight > existing.sourceWeight) {
      byKey.set(key, signal)
    }
  }

  const deduped = [...byKey.values()]
  console.log(`[exaDiscovery] found ${deduped.length} signals covering ${new Set(deduped.flatMap(s => s.tickers)).size} unique tickers`)
  return deduped
}
