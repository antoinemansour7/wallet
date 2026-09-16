import { Redis } from '@upstash/redis'

const SCREENER_CACHE_KEY = 'screener:breakout-candidates:v2'
const SCREENER_LAST_GOOD_KEY = 'screener:breakout-candidates:last-good'
const SCREENER_CACHE_TTL = 43200 // 12 hours
const SCREENER_LAST_GOOD_TTL = 30 * 24 * 60 * 60
const NASDAQ_SCREENER_URL = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true'
const NASDAQ_MAX_CANDIDATES = Number(process.env.NASDAQ_SCREENER_MAX_CANDIDATES || 80)

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

// Sector-scoped discovery (issue #96). The broad screens are paginated and
// sorted by relative volume, so a strong name in a focus sector can sit below
// the page cutoff; re-running the same technical screens constrained to a
// sector surfaces it. Finviz takes one sector OR industry code per query.
// Codes verified live 2026-09-05 — the spec's `ind_semiconductorsbroadline` has
// drifted (Finviz now ignores it and returns the whole market), so the current
// `ind_semiconductors` is used instead.
export const FOCUS_SECTOR_FILTERS = [
  'sec_technology',
  'ind_semiconductors',
  'ind_aerospacedefense',
  'ind_softwareinfrastructure',
  'ind_softwareapplication',
]

// Sector result sets are small, so they need far fewer pages than the
// market-wide runs.
const SECTOR_SCREEN_PAGES = 2

// Insert a sector/industry code into a screener URL's filter list.
export function withSectorFilter(baseUrl, sectorCode) {
  return baseUrl.replace('&f=', `&f=${sectorCode},`)
}

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
    [...html.matchAll(/stock\?t=([A-Z][A-Z0-9.-]{0,5})[&"]/g)].map((m) => m[1]),
  )]
}

function totalMatches(html) {
  const m = html.match(/#\d+\s*\/\s*(\d+)\s*Total/i)
  return m ? Number(m[1]) : null
}

async function fetchFinvizPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://finviz.com/',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const error = new Error(`Finviz returned ${res.status}`)
    error.status = res.status
    throw error
  }

  const html = await res.text()
  return { tickers: parseFinvizTickers(html), total: totalMatches(html) }
}

async function fetchFinvizScreener(baseUrl, maxPages = MAX_PAGES) {
  const all = []
  const seen = new Set()

  for (let page = 0; page < maxPages; page += 1) {
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

function marketNumber(value) {
  const normalized = String(value ?? '').replace(/[$,%+\s,]/g, '')
  if (!normalized || normalized === '--') return null
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

const FOCUS_INDUSTRY = /(software|semiconductor|aerospace|defense|computer|electronic)/i

export function parseNasdaqCandidates(rows, limit = NASDAQ_MAX_CANDIDATES) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      ticker: String(row.symbol || '').trim().toUpperCase(),
      price: marketNumber(row.lastsale),
      changePercent: marketNumber(row.pctchange),
      volume: marketNumber(row.volume),
      marketCap: marketNumber(row.marketCap),
      industry: String(row.industry || ''),
      sector: String(row.sector || ''),
    }))
    .filter((row) => (
      /^[A-Z][A-Z0-9.-]{0,5}$/.test(row.ticker)
      && row.price >= 5
      && row.volume >= 300000
      && row.marketCap >= 300000000
      && row.changePercent >= 1.5
      && row.changePercent <= 20
    ))
    .sort((a, b) => {
      const focusDifference = Number(FOCUS_INDUSTRY.test(`${b.sector} ${b.industry}`)) - Number(FOCUS_INDUSTRY.test(`${a.sector} ${a.industry}`))
      return focusDifference || b.changePercent - a.changePercent || b.volume - a.volume
    })
    .slice(0, limit)
    .map((row) => ({ ...row, setupType: 'momentum', source: 'nasdaq-screener' }))
}

export async function fetchNasdaqCandidates() {
  const response = await fetch(NASDAQ_SCREENER_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://www.nasdaq.com',
      'Referer': 'https://www.nasdaq.com/',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Nasdaq returned ${response.status}`)
  const payload = await response.json()
  const rows = payload?.data?.rows
  if (!Array.isArray(rows)) throw new Error('Nasdaq response did not contain stock rows')
  return parseNasdaqCandidates(rows)
}

async function fetchFinvizCandidates(lastGood) {
  console.log('[technicalScreener] fetching from Finviz...')

  const screen = async (url, maxPages, label) => {
    try { return { tickers: await fetchFinvizScreener(url, maxPages), error: null } }
    catch (error) {
      console.error(`[technicalScreener] ${label} fetch failed:`, error.message)
      return { tickers: [], error }
    }
  }

  const broad = await Promise.all([
    screen(SQUEEZE_URL, MAX_PAGES, 'squeeze'),
    screen(BREAKOUT_URL, MAX_PAGES, 'breakout'),
  ])
  if (broad.every((result) => result.error)) {
    if (lastGood.length > 0) return lastGood
    throw new Error(`Finviz unavailable: ${broad.map((result) => result.error.message).join(', ')}`)
  }

  const sectorTasks = FOCUS_SECTOR_FILTERS.flatMap((sec) => [
    () => screen(withSectorFilter(SQUEEZE_URL, sec), SECTOR_SCREEN_PAGES, `squeeze/${sec}`),
    () => screen(withSectorFilter(BREAKOUT_URL, sec), SECTOR_SCREEN_PAGES, `breakout/${sec}`),
  ])
  const sectorResults = []
  for (let index = 0; index < sectorTasks.length; index += 2) {
    sectorResults.push(...await Promise.all(sectorTasks.slice(index, index + 2).map((task) => task())))
  }
  const squeezeTickers = [...new Set([broad[0].tickers, ...sectorResults.filter((_, index) => index % 2 === 0).map((result) => result.tickers)].flat())]
  const breakoutTickers = [...new Set([broad[1].tickers, ...sectorResults.filter((_, index) => index % 2 === 1).map((result) => result.tickers)].flat())]
  const squeezeSet = new Set(squeezeTickers)
  const breakoutSet = new Set(breakoutTickers)
  const candidates = [...new Set([...squeezeTickers, ...breakoutTickers])].map((ticker) => {
    const isSqueeze = squeezeSet.has(ticker)
    const isBreakout = breakoutSet.has(ticker)
    const setupType = isSqueeze && isBreakout ? 'squeeze+breakout' : isSqueeze ? 'squeeze' : 'breakout'
    return { ticker, setupType, source: 'finviz-screener' }
  })
  console.log(`[technicalScreener] found ${candidates.length} Finviz candidates (${squeezeTickers.length} squeeze, ${breakoutTickers.length} breakout)`)
  return candidates
}

export async function fetchBreakoutCandidates() {
  // Try cache first
  const redis = getRedis()
  let lastGood = []
  try {
    const cached = await redis.get(SCREENER_CACHE_KEY)
    if (cached && Array.isArray(cached) && cached.length > 0) {
      console.log(`[technicalScreener] cache hit: ${cached.length} candidates`)
      return cached
    }
    const backup = await redis.get(SCREENER_LAST_GOOD_KEY)
    if (Array.isArray(backup)) lastGood = backup
  } catch (err) {
    console.error('[technicalScreener] cache read failed:', err.message)
  }

  const provider = (process.env.TECHNICAL_SCREENER_PROVIDER || 'nasdaq').toLowerCase()
  let candidates
  try {
    if (provider === 'finviz') candidates = await fetchFinvizCandidates(lastGood)
    else {
      console.log('[technicalScreener] fetching from Nasdaq...')
      candidates = await fetchNasdaqCandidates()
      console.log(`[technicalScreener] found ${candidates.length} Nasdaq momentum candidates`)
    }
  } catch (error) {
    if (lastGood.length > 0) {
      console.warn(`[technicalScreener] ${provider} unavailable; using ${lastGood.length} last-known-good candidates`)
      return lastGood
    }
    throw error
  }

  // Cache results
  if (candidates.length > 0) {
    try {
      await redis.set(SCREENER_CACHE_KEY, candidates, { ex: SCREENER_CACHE_TTL })
      await redis.set(SCREENER_LAST_GOOD_KEY, candidates, { ex: SCREENER_LAST_GOOD_TTL })
    } catch (err) {
      console.error('[technicalScreener] cache write failed:', err.message)
    }
  }

  return candidates
}

export function candidatesToSignals(candidates) {
  return candidates.map((c, i) => ({
    id: `screener-${c.ticker}-${Date.now()}-${i}`,
    text: c.source === 'nasdaq-screener'
      ? `${c.ticker} gained ${c.changePercent}% today on ${Math.round(c.volume).toLocaleString('en-US')} shares in Nasdaq market data`
      : `${c.ticker} identified as ${c.setupType} setup by technical screener (Finviz)`,
    tickers: [c.ticker],
    // Declare every screen the ticker actually passed. The board classifies
    // screener signals from these themes rather than regexing the synthetic
    // text above, so "squeeze+breakout" must not collapse to just "squeeze".
    themes: [
      ...(c.setupType.includes('squeeze') ? ['squeeze'] : []),
      ...(c.setupType.includes('breakout') ? ['breakout'] : []),
      ...(c.setupType === 'momentum' ? ['momentum'] : []),
    ],
    score: 6.5,
    sourceType: 'screener',
    sourceRole: 'conviction',
    sourceLabels: [c.source === 'nasdaq-screener' ? 'nasdaq' : 'finviz'],
    username: c.source || 'technical-screener',
  }))
}
