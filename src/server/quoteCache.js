import { Redis } from '@upstash/redis'

const KNOWN_SYMBOLS_KEY = 'quotes:symbols'
const memoryQuotes = new Map()
const memorySymbols = new Set()

let redis = null
let redisChecked = false

export const QUOTE_CACHE_TTL_SECONDS = Number(process.env.QUOTE_CACHE_TTL_SECONDS ?? 5 * 60)
export const QUOTE_CACHE_RETENTION_SECONDS = Number(process.env.QUOTE_CACHE_RETENTION_SECONDS ?? 24 * 60 * 60)

function quoteKey(symbol) {
  return `quote:${encodeURIComponent(symbol.toUpperCase())}`
}

function getRedis() {
  if (redisChecked) return redis
  redisChecked = true

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = Redis.fromEnv()
  }

  return redis
}

export function isRedisEnabled() {
  return Boolean(getRedis())
}

export function isFreshQuote(quote, now = Date.now()) {
  if (!quote?.fetchedAt) return false
  return now - Number(quote.fetchedAt) < QUOTE_CACHE_TTL_SECONDS * 1000
}

export async function rememberQuoteSymbols(symbols) {
  const uniqueSymbols = [...new Set(symbols.map((symbol) => String(symbol).trim()).filter(Boolean))]
  if (uniqueSymbols.length === 0) return

  const client = getRedis()
  if (client) {
    await client.sadd(KNOWN_SYMBOLS_KEY, ...uniqueSymbols)
    return
  }

  uniqueSymbols.forEach((symbol) => memorySymbols.add(symbol))
}

export async function getKnownQuoteSymbols(limit = 100) {
  const client = getRedis()
  if (client) {
    const symbols = await client.smembers(KNOWN_SYMBOLS_KEY)
    return symbols.slice(0, limit)
  }

  return [...memorySymbols].slice(0, limit)
}

export async function getCachedQuote(symbol) {
  const client = getRedis()
  if (client) return client.get(quoteKey(symbol))

  const entry = memoryQuotes.get(symbol.toUpperCase())
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memoryQuotes.delete(symbol.toUpperCase())
    return null
  }
  return entry.quote
}

export async function setCachedQuote(symbol, quote) {
  const normalizedSymbol = symbol.toUpperCase()
  const nextQuote = {
    ...quote,
    symbol: quote.symbol ?? symbol,
    requestedSymbol: quote.requestedSymbol ?? symbol,
    fetchedAt: quote.fetchedAt ?? Date.now(),
  }

  const client = getRedis()
  if (client) {
    await client.set(quoteKey(normalizedSymbol), nextQuote, { ex: QUOTE_CACHE_RETENTION_SECONDS })
    await client.sadd(KNOWN_SYMBOLS_KEY, normalizedSymbol)
    return nextQuote
  }

  memoryQuotes.set(normalizedSymbol, {
    quote: nextQuote,
    expiresAt: Date.now() + QUOTE_CACHE_RETENTION_SECONDS * 1000,
  })
  memorySymbols.add(normalizedSymbol)
  return nextQuote
}
