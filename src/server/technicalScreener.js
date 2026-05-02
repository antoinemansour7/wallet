import { Redis } from '@upstash/redis'

const SCREENER_CACHE_KEY = 'screener:breakout-candidates'
const SCREENER_CACHE_TTL = 43200 // 12 hours

// Squeeze: small-cap+, avg vol >300k, rel vol >1, up this week, low volatility, not overbought (RSI <70), monthly perf under 50%
const SQUEEZE_URL = 'https://finviz.com/screener.ashx?v=111&f=cap_smallover,sh_avgvol_o300,sh_relvol_o1,ta_perf_1wup,ta_perf_4w_u50,ta_rsi_nos70,ta_volatility_wo3&ft=4&r=1'

// Breakout: small-cap+, avg vol >300k, new 50d high, above SMA20 + SMA50, not overbought (RSI <70), monthly perf under 50%
const BREAKOUT_URL = 'https://finviz.com/screener.ashx?v=111&f=cap_smallover,sh_avgvol_o300,ta_highlow50d_nh,ta_perf_4w_u50,ta_rsi_nos70,ta_sma20_pa,ta_sma50_pa&ft=4&r=1'

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
}

async function fetchFinvizScreener(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    console.error(`[technicalScreener] Finviz returned ${res.status} for ${url}`)
    return []
  }

  const html = await res.text()

  // With Googlebot UA, Finviz serves server-rendered HTML with ticker links
  const tickers = []
  const seen = new Set()
  const SKIP = new Set(['USA', 'JSON', 'HTML', 'DARK', 'ETF', 'RSS', 'API', 'SEC', 'CEO', 'IPO', 'NYSE', 'FAQ'])
  const re = />([A-Z]{1,5})<\/a>/g
  let match
  while ((match = re.exec(html)) !== null) {
    const ticker = match[1]
    if (ticker.length >= 2 && !seen.has(ticker) && !SKIP.has(ticker)) {
      seen.add(ticker)
      tickers.push(ticker)
    }
  }

  return tickers
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
    themes: [c.setupType.includes('squeeze') ? 'squeeze' : 'breakout'],
    score: 6.5,
    sourceType: 'screener',
    sourceRole: 'conviction',
    sourceLabels: ['finviz'],
    username: 'finviz-screener',
  }))
}
