import { Redis } from '@upstash/redis'

const CACHE_VERSION = 'v3'
const KNOWN_SYMBOLS_KEY = `quotes:${CACHE_VERSION}:symbols`
const memoryQuotes = new Map()
const memorySymbols = new Set()
const REDIS_RETRY_DELAY_MS = 60 * 1000

let redis = null
let redisChecked = false
let redisUnavailableUntil = 0

export const QUOTE_CACHE_TTL_SECONDS = Number(process.env.QUOTE_CACHE_TTL_SECONDS ?? 5 * 60)
export const QUOTE_CACHE_RETENTION_SECONDS = Number(process.env.QUOTE_CACHE_RETENTION_SECONDS ?? 24 * 60 * 60)

function quoteKey(symbol) {
  return `quote:${CACHE_VERSION}:${encodeURIComponent(symbol.toUpperCase())}`
}

function getRedis() {
  if (redisChecked) return redis
  redisChecked = true

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = Redis.fromEnv()
  }

  return redis
}

function getAvailableRedis() {
  const client = getRedis()
  return client && Date.now() >= redisUnavailableUntil ? client : null
}

function pauseRedis(err) {
  // Quota exhaustion and transient Redis failures must not take live market
  // data down with the optional cache. Avoid retrying every symbol after the
  // first failure; a warm function instance will try Redis again in a minute.
  if (Date.now() >= redisUnavailableUntil) {
    console.warn('[quoteCache] Redis unavailable; using memory cache:', err.message)
  }
  redisUnavailableUntil = Date.now() + REDIS_RETRY_DELAY_MS
}

function readMemoryQuote(symbol) {
  const key = symbol.toUpperCase()
  const entry = memoryQuotes.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memoryQuotes.delete(key)
    return null
  }
  return entry.quote
}

function writeMemoryQuote(symbol, quote) {
  const key = symbol.toUpperCase()
  memoryQuotes.set(key, {
    quote,
    expiresAt: Date.now() + QUOTE_CACHE_RETENTION_SECONDS * 1000,
  })
  memorySymbols.add(key)
}

export function isRedisEnabled() {
  return Boolean(getAvailableRedis())
}

export function isFreshQuote(quote, now = Date.now()) {
  if (!quote?.fetchedAt) return false
  return now - Number(quote.fetchedAt) < QUOTE_CACHE_TTL_SECONDS * 1000
}

export async function rememberQuoteSymbols(symbols) {
  const uniqueSymbols = [...new Set(symbols.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))]
  if (uniqueSymbols.length === 0) return

  uniqueSymbols.forEach((symbol) => memorySymbols.add(symbol))

  const client = getAvailableRedis()
  if (client) {
    try {
      await client.sadd(KNOWN_SYMBOLS_KEY, ...uniqueSymbols)
    } catch (err) {
      pauseRedis(err)
    }
  }
}

export async function getKnownQuoteSymbols(limit = 100) {
  const client = getAvailableRedis()
  if (client) {
    try {
      const symbols = await client.smembers(KNOWN_SYMBOLS_KEY)
      symbols.forEach((symbol) => memorySymbols.add(symbol))
      return symbols.slice(0, limit)
    } catch (err) {
      pauseRedis(err)
    }
  }

  return [...memorySymbols].slice(0, limit)
}

export async function getCachedQuote(symbol) {
  const [quote] = await getCachedQuotes([symbol])
  return quote
}

/** Read any number of quote keys as one billable Redis command. */
export async function getCachedQuotes(symbols) {
  const normalized = symbols.map((symbol) => String(symbol).toUpperCase())
  const local = normalized.map(readMemoryQuote)
  const missingIndexes = local.flatMap((quote, index) => quote ? [] : [index])
  if (missingIndexes.length === 0) return local

  const client = getAvailableRedis()
  if (!client) return local

  try {
    const values = await client.mget(...missingIndexes.map((index) => quoteKey(normalized[index])))
    values.forEach((quote, valueIndex) => {
      if (!quote) return
      const index = missingIndexes[valueIndex]
      local[index] = quote
      writeMemoryQuote(normalized[index], quote)
    })
  } catch (err) {
    pauseRedis(err)
  }

  return local
}

export async function setCachedQuote(symbol, quote) {
  const normalizedSymbol = symbol.toUpperCase()
  const nextQuote = {
    ...quote,
    symbol: quote.symbol ?? symbol,
    requestedSymbol: quote.requestedSymbol ?? symbol,
    fetchedAt: quote.fetchedAt ?? Date.now(),
  }

  // Always retain a process-local copy. Serverless instances are short-lived,
  // but this lets the current request and warm follow-ups survive Redis limits.
  writeMemoryQuote(normalizedSymbol, nextQuote)

  const client = getAvailableRedis()
  if (client) {
    try {
      await client.set(quoteKey(normalizedSymbol), nextQuote, { ex: QUOTE_CACHE_RETENTION_SECONDS })
    } catch (err) {
      pauseRedis(err)
    }
  }

  return nextQuote
}
