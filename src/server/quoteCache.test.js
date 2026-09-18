import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest'
import { isFreshQuote, setCachedQuote, getCachedQuote, rememberQuoteSymbols, getKnownQuoteSymbols } from './quoteCache'

// quoteCache uses in-memory fallback when Redis is not available (no env vars set)
// These tests exercise the in-memory path.

describe('isFreshQuote', () => {
  it('returns true for a quote fetched recently', () => {
    const quote = { fetchedAt: Date.now() - 1000 }
    expect(isFreshQuote(quote)).toBe(true)
  })

  it('returns false for an expired quote', () => {
    const quote = { fetchedAt: Date.now() - 600_000 } // 10 minutes ago (default TTL is 5 min)
    expect(isFreshQuote(quote)).toBe(false)
  })

  it('returns false for null/undefined quote', () => {
    expect(isFreshQuote(null)).toBe(false)
    expect(isFreshQuote(undefined)).toBe(false)
  })

  it('returns false for missing fetchedAt', () => {
    expect(isFreshQuote({ price: 100 })).toBe(false)
  })

  it('uses custom now parameter', () => {
    const fetchedAt = 1000000
    const now = fetchedAt + 60_000 // 1 minute later — within 5-min TTL
    expect(isFreshQuote({ fetchedAt }, now)).toBe(true)
  })
})

describe('setCachedQuote / getCachedQuote (in-memory)', () => {
  beforeEach(() => {
    // Ensure no Redis env vars
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it('stores and retrieves a quote', async () => {
    const quote = { price: 150, symbol: 'AAPL', fetchedAt: Date.now() }
    await setCachedQuote('AAPL', quote)
    const result = await getCachedQuote('AAPL')

    expect(result).toMatchObject({ price: 150, symbol: 'AAPL' })
  })

  it('normalizes symbol to uppercase', async () => {
    await setCachedQuote('msft', { price: 400, fetchedAt: Date.now() })
    const result = await getCachedQuote('MSFT')

    expect(result).toMatchObject({ price: 400 })
  })

  it('returns null for unknown symbol', async () => {
    const result = await getCachedQuote('UNKNOWN_XYZ_999')
    expect(result).toBeNull()
  })

  it('adds fetchedAt if not present', async () => {
    const result = await setCachedQuote('TEST1', { price: 50 })
    expect(result.fetchedAt).toBeDefined()
    expect(typeof result.fetchedAt).toBe('number')
  })
})

describe('rememberQuoteSymbols / getKnownQuoteSymbols (in-memory)', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it('remembers and retrieves symbols', async () => {
    await rememberQuoteSymbols(['GOOG', 'AMZN'])
    const known = await getKnownQuoteSymbols()

    expect(known).toEqual(expect.arrayContaining(['GOOG', 'AMZN']))
  })

  it('deduplicates symbols', async () => {
    await rememberQuoteSymbols(['AAPL', 'AAPL', 'AAPL'])
    const known = await getKnownQuoteSymbols()
    const count = known.filter((s) => s === 'AAPL').length

    expect(count).toBe(1)
  })

  it('ignores empty strings', async () => {
    await rememberQuoteSymbols(['', '  ', 'VALID'])
    const known = await getKnownQuoteSymbols()

    expect(known).not.toContain('')
    expect(known).not.toContain('  ')
  })
})

describe('Redis degradation', () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.doUnmock('@upstash/redis')
    vi.restoreAllMocks()
  })

  it('batches cache reads into one Redis command', async () => {
    const mget = vi.fn().mockResolvedValue([
      { symbol: 'AAPL', price: 150, fetchedAt: Date.now() },
      { symbol: 'MSFT', price: 400, fetchedAt: Date.now() },
    ])
    vi.doMock('@upstash/redis', () => ({ Redis: { fromEnv: () => ({ mget }) } }))
    const { getCachedQuotes } = await import('./quoteCache.js')

    const quotes = await getCachedQuotes(['AAPL', 'MSFT'])

    expect(mget).toHaveBeenCalledTimes(1)
    expect(quotes.map((quote) => quote.price)).toEqual([150, 400])
  })

  it('uses memory after Redis reaches its request limit', async () => {
    const mget = vi.fn().mockRejectedValue(new Error('ERR max requests limit exceeded'))
    vi.doMock('@upstash/redis', () => ({ Redis: { fromEnv: () => ({ mget }) } }))
    const { getCachedQuote, setCachedQuote } = await import('./quoteCache.js')

    expect(await getCachedQuote('AAPL')).toBeNull()
    await setCachedQuote('AAPL', { price: 150, fetchedAt: Date.now() })

    expect(await getCachedQuote('AAPL')).toMatchObject({ price: 150 })
    expect(mget).toHaveBeenCalledTimes(1)
  })
})
