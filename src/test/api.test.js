import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Every route under test here is now wrapped in withRunLog (#56), which calls
// out to real Upstash/Slack credentials leaked into process.env from .env via
// vite.config.js's loadEnv side effect (see node-version-blocks-test-suite
// memory / the #54 PR). A passthrough here keeps that entirely out of any
// test in this file, rather than chasing env-var deletions across every
// describe block for every real module withRunLog might touch.
vi.mock('../server/runLog.js', () => ({
  withRunLog: (job, handler) => handler,
  recordRun: vi.fn(),
  getRecentRuns: vi.fn().mockResolvedValue([]),
}))

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

  it('no longer bundles market conditions — that moved to its own route (#68)', async () => {
    vi.doMock('@upstash/redis', () => ({
      Redis: { fromEnv: () => ({ get: vi.fn().mockResolvedValue({ picks: [] }) }) },
    }))
    const mod = await import('../../api/get-research.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.body.regime).toBeUndefined()
  })
})

// ─── market-regime tests ────────────────────────────────────────────────────
// Split out of get-research.js in #68 — market conditions get their own
// route now, restoring get-research to one job.

describe('api/market-regime', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects non-GET requests', async () => {
    vi.doMock('../server/marketRegime.js', () => ({ getMarketRegime: vi.fn() }))
    const mod = await import('../../api/market-regime.js')

    const res = mockRes()
    await mod.default(mockReq('POST'), res)

    expect(res.statusCode).toBe(405)
  })

  it('returns the current regime', async () => {
    vi.doMock('../server/marketRegime.js', () => ({
      getMarketRegime: vi.fn().mockResolvedValue({ score: 5.1, label: 'Mixed' }),
    }))
    const mod = await import('../../api/market-regime.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.regime).toEqual({ score: 5.1, label: 'Mixed' })
  })

  it('answers null rather than an error status when the regime lookup fails', async () => {
    // Never fatal on the client's side — the picks matter more than the
    // gauge above them, so this degrades instead of erroring the page.
    vi.doMock('../server/marketRegime.js', () => ({
      getMarketRegime: vi.fn().mockRejectedValue(new Error('fetch failed')),
    }))
    const mod = await import('../../api/market-regime.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.regime).toBeNull()
  })

  it('sets Cache-Control header', async () => {
    vi.doMock('../server/marketRegime.js', () => ({
      getMarketRegime: vi.fn().mockResolvedValue(null),
    }))
    const mod = await import('../../api/market-regime.js')

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

// ─── get-research-history tests ────────────────────────────────────────────
// No coverage existed for this route before #56 wrapped it in withRunLog;
// added alongside that change so the wrap is verified against real behaviour,
// not just syntax-checked.

describe('api/get-research-history', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects non-GET requests', async () => {
    const mod = await import('../../api/get-research-history.js')
    const res = mockRes()
    await mod.default(mockReq('POST'), res)
    expect(res.statusCode).toBe(405)
  })

  it('returns empty entries when Redis is not configured', async () => {
    const mod = await import('../../api/get-research-history.js')
    const res = mockRes()
    await mod.default(mockReq('GET'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.entries).toEqual([])
  })

  it('returns entries with picks from history', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'http://test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    vi.doMock('@upstash/redis', () => ({
      Redis: {
        fromEnv: () => ({
          lrange: vi.fn().mockResolvedValue(['2026-05-01']),
          get: vi.fn().mockResolvedValue({
            generatedAt: '2026-05-01T00:00:00Z',
            signalCount: 10,
            picks: [{ ticker: 'AAPL', conviction: 8, reason: 'x', setupType: 'breakout', price: 150 }],
          }),
        }),
      },
    }))
    const mod = await import('../../api/get-research-history.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.entries).toHaveLength(1)
    expect(res.body.entries[0].picks[0].ticker).toBe('AAPL')
  })
})

// ─── signal-history tests ───────────────────────────────────────────────────

describe('api/signal-history', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects non-GET requests', async () => {
    const mod = await import('../../api/signal-history.js')
    const res = mockRes()
    await mod.default(mockReq('POST'), res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 503 when Redis is not configured', async () => {
    const mod = await import('../../api/signal-history.js')
    const res = mockRes()
    await mod.default(mockReq('GET'), res)
    expect(res.statusCode).toBe(503)
  })

  it('returns aggregate stats built from stored picks', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'http://test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    vi.doMock('@upstash/redis', () => ({
      Redis: {
        fromEnv: () => ({
          lrange: vi.fn().mockResolvedValue(['2026-05-01']),
          get: vi.fn().mockResolvedValue({
            generatedAt: '2026-05-01T00:00:00Z',
            signalCount: 10,
            picks: [{ ticker: 'AAPL', conviction: 8, setupType: 'breakout', price: 150 }],
          }),
        }),
      },
    }))
    const mod = await import('../../api/signal-history.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.stats.totalPicks).toBe(1)
    expect(res.body.stats.topRepeaters[0]).toEqual({ ticker: 'AAPL', count: 1 })
  })
})

// ─── slack-events tests ─────────────────────────────────────────────────────
// Signature verification needs a real HMAC and a live timestamp to exercise
// meaningfully, so coverage here stays to the branches reachable without it —
// still enough to confirm the withRunLog wrap didn't change routing.

describe('api/slack-events', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.SLACK_SIGNING_SECRET
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects non-POST requests', async () => {
    const mod = await import('../../api/slack-events.js')
    const res = mockRes()
    await mod.default(mockReq('GET'), res)
    expect(res.statusCode).toBe(405)
  })

  it('answers the URL verification challenge before checking a signature', async () => {
    const mod = await import('../../api/slack-events.js')
    const res = mockRes()
    await mod.default(mockReq('POST', { type: 'url_verification', challenge: 'abc123' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.challenge).toBe('abc123')
  })

  it('rejects an unsigned event when a signing secret is configured', async () => {
    process.env.SLACK_SIGNING_SECRET = 'test-secret'
    const mod = await import('../../api/slack-events.js')
    const res = mockRes()
    await mod.default(mockReq('POST', { event: { type: 'message', text: 'hi' } }), res)
    expect(res.statusCode).toBe(401)
  })
})

// ─── refresh-prices tests ───────────────────────────────────────────────────

describe('api/refresh-prices', () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects unsupported methods', async () => {
    vi.doMock('../server/marketQuotes.js', () => ({ refreshKnownMarketQuotes: vi.fn() }))
    const mod = await import('../../api/refresh-prices.js')
    const res = mockRes()
    await mod.default(mockReq('DELETE'), res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects a request without the cron secret when one is configured', async () => {
    process.env.CRON_SECRET = 'shh'
    vi.doMock('../server/marketQuotes.js', () => ({ refreshKnownMarketQuotes: vi.fn() }))
    const mod = await import('../../api/refresh-prices.js')
    const res = mockRes()
    await mod.default(mockReq('GET'), res)
    expect(res.statusCode).toBe(401)
  })

  it('refreshes quotes and reports the outcome', async () => {
    const mockRefresh = vi.fn().mockResolvedValue({
      cache: { refreshed: 5 },
      quotes: [{ symbol: 'AAPL' }],
      missing: [],
      errors: [],
    })
    vi.doMock('../server/marketQuotes.js', () => ({ refreshKnownMarketQuotes: mockRefresh }))
    const mod = await import('../../api/refresh-prices.js')

    const res = mockRes()
    await mod.default(mockReq('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.refreshed).toBe(5)
    expect(res.body.quotes).toBe(1)
  })
})
