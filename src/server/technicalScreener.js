import { Redis } from '@upstash/redis'

const SCREENER_CACHE_KEY = 'screener:breakout-candidates'
const SCREENER_CACHE_TTL = 43200 // 12 hours

// Finviz paginates at 20 rows and, without an explicit sort, orders results
// alphabetically. Requesting only the first page therefore returned nothing but
// A- and B-tickers — 20 of ~137 matches, with a total alphabetical bias. Sort by
// descending relative volume (the most active names first, which is the whole
// point of these screens) and walk several pages.
const RESULTS_PER_PAGE = 20
const MAX_PAGES = Number(process.env.SCREENER_MAX_PAGES || 4)
const SORT = 'o=-relativevolume'

// Squeeze: small-cap+, avg vol >300k, rel vol >1, up this week, low volatility, not overbought (RSI <70), monthly perf under 50%
const SQUEEZE_URL = `https://finviz.com/screener.ashx?v=111&f=cap_smallover,sh_avgvol_o300,sh_relvol_o1,ta_perf_1wup,ta_perf_4w_u50,ta_rsi_nos70,ta_volatility_wo3&ft=4&${SORT}`

// Breakout: small-cap+, avg vol >300k, new 50d high, above SMA20 + SMA50, not overbought (RSI <70), monthly perf under 50%
const BREAKOUT_URL = `https://finviz.com/screener.ashx?v=111&f=cap_smallover,sh_avgvol_o300,ta_highlow50d_nh,ta_perf_4w_u50,ta_rsi_nos70,ta_sma20_pa,ta_sma50_pa&ft=4&${SORT}`

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
}

// Read tickers out of the result rows' own hrefs. The previous `>([A-Z]{1,5})</a>`
// pattern matched any short uppercase link text, so it swallowed the view-switcher
// buttons ("TA", "ETF") and short company names ("AECOM") as if they were tickers.
// Result links point at `stock?t=`; the nav buttons point at `screener?v=`, so
// keying on the href makes the two impossible to confuse.
export function parseFinvizTickers(html) {
  return [...new Set(
    [...html.matchAll(/stock\?t=([A-Z][A-Z0-9.\-]{0,5})[&"]/g)].map((m) => m[1]),
  )]
}

function totalMatches(html) {
  const m = html.match(/#\d+\s*\/\s*(\d+)\s*Total/i)
  return m ? Number(m[1]) : null
}

async function fetchFinvizPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    console.error(`[technicalScreener] Finviz returned ${res.status} for ${url}`)
    return { tickers: [], total: null }
  }

  const html = await res.text()
  return { tickers: parseFinvizTickers(html), total: totalMatches(html) }
}

async function fetchFinvizScreener(baseUrl) {
  const all = []
  const seen = new Set()

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * RESULTS_PER_PAGE + 1
    const { tickers, total } = await fetchFinvizPage(`${baseUrl}&r=${offset}`)
    if (tickers.length === 0) break

    for (const ticker of tickers) {
      if (seen.has(ticker)) continue
      seen.add(ticker)
      all.push(ticker)
    }

    // Stop once the whole result set is covered, or the page came back short.
    if (tickers.length < RESULTS_PER_PAGE) break
    if (total !== null && offset + RESULTS_PER_PAGE > total) break
  }

  return all
}

export async function fetchBreakoutCandidates() {
  // Try cache first
  const redis = getRedis()
  try {
    const cached = await redis.get(SCREENER_CACHE_KEY)
    if (cached && Array.isArray(cached) && cached.length > 0) {
      console.log(`[technicalScreener] cache hit: ${cached.length} candidates`)
      return cached
    }
  } catch (err) {
    console.error('[technicalScreener] cache read failed:', err.message)
  }

  console.log('[technicalScreener] fetching from Finviz...')

  const [squeezeTickers, breakoutTickers] = await Promise.all([
    fetchFinvizScreener(SQUEEZE_URL).catch((err) => {
      console.error('[technicalScreener] squeeze fetch failed:', err.message)
      return []
    }),
    fetchFinvizScreener(BREAKOUT_URL).catch((err) => {
      console.error('[technicalScreener] breakout fetch failed:', err.message)
      return []
    }),
  ])

  const squeezSet = new Set(squeezeTickers)
  const breakoutSet = new Set(breakoutTickers)
  const allTickers = new Set([...squeezeTickers, ...breakoutTickers])

  const candidates = [...allTickers].map((ticker) => {
    const isSqueeze = squeezSet.has(ticker)
    const isBreakout = breakoutSet.has(ticker)
    const setupType = isSqueeze && isBreakout
      ? 'squeeze+breakout'
      : isSqueeze
      ? 'squeeze'
      : 'breakout'
    return { ticker, setupType, source: 'finviz-screener' }
  })

  // Cache results
  if (candidates.length > 0) {
    try {
      await redis.set(SCREENER_CACHE_KEY, candidates, { ex: SCREENER_CACHE_TTL })
    } catch (err) {
      console.error('[technicalScreener] cache write failed:', err.message)
    }
  }

  console.log(`[technicalScreener] found ${candidates.length} candidates (${squeezeTickers.length} squeeze, ${breakoutTickers.length} breakout)`)
  return candidates
}

export function candidatesToSignals(candidates) {
  return candidates.map((c, i) => ({
    id: `screener-${c.ticker}-${Date.now()}-${i}`,
    text: `${c.ticker} identified as ${c.setupType} setup by technical screener (Finviz)`,
    tickers: [c.ticker],
    // Declare every screen the ticker actually passed. The board classifies
    // screener signals from these themes rather than regexing the synthetic
    // text above, so "squeeze+breakout" must not collapse to just "squeeze".
    themes: [
      ...(c.setupType.includes('squeeze') ? ['squeeze'] : []),
      ...(c.setupType.includes('breakout') ? ['breakout'] : []),
    ],
    score: 6.5,
    sourceType: 'screener',
    sourceRole: 'conviction',
    sourceLabels: ['finviz'],
    username: 'finviz-screener',
  }))
}
