import { describe, it, expect, vi, beforeEach } from 'vitest'

const limit = vi.fn()

// A stand-in for @upstash/ratelimit's real sliding-window algorithm, which
// needs a real Redis to run its Lua script against. What matters here is the
// contract isRateLimited relies on: a limiter built from Ratelimit.slidingWindow
// exposes .limit(key) resolving to { success }.
vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    limit(...args) { return limit(...args) }
  }
  Ratelimit.slidingWindow = vi.fn((requests, window) => ({ requests, window }))
  return { Ratelimit }
})

vi.mock('@upstash/redis', () => ({
  Redis: { fromEnv: vi.fn(() => ({})) },
}))

function makeReqRes(headers = {}) {
  const req = { headers, socket: {} }
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
  return { req, res }
}

let isRateLimited

beforeEach(async () => {
  vi.clearAllMocks()
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
  vi.resetModules()
  const mod = await import('./rateLimit.js')
  isRateLimited = mod.isRateLimited
})

describe('isRateLimited', () => {
  it('lets the request through and writes nothing when under budget', async () => {
    limit.mockResolvedValue({ success: true })
    const { req, res } = makeReqRes()

    const limited = await isRateLimited(req, res, 'test-under', { requests: 5, window: '1 m' })

    expect(limited).toBe(false)
    expect(res.statusCode).toBeNull()
  })

  it('writes 429 and reports limited once the caller is over budget', async () => {
    limit.mockResolvedValue({ success: false })
    const { req, res } = makeReqRes()

    const limited = await isRateLimited(req, res, 'test-over', { requests: 5, window: '1 m' })

    expect(limited).toBe(true)
    expect(res.statusCode).toBe(429)
  })

  it('keys on the first hop of x-forwarded-for, so one caller shares one bucket', async () => {
    limit.mockResolvedValue({ success: true })
    const { req, res } = makeReqRes({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' })

    await isRateLimited(req, res, 'test-key', { requests: 5, window: '1 m' })

    expect(limit).toHaveBeenCalledWith('203.0.113.5')
  })

  it('a burst past the limit is refused once the limiter flips over', async () => {
    const { req, res } = makeReqRes()
    limit
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })

    const results = []
    for (let i = 0; i < 3; i += 1) {
      results.push(await isRateLimited(req, res, 'test-burst', { requests: 2, window: '1 m' }))
    }

    expect(results).toEqual([false, false, true])
    expect(res.statusCode).toBe(429)
  })

  it('fails open — allows the request — when Upstash is not configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
    const mod = await import('./rateLimit.js')
    const { req, res } = makeReqRes()

    const limited = await mod.isRateLimited(req, res, 'test-unconfigured', { requests: 5, window: '1 m' })

    expect(limited).toBe(false)
    expect(limit).not.toHaveBeenCalled()
  })

  it('fails open when the limiter itself throws, rather than taking the route down with it', async () => {
    limit.mockRejectedValue(new Error('redis unreachable'))
    const { req, res } = makeReqRes()

    const limited = await isRateLimited(req, res, 'test-throws', { requests: 5, window: '1 m' })

    expect(limited).toBe(false)
    expect(res.statusCode).toBeNull()
  })
})
