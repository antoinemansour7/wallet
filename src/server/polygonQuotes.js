import {
  QUOTE_CACHE_TTL_SECONDS,
  getCachedQuotes,
  isFreshQuote,
  isRedisEnabled,
  rememberQuoteSymbols,
  setCachedQuote,
} from './quoteCache.js'
import { normalizeSymbols } from './yahooQuotes.js'

const DEFAULT_POLYGON_BASE_URL = 'https://api.massive.com'

function getPolygonApiKey() {
  return process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY || ''
}

function getPolygonBaseUrl() {
  return process.env.POLYGON_API_BASE_URL || process.env.MASSIVE_API_BASE_URL || DEFAULT_POLYGON_BASE_URL
}

function symbolKey(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }

  return null
}

function polygonTimestampToSeconds(value) {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null

  // Polygon/Massive snapshot timestamps are nanoseconds.
  return timestamp > 1e12 ? Math.floor(timestamp / 1e9) : Math.floor(timestamp)
}

function isPolygonCachedQuote(quote) {
  return quote?.provider === 'polygon'
}

function normalizePolygonSnapshot(item, requestedSymbols) {
  const ticker = item?.ticker
  if (!ticker) return null

  const requestedSymbol = requestedSymbols.get(symbolKey(ticker)) ?? ticker
  const price = finiteNumber(
    item.lastTrade?.p,
    item.min?.c,
    item.day?.c,
    item.prevDay?.c,
  )

  if (price === null) return null

  const previousClose = finiteNumber(item.prevDay?.c)
  const change = finiteNumber(item.todaysChange)
    ?? (previousClose !== null ? price - previousClose : null)
  const changePercent = finiteNumber(item.todaysChangePerc)
    ?? (change !== null && previousClose > 0 ? (change / previousClose) * 100 : null)

  return {
    requestedSymbol,
    symbol: ticker,
    provider: 'polygon',
    shortName: '',
    currency: 'USD',
    price,
    change,
    changePercent,
    previousClose,
    marketTime: polygonTimestampToSeconds(item.updated),
  }
}

async function fetchPolygonSnapshots(symbols) {
  const apiKey = getPolygonApiKey()
  if (!apiKey) {
    return {
      quotes: [],
      errors: symbols.map((symbol) => ({
        symbol,
        error: 'Polygon API key is not configured.',
      })),
    }
  }

  const url = new URL('/v2/snapshot/locale/us/markets/stocks/tickers', getPolygonBaseUrl())
  url.searchParams.set('tickers', symbols.join(','))

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    return {
      quotes: [],
      errors: symbols.map((symbol) => ({
        symbol,
        error: `Polygon snapshot error ${res.status}: ${body}`,
      })),
    }
  }

  const data = await res.json()
  const requestedSymbols = new Map(symbols.map((symbol) => [symbolKey(symbol), symbol]))
  const quotes = (Array.isArray(data.tickers) ? data.tickers : [])
    .map((item) => normalizePolygonSnapshot(item, requestedSymbols))
    .filter(Boolean)

  return { quotes, errors: [] }
}

export function isPolygonEnabled() {
  return Boolean(getPolygonApiKey())
}

export function isPolygonUsStockSymbol(symbol) {
  const normalized = symbolKey(symbol)
  if (!normalized) return false
  if (normalized.includes('.') || normalized.includes('=') || normalized.includes('/')) return false

  return /^[A-Z][A-Z0-9-]{0,14}$/.test(normalized)
}

export async function fetchPolygonQuotes(symbols, options = {}) {
  const uniqueSymbols = normalizeSymbols(symbols)
  if (uniqueSymbols.length === 0) {
    return {
      quotes: [],
      missing: [],
      errors: [],
      cache: {
        enabled: isRedisEnabled(),
        ttlSeconds: QUOTE_CACHE_TTL_SECONDS,
        hits: 0,
        stale: 0,
        refreshed: 0,
        provider: 'polygon',
      },
    }
  }

  await rememberQuoteSymbols(uniqueSymbols)

  const now = Date.now()
  const quotes = []
  const staleQuotes = new Map()
  const symbolsToRefresh = []
  const errors = []

  if (!options.forceRefresh) {
    const cachedQuotes = await getCachedQuotes(uniqueSymbols)
    for (const [index, symbol] of uniqueSymbols.entries()) {
      const cachedQuote = cachedQuotes[index]
      if (cachedQuote && isPolygonCachedQuote(cachedQuote) && isFreshQuote(cachedQuote, now)) {
        quotes.push({ ...cachedQuote, cacheStatus: 'hit' })
      } else {
        if (cachedQuote && isPolygonCachedQuote(cachedQuote)) {
          staleQuotes.set(symbolKey(symbol), cachedQuote)
        }
        symbolsToRefresh.push(symbol)
      }
    }
  } else {
    symbolsToRefresh.push(...uniqueSymbols)
  }

  const freshHits = quotes.length
  const staleAvailable = staleQuotes.size

  if (symbolsToRefresh.length > 0) {
    const polygonResult = await fetchPolygonSnapshots(symbolsToRefresh)
    errors.push(...polygonResult.errors)

    for (const quote of polygonResult.quotes) {
      const cachedQuote = await setCachedQuote(quote.requestedSymbol, {
        ...quote,
        fetchedAt: now,
      })
      quotes.push({ ...cachedQuote, cacheStatus: 'refreshed' })
    }

    const refreshedSymbols = new Set(polygonResult.quotes.flatMap((quote) => [
      quote.symbol,
      quote.requestedSymbol,
    ].filter(Boolean).map(symbolKey)))
    for (const symbol of symbolsToRefresh) {
      if (!refreshedSymbols.has(symbolKey(symbol))) {
        const staleQuote = staleQuotes.get(symbolKey(symbol))
        if (staleQuote) {
          quotes.push({ ...staleQuote, cacheStatus: 'stale' })
        }
      }
    }
  }

  const found = new Set(quotes.flatMap((quote) => [
    quote.symbol,
    quote.requestedSymbol,
  ].filter(Boolean).map(symbolKey)))
  const missing = uniqueSymbols.filter((symbol) => !found.has(symbolKey(symbol)))

  return {
    quotes,
    missing,
    errors,
    cache: {
      enabled: isRedisEnabled(),
      ttlSeconds: QUOTE_CACHE_TTL_SECONDS,
      hits: freshHits,
      stale: quotes.filter((quote) => quote.cacheStatus === 'stale').length,
      refreshed: quotes.filter((quote) => quote.cacheStatus === 'refreshed').length,
      staleAvailable,
      provider: 'polygon',
    },
  }
}
