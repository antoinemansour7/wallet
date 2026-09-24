import { digest } from '../research/archive.js'
import { optionsLocalParts, marketDay, OPTIONS_CALENDAR_2026 } from './calendar.js'
import { resolveOptionsHoldingExit } from './scenarios.js'

const DAY = 86400000
const addDays = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10)
const calendarSource = { provider: 'nasdaq', licenseId: 'nasdaq-public-calendar', url: 'https://www.nasdaq.com/market-activity/earnings' }
const newsSource = { provider: 'alpaca', licenseId: 'alpaca-basic-news', url: 'https://data.alpaca.markets/v1beta1/news' }
const NEWS_GROUPS = 5
const NEWS_PAGES_PER_GROUP = 20

export function normalizeEarningsCalendar(body, { date, securities, availableAt }) {
  // A missing table is an outage, not evidence that nobody reports.
  if (body?.status?.rCode !== 200 || !Array.isArray(body?.data?.rows)) throw new Error('earnings_calendar_invalid_response')
  const byTicker = new Map(securities.map((security) => [security.ticker, security]))
  return body.data.rows.flatMap((row) => {
    const security = byTicker.get(row.symbol)
    if (!security) return []
    const timing = ({ 'time-pre-market': 'before_open', 'time-after-hours': 'after_close' })[row.time] || 'unknown'
    return [{ securityId: security.securityId, eventId: `nasdaq:${row.symbol}:${date}`, eventDate: date,
      timing, status: 'scheduled', confirmation: 'estimated', availableAt, source: calendarSource }]
  })
}

// Require the issuer at the beginning of a single-symbol headline. Mentions
// and tags (e.g. Amazon tagged on Rivian results) cannot establish a release.
const ISSUER_PREFIXES = {
  SNDK: ['sandisk'], ASTS: ['ast spacemobile'], MU: ['micron'], RKLB: ['rocket lab'], MRVL: ['marvell'],
  IREN: ['iren', 'iris energy'], CRDO: ['credo'], SOFI: ['sofi'], CRWV: ['coreweave'], SPCX: ['spacex', 'space exploration technologies'],
  NBIS: ['nebius'], PLTR: ['palantir'], HOOD: ['robinhood'], NVDA: ['nvidia'], AMD: ['advanced micro devices', 'amd'],
  ORCL: ['oracle'], MSTR: ['microstrategy', 'strategy'], AVGO: ['broadcom'], VST: ['vistra'], INTC: ['intel'],
  SMCI: ['super micro computer', 'supermicro'], NOW: ['servicenow'], APP: ['applovin'], AMZN: ['amazon'], AAOI: ['applied optoelectronics'],
}

export function reportedEarningsFromNews(items, securities) {
  const releases = []
  for (const security of securities) {
    for (const item of items.filter((news) => news.securityId === security.securityId)) {
      if (item.symbolCount !== 1) continue
      // A wire re-issue ("UPDATE: ...", "CORRECTION: ...") is the same release.
      const headline = item.headline.toLowerCase().replace(/^(?:correction|update|updated):\s*/, '')
      // The name must end at a non-alphanumeric ("Amazon.com", "AST SpaceMobile,
      // Inc"), so "intel" never matches "Intelligent ...".
      const prefix = (ISSUER_PREFIXES[security.ticker] || [])
        .find((name) => headline.startsWith(name) && !/[a-z0-9]/.test(headline[name.length] || ''))
      if (!prefix) continue
      const result = headline.slice(prefix.length).trim()
      // Wire-result syntax: the rest of the issuer's name ("Technologies",
      // "Group N.V. - Class A Ordinary Shares"), then "Qn [year] [Adj.] EPS
      // <number>". A guidance or preliminary verb in that name position
      // ("Sees Q1 EPS", "Sees Prelim. Q2") disqualifies it, while guidance
      // appended after a real result ("...Beats; Sees Q1...") does not.
      if (!/^(?:(?!(?:sees|see|expects|guides|prelim\S*|reported|reports|preview\S*)\s)[a-z0-9.&,'-]+\s+){0,8}?q[1-4]\b(?:\s+(?:fy\s?)?\d{4})?\s+(?:(?:adj\.?|adjusted|non-gaap|gaap|diluted)\s+)*eps\s+\$?\(?-?\d/.test(result)) continue
      const local = optionsLocalParts(item.publishedAt)
      releases.push({ securityId: security.securityId, eventId: `reported:${security.ticker}:${local.date}`,
        eventDate: local.date, timing: local.hour < 9 || (local.hour === 9 && local.minute < 30) ? 'before_open'
          : local.hour >= 16 ? 'after_close' : 'unknown', status: 'reported', confirmation: 'reported',
        publicAt: item.publishedAt, availableAt: item.availableAt, source: item.source, headline: item.headline })
    }
  }
  return [...new Map(releases.map((event) => [event.eventId, event])).values()]
}

export async function gatherOptionsEventEvidence({ securities, tradingDate, freezeAt, deadlineAt,
  fetchImpl = fetch, now = Date.now, env = process.env, calendar = OPTIONS_CALENDAR_2026 } = {}) {
  const start = now()
  const deadline = Math.min(Date.parse(deadlineAt), Date.parse(freezeAt), start + 25000)
  const through = addDays(resolveOptionsHoldingExit(tradingDate, 3)?.exitDate || tradingDate, 1)
  const dates = []
  for (let date = tradingDate; date <= through; date = addDays(date, 1)) {
    if (marketDay(date, calendar).open) dates.push(date)
  }
  const request = async (url, headers = {}) => {
    const remaining = deadline - now()
    if (remaining <= 0) throw new Error('event_budget_exhausted')
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(Math.max(1, Math.min(5000, remaining))) })
    if (!response.ok) throw new Error(`event_http_${response.status}`)
    const body = await response.json()
    if (now() > deadline) throw new Error('event_response_after_deadline')
    return { body, availableAt: new Date(now()).toISOString() }
  }
  let calendarRequests = 0, newsRequests = 0
  const calendarPromise = (async () => {
    const results = []
    // Bound external concurrency and total wait; no failure is cached as empty.
    for (let index = 0; index < dates.length; index += 3) {
      results.push(...await Promise.allSettled(dates.slice(index, index + 3).map(async (date) => {
        calendarRequests += 1
        const result = await request(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`,
          { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Referer: calendarSource.url })
        return normalizeEarningsCalendar(result.body, { date, securities, availableAt: result.availableAt })
      })))
    }
    return results
  })()
  const newsPromise = (async () => {
    if (!env.ALPACA_API_KEY_ID || !env.ALPACA_API_SECRET_KEY) return { items: [], complete: false }
    const byTicker = new Map(securities.map((security) => [security.ticker, security]))
    const items = new Map()
    // 21 days of watchlist news is 30-46 pages as one query (Sep 2026), so it
    // is split into parallel ticker groups; the busiest ticker alone is ~8.
    const tickers = [...byTicker.keys()]
    const groups = Array.from({ length: Math.min(NEWS_GROUPS, tickers.length) }, (_, group) => tickers.filter((_, index) => index % NEWS_GROUPS === group))
    const fetchGroup = async (symbols) => {
      const tokens = new Set()
      let token = null
      try {
        for (let page = 0; page < NEWS_PAGES_PER_GROUP; page += 1) {
          const url = new URL(newsSource.url)
          for (const [key, value] of Object.entries({ symbols: symbols.join(','), start: new Date(Date.parse(freezeAt) - 21 * DAY).toISOString(),
            end: freezeAt, limit: '50', sort: 'desc', ...(token ? { page_token: token } : {}) })) url.searchParams.set(key, value)
          newsRequests += 1
          const { body, availableAt } = await request(url, { 'APCA-API-KEY-ID': env.ALPACA_API_KEY_ID, 'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET_KEY })
          if (!Array.isArray(body.news)) throw new Error('news_invalid_response')
          for (const article of body.news) {
            if (!Array.isArray(article.symbols) || !article.headline || !Number.isFinite(Date.parse(article.created_at))
              || Date.parse(article.created_at) > Date.parse(freezeAt) || Date.parse(article.updated_at) > Date.parse(freezeAt)) continue
            for (const ticker of article.symbols) {
              const security = byTicker.get(ticker)
              if (!security) continue
              const key = digest([ticker, article.headline.trim().toLowerCase(), article.created_at.slice(0, 10)])
              items.set(key, { securityId: security.securityId, eventId: String(article.id), headline: article.headline,
                symbolCount: article.symbols.length, publishedAt: article.created_at, availableAt, source: { ...newsSource, url: article.url || newsSource.url } })
            }
          }
          token = body.next_page_token
          if (!token) return true
          if (tokens.has(token)) throw new Error('news_repeated_page')
          tokens.add(token)
        }
      } catch { /* Keep visible observations; coverage stays incomplete. */ }
      return false
    }
    const complete = (await Promise.all(groups.map(fetchGroup))).every(Boolean)
    return { items: [...items.values()], complete }
  })()
  const [calendarResults, news] = await Promise.all([calendarPromise, newsPromise])
  const reports = reportedEarningsFromNews(news.items, securities)
  const reportedKeys = new Set(reports.map((event) => `${event.securityId}:${event.eventDate}`))
  const scheduled = calendarResults.filter((result) => result.status === 'fulfilled').flatMap((result) => result.value)
    .filter((event) => !reportedKeys.has(`${event.securityId}:${event.eventDate}`))
  const successful = calendarResults.filter((result) => result.status === 'fulfilled').length
  const asOf = new Date(Math.min(now(), Date.parse(freezeAt))).toISOString()
  // Every page was still read for coverage, but only company-specific items
  // feed a signal (the news surge and verified releases); multi-company
  // mentions were ~75% of the volume and ~1 MB of the frozen snapshot.
  const companyNews = news.items.filter((item) => item.symbolCount === 1)
  return { earnings: [...scheduled, ...reports], news: companyNews,
    coverage: { earnings: { status: successful === dates.length && dates.length ? 'complete' : successful ? 'partial' : 'unavailable',
      from: tradingDate, through, asOf, source: calendarSource, reason: successful === dates.length ? 'calendar_dates_checked_estimates_not_confirmations' : 'calendar_fetch_incomplete' },
    news: { status: news.complete ? 'complete' : news.items.length ? 'partial' : 'unavailable', asOf, source: newsSource,
      reason: news.complete ? 'rolling_21_calendar_days_checked' : 'news_window_incomplete' } },
    metrics: { calendarRequests, newsRequests, calendarDatesChecked: successful, calendarDatesRequired: dates.length,
      newsItemsSeen: news.items.length, newsItemsKept: companyNews.length, elapsedMs: now() - start } }
}
