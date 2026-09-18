import { getCachedQuotes, getKnownQuoteSymbols, isFreshQuote } from './quoteCache.js'
import {
  fetchPolygonQuotes,
  isPolygonEnabled,
  isPolygonUsStockSymbol,
} from './polygonQuotes.js'
import { fetchYahooQuotes, normalizeSymbols } from './yahooQuotes.js'

function symbolKey(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function mergeCacheStats(...caches) {
  const validCaches = caches.filter(Boolean)
  return {
    enabled: validCaches.some((cache) => cache.enabled),
    ttlSeconds: validCaches.find((cache) => Number.isFinite(cache.ttlSeconds))?.ttlSeconds ?? null,
    hits: validCaches.reduce((sum, cache) => sum + (cache.hits ?? 0), 0),
    stale: validCaches.reduce((sum, cache) => sum + (cache.stale ?? 0), 0),
    refreshed: validCaches.reduce((sum, cache) => sum + (cache.refreshed ?? 0), 0),
    staleAvailable: validCaches.reduce((sum, cache) => sum + (cache.staleAvailable ?? 0), 0),
    providers: Object.fromEntries(
      validCaches
        .filter((cache) => cache.provider)
        .map((cache) => [cache.provider, cache]),
    ),
    polygonEnabled: isPolygonEnabled(),
  }
}

function getFoundSymbols(quotes) {
  return new Set(quotes.flatMap((quote) => [
    quote.symbol,
    quote.requestedSymbol,
  ].filter(Boolean).map(symbolKey)))
}

function filterUnresolvedErrors(errors, foundSymbols) {
  return errors.filter((error) => !foundSymbols.has(symbolKey(error.symbol)))
}

function splitQuoteSymbols(symbols) {
  const polygonSymbols = []
  const yahooSymbols = []

  for (const symbol of symbols) {
    if (isPolygonEnabled() && isPolygonUsStockSymbol(symbol)) {
      polygonSymbols.push(symbol)
    } else {
      yahooSymbols.push(symbol)
    }
  }

  return { polygonSymbols, yahooSymbols }
}

export async function fetchMarketQuotes(symbols, options = {}) {
  const uniqueSymbols = normalizeSymbols(symbols)
  if (uniqueSymbols.length === 0) {
    const yahooResult = await fetchYahooQuotes([])
    return {
      ...yahooResult,
      cache: mergeCacheStats(yahooResult.cache),
    }
  }

  const { polygonSymbols, yahooSymbols } = splitQuoteSymbols(uniqueSymbols)
  const [polygonResult, yahooResult] = await Promise.all([
    polygonSymbols.length > 0
      ? fetchPolygonQuotes(polygonSymbols, options)
      : Promise.resolve({ quotes: [], missing: [], errors: [], cache: null }),
    yahooSymbols.length > 0
      ? fetchYahooQuotes(yahooSymbols, options)
      : Promise.resolve({ quotes: [], missing: [], errors: [], cache: null }),
  ])

  const polygonFound = getFoundSymbols(polygonResult.quotes)
  const polygonFallbackSymbols = polygonSymbols.filter((symbol) => !polygonFound.has(symbolKey(symbol)))
  const fallbackResult = polygonFallbackSymbols.length > 0
    ? await fetchYahooQuotes(polygonFallbackSymbols, options)
    : { quotes: [], missing: [], errors: [], cache: null }

  const quotes = [
    ...polygonResult.quotes,
    ...yahooResult.quotes,
    ...fallbackResult.quotes,
  ]
  const foundSymbols = getFoundSymbols(quotes)
  const missing = uniqueSymbols.filter((symbol) => !foundSymbols.has(symbolKey(symbol)))
  const errors = filterUnresolvedErrors([
    ...polygonResult.errors,
    ...yahooResult.errors,
    ...fallbackResult.errors,
  ], foundSymbols)

  return {
    quotes,
    missing,
    errors,
    cache: mergeCacheStats(polygonResult.cache, yahooResult.cache, fallbackResult.cache),
  }
}

// Cache-only read: returns whatever is in Redis (fresh or stale) without any
// live provider fetch. Powers the instant first paint on app open — the
// background-refreshed quotes are served immediately, then a normal live call
// ticks them to current.
export async function fetchCachedMarketQuotes(symbols) {
  const uniqueSymbols = normalizeSymbols(symbols)
  const now = Date.now()
  const cachedQuotes = await getCachedQuotes(uniqueSymbols)
  const quotes = cachedQuotes.flatMap((cached) => (
    cached && Number.isFinite(Number(cached.price))
      ? [{ ...cached, cacheStatus: isFreshQuote(cached, now) ? 'hit' : 'stale' }]
      : []
  ))

  const foundSymbols = getFoundSymbols(quotes)
  const missing = uniqueSymbols.filter((symbol) => !foundSymbols.has(symbolKey(symbol)))
  return { quotes, missing, errors: [], cache: { enabled: true, cachedOnly: true, hits: quotes.length } }
}

export async function refreshKnownMarketQuotes(options = {}) {
  const limit = Number(options.limit ?? 100)
  const symbols = await getKnownQuoteSymbols(limit)
  return fetchMarketQuotes(symbols, { ...options, forceRefresh: true })
}
