import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Helper to create mock req/res
function mockReq(method = 'GET', body = null, headers = {}) {
  return { method, body, headers }
}

function mockRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    status(code) { res.statusCode = code; return res },
    json(data) { res.body = data; return res },
    setHeader(key, value) { res.headers[key] = value; return res },
  }
  return res
}

// ─── get-research tests ─────────────────────────────────────────────────────

describe('api/get-research', () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'http://test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.restoreAllMocks()
  })

  it('rejects non-GET requests', async () => {
    vi.doMock('@upstash/redis', () => ({
      Redis: { fromEnv: () => ({ get: vi.fn() }) },
    }))
    const mod = await import('../../api/get-research.js')

    const res = mockRes()
    await mod.default(mockReq('POST'), res)

    expect(res.statusCode).toBe(405)
  })

  it('returns stored research data from Redis', async () => {
    const mockData = { picks: [{ ticker: 'MU', conviction: 7 }], signalCount: 50 }
    vi.doMock('@upstash/redis', () => ({
      Redis: { fromEnv: () => ({ get: vi.fn().mockResolvedValue(mockData) }) },
    }))
    const mod = await import('../../api/get-research.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.picks[0].ticker).toBe('MU')
  })

  it('returns empty response when Redis has no data', async () => {
    vi.doMock('@upstash/redis', () => ({
      Redis: { fromEnv: () => ({ get: vi.fn().mockResolvedValue(null) }) },
    }))
    const mod = await import('../../api/get-research.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.empty).toBe(true)
    expect(res.body.picks).toEqual([])
  })

  it('returns empty response on Redis error', async () => {
    vi.doMock('@upstash/redis', () => ({
      Redis: { fromEnv: () => ({ get: vi.fn().mockRejectedValue(new Error('fail')) }) },
    }))
    const mod = await import('../../api/get-research.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.empty).toBe(true)
  })

  it('sets Cache-Control header', async () => {
    vi.doMock('@upstash/redis', () => ({
      Redis: { fromEnv: () => ({ get: vi.fn().mockResolvedValue(null) }) },
    }))
    const mod = await import('../../api/get-research.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.headers['Cache-Control']).toContain('s-maxage=900')
  })
})

// ─── live-prices tests ──────────────────────────────────────────────────────

describe('api/live-prices', () => {
  beforeEach(() => {
    // These endpoints now check src/server/rateLimit.js, which reads real
    // Upstash credentials out of .env via vite.config.js's loadEnv side
    // effect. Tests that don't mock rateLimit.js directly would otherwise
    // make a live call to production Redis on every run.
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
  })

  afterEach(() => {
    // vi.doMock registrations outlive the test that made them — unmock
    // explicitly so a later describe block's "happy path" test doesn't
    // silently inherit whichever rate-limit mock ran last in this one.
    vi.doUnmock('../server/rateLimit.js')
    vi.restoreAllMocks()
  })

  it('rejects non-POST requests', async () => {
    vi.doMock('../server/marketQuotes.js', () => ({
      fetchMarketQuotes: vi.fn(),
    }))
    const mod = await import('../../api/live-prices.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.statusCode).toBe(405)
  })

  it('calls fetchMarketQuotes with provided symbols', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      quotes: [{ symbol: 'AAPL', price: 150 }],
      missing: [],
      errors: [],
    })
    vi.doMock('../server/marketQuotes.js', () => ({
      fetchMarketQuotes: mockFetch,
    }))
    const mod = await import('../../api/live-prices.js')

    const res = mockRes()
    await mod.default(mockReq('POST', { symbols: ['AAPL'] }), res)

    expect(res.statusCode).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(['AAPL'])
    expect(res.body.quotes[0].price).toBe(150)
  })

  it('returns 500 on error', async () => {
    vi.doMock('../server/marketQuotes.js', () => ({
      fetchMarketQuotes: vi.fn().mockRejectedValue(new Error('Yahoo down')),
    }))
    const mod = await import('../../api/live-prices.js')

    const res = mockRes()
    await mod.default(mockReq('POST', { symbols: ['X'] }), res)

    expect(res.statusCode).toBe(500)
    expect(res.body.error).toBe('Yahoo down')
  })

  it('serves cached-only quotes instantly without a live fetch', async () => {
    const liveFetch = vi.fn()
    const cachedFetch = vi.fn().mockResolvedValue({ quotes: [{ symbol: 'AAPL', price: 149, cacheStatus: 'stale' }], missing: [], errors: [], cache: { cachedOnly: true } })
    vi.doMock('../server/marketQuotes.js', () => ({ fetchMarketQuotes: liveFetch, fetchCachedMarketQuotes: cachedFetch }))
    const mod = await import('../../api/live-prices.js')

    const res = mockRes()
    await mod.default(mockReq('POST', { symbols: ['AAPL'], cachedOnly: true }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.quotes[0].price).toBe(149)
    expect(cachedFetch).toHaveBeenCalledWith(['AAPL'])
    expect(liveFetch).not.toHaveBeenCalled()
  })

  it('dispatches to portfolio series when positions are provided', async () => {
    const mockSeries = vi.fn().mockResolvedValue([{ date: '2026-06-10', marketValue: 1000 }])
    vi.doMock('../server/marketQuotes.js', () => ({ fetchMarketQuotes: vi.fn() }))
    vi.doMock('../server/portfolioSeries.js', () => ({ getPortfolioSeries: mockSeries }))
    const mod = await import('../../api/live-prices.js')

    const res = mockRes()
    await mod.default(mockReq('POST', { positions: [{ symbol: 'AAPL', quantity: 2 }], cashValue: 100 }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.series).toHaveLength(1)
    expect(mockSeries).toHaveBeenCalledWith({ positions: [{ symbol: 'AAPL', quantity: 2 }], cashValue: 100, days: 365 })
  })

  it('rejects an oversized symbols array with 400 before calling out for quotes', async () => {
    const mockFetch = vi.fn()
    vi.doMock('../server/marketQuotes.js', () => ({ fetchMarketQuotes: mockFetch }))
    const mod = await import('../../api/live-prices.js')

    const res = mockRes()
    const symbols = Array.from({ length: 201 }, (_, i) => `SYM${i}`)
    await mod.default(mockReq('POST', { symbols }), res)

    expect(res.statusCode).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects an oversized positions array with 400 before reconstructing history', async () => {
    const mockSeries = vi.fn()
    vi.doMock('../server/marketQuotes.js', () => ({ fetchMarketQuotes: vi.fn() }))
    vi.doMock('../server/portfolioSeries.js', () => ({ getPortfolioSeries: mockSeries }))
    const mod = await import('../../api/live-prices.js')

    const res = mockRes()
    const positions = Array.from({ length: 501 }, (_, i) => ({ symbol: `SYM${i}`, quantity: 1 }))
    await mod.default(mockReq('POST', { positions }), res)

    expect(res.statusCode).toBe(400)
    expect(mockSeries).not.toHaveBeenCalled()
  })

  it('returns 429 without fetching quotes once the caller is rate limited', async () => {
    const mockFetch = vi.fn()
    vi.doMock('../server/marketQuotes.js', () => ({ fetchMarketQuotes: mockFetch }))
    vi.doMock('../server/rateLimit.js', () => ({ isRateLimited: vi.fn().mockResolvedValue(true) }))
    const mod = await import('../../api/live-prices.js')

    const res = mockRes()
    await mod.default(mockReq('POST', { symbols: ['AAPL'] }), res)

    expect(res.statusCode).toBeNull() // isRateLimited owns the response in this mock
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ─── position-sizing tests ──────────────────────────────────────────────────

describe('api/position-sizing', () => {
  beforeEach(() => {
    // These endpoints now check src/server/rateLimit.js, which reads real
    // Upstash credentials out of .env via vite.config.js's loadEnv side
    // effect. Tests that don't mock rateLimit.js directly would otherwise
    // make a live call to production Redis on every run.
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
  })

  afterEach(() => {
    // vi.doMock registrations outlive the test that made them — unmock
    // explicitly so a later describe block's "happy path" test doesn't
    // silently inherit whichever rate-limit mock ran last in this one.
    vi.doUnmock('../server/rateLimit.js')
    vi.restoreAllMocks()
  })

  it('rejects non-POST requests', async () => {
    vi.doMock('../server/agents/positionSizingAgent.js', () => ({ runPositionSizingAgent: vi.fn() }))
    const mod = await import('../../api/position-sizing.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.statusCode).toBe(405)
  })

  it('runs the agent for a valid request', async () => {
    const mockAgent = vi.fn().mockResolvedValue({ sizedPicks: [] })
    vi.doMock('../server/agents/positionSizingAgent.js', () => ({ runPositionSizingAgent: mockAgent }))
    const mod = await import('../../api/position-sizing.js')

    const res = mockRes()
    await mod.default(mockReq('POST', {
      picks: [{ ticker: 'AAPL' }],
      portfolioRows: [{ SYMBOL: 'AAPL' }],
    }), res)

    expect(res.statusCode).toBe(200)
    expect(mockAgent).toHaveBeenCalled()
  })

  it('returns 429 without calling Claude once the caller is rate limited', async () => {
    const mockAgent = vi.fn()
    vi.doMock('../server/agents/positionSizingAgent.js', () => ({ runPositionSizingAgent: mockAgent }))
    vi.doMock('../server/rateLimit.js', () => ({
      isRateLimited: vi.fn(async (req, res) => { res.status(429).json({ error: 'Too many requests. Try again shortly.' }); return true }),
    }))
    const mod = await import('../../api/position-sizing.js')

    const res = mockRes()
    await mod.default(mockReq('POST', {
      picks: [{ ticker: 'AAPL' }],
      portfolioRows: [{ SYMBOL: 'AAPL' }],
    }), res)

    expect(res.statusCode).toBe(429)
    expect(mockAgent).not.toHaveBeenCalled()
  })

  it('a burst of calls is refused after the limit is hit', async () => {
    const mockAgent = vi.fn().mockResolvedValue({ sizedPicks: [] })
    vi.doMock('../server/agents/positionSizingAgent.js', () => ({ runPositionSizingAgent: mockAgent }))
    const isRateLimited = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async (req, res) => { res.status(429).json({ error: 'Too many requests. Try again shortly.' }); return true })
    vi.doMock('../server/rateLimit.js', () => ({ isRateLimited }))
    const mod = await import('../../api/position-sizing.js')

    const body = { picks: [{ ticker: 'AAPL' }], portfolioRows: [{ SYMBOL: 'AAPL' }] }
    const statuses = []
    for (let i = 0; i < 3; i += 1) {
      const res = mockRes()
      await mod.default(mockReq('POST', body), res)
      statuses.push(res.statusCode)
    }

    expect(statuses).toEqual([200, 200, 429])
    expect(mockAgent).toHaveBeenCalledTimes(2)
  })
})

// ─── extract-pdf tests ──────────────────────────────────────────────────────

describe('api/extract-pdf', () => {
  beforeEach(() => {
    // These endpoints now check src/server/rateLimit.js, which reads real
    // Upstash credentials out of .env via vite.config.js's loadEnv side
    // effect. Tests that don't mock rateLimit.js directly would otherwise
    // make a live call to production Redis on every run.
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
  })

  afterEach(() => {
    // vi.doMock registrations outlive the test that made them — unmock
    // explicitly so a later describe block's "happy path" test doesn't
    // silently inherit whichever rate-limit mock ran last in this one.
    vi.doUnmock('../server/rateLimit.js')
    vi.restoreAllMocks()
  })

  it('rejects non-POST requests', async () => {
    vi.doMock('../server/extractPositions.js', () => ({ extractPositionsWithGroq: vi.fn() }))
    const mod = await import('../../api/extract-pdf.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.statusCode).toBe(405)
  })

  it('extracts rows for a valid request', async () => {
    const mockExtract = vi.fn().mockResolvedValue([{ SYMBOL: 'AAPL' }])
    vi.doMock('../server/extractPositions.js', () => ({ extractPositionsWithGroq: mockExtract }))
    const mod = await import('../../api/extract-pdf.js')

    const res = mockRes()
    await mod.default(mockReq('POST', { text: 'statement text' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.rows[0].SYMBOL).toBe('AAPL')
  })

  it('rejects text over the length cap with 400 before calling Groq', async () => {
    const mockExtract = vi.fn()
    vi.doMock('../server/extractPositions.js', () => ({ extractPositionsWithGroq: mockExtract }))
    const mod = await import('../../api/extract-pdf.js')

    const res = mockRes()
    await mod.default(mockReq('POST', { text: 'x'.repeat(200_001) }), res)

    expect(res.statusCode).toBe(400)
    expect(mockExtract).not.toHaveBeenCalled()
  })

  it('returns 429 without calling Groq once the caller is rate limited', async () => {
    const mockExtract = vi.fn()
    vi.doMock('../server/extractPositions.js', () => ({ extractPositionsWithGroq: mockExtract }))
    vi.doMock('../server/rateLimit.js', () => ({
      isRateLimited: vi.fn(async (req, res) => { res.status(429).json({ error: 'Too many requests. Try again shortly.' }); return true }),
    }))
    const mod = await import('../../api/extract-pdf.js')

    const res = mockRes()
    await mod.default(mockReq('POST', { text: 'statement text' }), res)

    expect(res.statusCode).toBe(429)
    expect(mockExtract).not.toHaveBeenCalled()
  })
})
