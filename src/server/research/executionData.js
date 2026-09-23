import { marketDay, optionsLocalParts, regularSessionClose } from '../options/calendar.js'
import { alpacaSipDailyBars } from './priceGaps.js'

// The constrained arm's portfolio rules need a spread, a daily volume and a
// sector. The research quote feeds supply none of them, so constrained-v1
// rejected every candidate as execution_or_sector_data_unavailable. These are
// gathered here instead, all from before the decision: the consolidated NBBO
// at the previous regular close, that session's consolidated volume, and the
// issuer's SEC industry code. Anything unavailable stays missing, never guessed.
export const EXECUTION_DATA_VERSION = 'execution-close-nbbo-sip-sec-sic-v1'

// SEC Standard Industrial Classification ranges mapped onto the sector names
// the evaluation's sector ETF benchmarks use. First match wins.
const SIC_SECTORS = [
  [100, 999, 'Consumer Defensive'], [1000, 1099, 'Basic Materials'], [1200, 1399, 'Energy'], [1400, 1499, 'Basic Materials'],
  [1500, 1799, 'Industrials'], [2000, 2199, 'Consumer Defensive'], [2200, 2399, 'Consumer Cyclical'],
  [2400, 2499, 'Basic Materials'], [2500, 2599, 'Consumer Cyclical'], [2600, 2699, 'Basic Materials'],
  [2700, 2799, 'Communication Services'], [2830, 2836, 'Healthcare'], [2840, 2844, 'Consumer Defensive'],
  [2800, 2899, 'Basic Materials'], [2900, 2999, 'Energy'], [3000, 3099, 'Basic Materials'], [3100, 3199, 'Consumer Cyclical'],
  [3200, 3399, 'Basic Materials'], [3400, 3499, 'Industrials'], [3570, 3579, 'Technology'], [3500, 3599, 'Industrials'],
  [3600, 3629, 'Industrials'], [3630, 3659, 'Consumer Cyclical'], [3660, 3699, 'Technology'], [3710, 3716, 'Consumer Cyclical'],
  [3700, 3799, 'Industrials'], [3840, 3851, 'Healthcare'], [3800, 3899, 'Technology'], [3900, 3999, 'Consumer Cyclical'],
  [4000, 4799, 'Industrials'], [4800, 4899, 'Communication Services'], [4900, 4999, 'Utilities'],
  [5120, 5122, 'Healthcare'], [5140, 5149, 'Consumer Defensive'], [5000, 5199, 'Industrials'],
  [5400, 5499, 'Consumer Defensive'], [5912, 5912, 'Consumer Defensive'], [5200, 5999, 'Consumer Cyclical'],
  [6500, 6599, 'Real Estate'], [6798, 6798, 'Real Estate'], [6000, 6799, 'Financials'],
  [7000, 7299, 'Consumer Cyclical'], [7310, 7319, 'Communication Services'], [7370, 7379, 'Technology'], [7300, 7399, 'Industrials'],
  [7800, 7899, 'Communication Services'], [7900, 7999, 'Consumer Cyclical'], [8000, 8099, 'Healthcare'], [8100, 8999, 'Industrials'],
]

export function sectorFromSic(sic) {
  const code = Number(sic)
  if (!Number.isInteger(code) || code <= 0) return null
  return SIC_SECTORS.find(([low, high]) => code >= low && code <= high)?.[2] ?? null
}

/** The last regular session that had closed by the decision time. */
export function previousSession(asOf) {
  const at = new Date(asOf).getTime()
  let date = optionsLocalParts(new Date(at).toISOString()).date
  for (let checked = 0; checked < 10; checked++) {
    const day = marketDay(date)
    if (!day.known) return null
    if (day.open) {
      const closeAt = regularSessionClose(date)
      if (Date.parse(closeAt) <= at) return { date, closeAt }
    }
    date = new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
  }
  return null
}

const positive = (value) => Number.isFinite(value) && value > 0

export function alpacaClosingQuote({ fetchImpl = fetch, keyId = process.env.ALPACA_API_KEY_ID, secret = process.env.ALPACA_API_SECRET_KEY } = {}) {
  return async function closingQuote(symbol, closeAt) {
    if (!keyId || !secret) throw new Error('alpaca_credentials_unavailable')
    const url = new URL(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/quotes`)
    for (const [key, value] of Object.entries({ start: new Date(Date.parse(closeAt) - 60000).toISOString(), end: closeAt, feed: 'sip', limit: 1, sort: 'desc' })) {
      url.searchParams.set(key, String(value))
    }
    const response = await fetchImpl(url, { headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret }, signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`alpaca_quotes_http_${response.status}`)
    const quote = (await response.json()).quotes?.[0]
    return quote ? { bid: quote.bp, ask: quote.ap, at: quote.t } : null
  }
}

export function secIndustryCode({ client }) {
  return async function industry(issuerId) {
    const cik = /^cik:(\d{10})$/.exec(issuerId || '')?.[1]
    if (!cik) return null
    const submissions = await client.request(`https://data.sec.gov/submissions/CIK${cik}.json`)
    return submissions?.sic ? { sic: String(submissions.sic), description: submissions.sicDescription || null } : null
  }
}

async function mapLimited(items, limit, work) {
  const results = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; results[index] = await work(items[index]) }
  }))
  return results
}

/** Execution facts per candidate key, each with its own source or a missing reason. */
export async function executionDataFor(candidates, { asOf, closingQuote, dailyBars, industry, concurrency = 4 }) {
  const session = previousSession(asOf)
  const tickers = [...new Set(candidates.map((c) => c.ticker).filter(Boolean))]
  const issuers = [...new Set(candidates.map((c) => c.issuerId).filter(Boolean))]
  const failure = (error) => String(error?.message || error).slice(0, 120)
  const quotes = new Map(), industries = new Map()
  let bars = new Map(), barsError = null
  if (session && tickers.length) {
    try { for (let i = 0; i < tickers.length; i += 100) for (const [ticker, rows] of await dailyBars(tickers.slice(i, i + 100), session.date, session.date)) bars.set(ticker, rows) }
    catch (error) { bars = new Map(); barsError = failure(error) }
    await mapLimited(tickers, concurrency, async (ticker) => {
      try { quotes.set(ticker, await closingQuote(ticker, session.closeAt)) } catch (error) { quotes.set(ticker, { error: failure(error) }) }
    })
  }
  await mapLimited(issuers, concurrency, async (issuerId) => {
    try { industries.set(issuerId, await industry(issuerId)) } catch (error) { industries.set(issuerId, { error: failure(error) }) }
  })

  return new Map(candidates.map((c) => {
    const missing = []
    const quote = quotes.get(c.ticker)
    const validQuote = quote && !quote.error && positive(quote.bid) && positive(quote.ask) && quote.ask >= quote.bid
      && Date.parse(quote.at) <= Date.parse(session?.closeAt)
    const spreadBps = validQuote ? (quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2) * 10000 : null
    if (!validQuote) missing.push({ field: 'spreadBps', reason: !session ? 'previous_session_unknown' : quote?.error || 'closing_quote_unavailable' })
    const bar = (bars.get(c.ticker) || []).find((row) => row.date === session?.date)
    const volume = positive(bar?.volume) ? bar.volume : null
    if (volume === null) missing.push({ field: 'volume', reason: !session ? 'previous_session_unknown' : barsError || 'session_volume_unavailable' })
    const code = industries.get(c.issuerId)
    const sector = code && !code.error ? sectorFromSic(code.sic) : null
    if (sector === null) missing.push({ field: 'sector', reason: code?.error || (code?.sic ? 'industry_code_unmapped' : 'industry_code_unavailable') })
    return [c.key, {
      version: EXECUTION_DATA_VERSION, session: session?.date ?? null,
      spreadBps, bid: validQuote ? quote.bid : null, ask: validQuote ? quote.ask : null, quoteAt: validQuote ? quote.at : null,
      volume, sector, sic: code?.sic ?? null, sicDescription: code?.description ?? null, missing,
    }]
  }))
}

/** Default collector for the evaluation job; a missing credential leaves every field missing. */
export function defaultExecutionCollector({ secClient } = {}) {
  return (candidates, { asOf }) => executionDataFor(candidates, {
    asOf,
    closingQuote: alpacaClosingQuote(),
    dailyBars: alpacaSipDailyBars(),
    industry: secClient ? secIndustryCode({ client: secClient }) : async () => { throw new Error('sec_client_unavailable') },
  })
}
