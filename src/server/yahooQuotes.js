import {
  QUOTE_CACHE_TTL_SECONDS,
  getCachedQuote,
  getKnownQuoteSymbols,
  isFreshQuote,
  isRedisEnabled,
  rememberQuoteSymbols,
  setCachedQuote,
} from './quoteCache.js'

const YAHOO_CHART_HOSTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
]

const DEFAULT_REFRESH_CONCURRENCY = Number(process.env.QUOTE_REFRESH_CONCURRENCY ?? 5)

export function normalizeSymbols(symbols) {
  return [...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map((symbol) => String(symbol).trim())
      .filter(Boolean),
  )].slice(0, 100)
}

function isYahooCachedQuote(quote) {
  return !quote?.provider || quote.provider === 'yahoo'
}

async function fetchYahooChartQuote(symbol) {
  let lastError = null

  for (const host of YAHOO_CHART_HOSTS) {
    const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    })

    if (!res.ok) {
      const body = await res.text()
      lastError = new Error(`Yahoo Finance error ${res.status} for ${symbol}: ${body}`)
      continue
    }

    const data = await res.json()
    const chartError = data.chart?.error
    if (chartError) {
      lastError = new Error(`Yahoo Finance error for ${symbol}: ${chartError.description || chartError.code}`)
      continue
    }

    const result = data.chart?.result?.[0]
    const meta = result?.meta
    if (!meta) {
      lastError = new Error(`Yahoo Finance returned no chart metadata for ${symbol}`)
      continue
    }

    const price = Number(meta.regularMarketPrice)

    if (!Number.isFinite(price)) {
      lastError = new Error(`Yahoo Finance returned no price for ${symbol}`)
      continue
    }

    // Derive yesterday's close from the actual daily candles rather than
    // meta.chartPreviousClose, which is the close at the START of the chart
    // range (5 days ago) for symbols with full history. Some thinly traded
    // Canadian CDRs only return today's candle, so fall back to Yahoo's
    // previous-close metadata in that case.
    const timestamps = result.timestamp ?? []
    const closes     = result.indicators?.quote?.[0]?.close ?? []
    const todayStart = new Date().setHours(0, 0, 0, 0)

    let previousClose = null
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] * 1000 < todayStart && Number.isFinite(closes[i])) {
        previousClose = closes[i]
        break
      }
    }

    if (previousClose === null) {
      previousClose = [
        meta.regularMarketPreviousClose,
        meta.previousClose,
        meta.chartPreviousClose,
      ].map(Number).find(Number.isFinite) ?? null
    }

    const change        = previousClose !== null ? price - previousClose : null
    const changePercent = change !== null && previousClose > 0
      ? (change / previousClose) * 100
      : null

    return {
      requestedSymbol: symbol,
      symbol:          meta.symbol ?? symbol,
      provider:        'yahoo',
      shortName:       meta.shortName ?? meta.longName ?? '',
      currency:        meta.currency ?? '',
      price,
      change,
      changePercent,
      previousClose,
      marketTime: meta.regularMarketTime ?? null,
    }
  }

  throw lastError ?? new Error(`Yahoo Finance quote failed for ${symbol}`)
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = []
  const executing = new Set()
  const concurrency = Math.max(1, Number(limit) || 1)

  for (const item of items) {
    const promise = Promise.resolve().then(() => mapper(item))
    const executingPromise = promise.catch(() => {}).finally(() => executing.delete(executingPromise))
    results.push(promise)
    executing.add(executingPromise)

    if (executing.size >= concurrency) {
      await Promise.race(executing)
    }
  }

  return Promise.allSettled(results)
}

async function fetchQuotesFromYahoo(symbols) {
  const results = await mapWithConcurrency(
    symbols,
    DEFAULT_REFRESH_CONCURRENCY,
    fetchYahooChartQuote,
  )
  const quotes = []
  const errors = []

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      quotes.push(result.value)
    } else {
      errors.push({
        symbol: symbols[index],
        error: result.reason?.message ?? String(result.reason),
      })
    }
  })

  return { quotes, errors }
}

export async function fetchYahooQuotes(symbols, options = {}) {
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
    for (const symbol of uniqueSymbols) {
      const cachedQuote = await getCachedQuote(symbol)
      if (cachedQuote && isYahooCachedQuote(cachedQuote) && isFreshQuote(cachedQuote, now)) {
        quotes.push({ ...cachedQuote, cacheStatus: 'hit' })
      } else {
        if (cachedQuote && isYahooCachedQuote(cachedQuote)) {
          staleQuotes.set(symbol.toUpperCase(), cachedQuote)
        }
        symbolsToRefresh.push(symbol)
      }
    }
  } else {
    symbolsToRefresh.push(...uniqueSymbols)
  }

  const freshHits = quotes.length
  const staleCount = staleQuotes.size

  if (symbolsToRefresh.length > 0) {
    const yahooResult = await fetchQuotesFromYahoo(symbolsToRefresh)
    errors.push(...yahooResult.errors)

    for (const quote of yahooResult.quotes) {
      const cachedQuote = await setCachedQuote(quote.symbol, {
        ...quote,
        fetchedAt: now,
      })
      quotes.push({ ...cachedQuote, cacheStatus: 'refreshed' })
    }

    const refreshedSymbols = new Set(yahooResult.quotes.map((quote) => quote.symbol.toUpperCase()))
    for (const symbol of symbolsToRefresh) {
      if (!refreshedSymbols.has(symbol.toUpperCase())) {
        const staleQuote = staleQuotes.get(symbol.toUpperCase())
        if (staleQuote) {
          quotes.push({ ...staleQuote, cacheStatus: 'stale' })
        }
      }
    }
  }

  const found = new Set(quotes.flatMap((quote) => [
    quote.symbol?.toUpperCase(),
    quote.requestedSymbol?.toUpperCase(),
  ].filter(Boolean)))
  const missing = uniqueSymbols.filter((symbol) => !found.has(symbol.toUpperCase()))

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
      staleAvailable: staleCount,
    },
  }
}

export async function refreshKnownYahooQuotes(options = {}) {
  const limit = Number(options.limit ?? 100)
  const symbols = await getKnownQuoteSymbols(limit)
  if (symbols.length === 0) {
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
      },
    }
  }

  return fetchYahooQuotes(symbols, { forceRefresh: true })
}
