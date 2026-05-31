import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
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
