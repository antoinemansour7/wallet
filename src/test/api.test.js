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
    vi.resetModules()
  })

  afterEach(() => {
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
})
