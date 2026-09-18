import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withRunLog } from './runLog.js'

// recordRun's own console.log line is the one thing withRunLog's callers can
// observe without either mocking real Upstash infrastructure or fighting
// same-module ESM binding (a spy on an imported recordRun wouldn't see
// withRunLog's own internal call to it — they're bound at module evaluation,
// not through the exported namespace). Deleting these env vars keeps
// recordRun's own Redis calls from firing during the test.
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
}

describe('withRunLog', () => {
  let logSpy

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes req/res through and returns the handler\'s result unchanged', async () => {
    const handler = vi.fn(async (req, res) => {
      res.status(200).json({ ok: true })
      return 'handler-result'
    })
    const req = { id: 1 }
    const res = makeRes()

    const result = await withRunLog('test-job', handler)(req, res)

    expect(result).toBe('handler-result')
    expect(handler).toHaveBeenCalledWith(req, res)
    expect(res.statusCode).toBe(200)
  })

  it('records a 2xx response as OK', async () => {
    const handler = async (req, res) => res.status(200).json({})

    await withRunLog('test-job', handler)({}, makeRes())

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[runLog] test-job: OK'))
  })

  it('does not treat a 4xx status as a failure — ordinary traffic, not a bug', async () => {
    const handler = async (req, res) => res.status(400).json({ error: 'bad input' })

    await withRunLog('test-job', handler)({}, makeRes())

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[runLog] test-job: OK'))
  })

  it('records a 429 (rate limited) as ordinary traffic too', async () => {
    const handler = async (req, res) => res.status(429).json({ error: 'Too many requests' })

    await withRunLog('test-job', handler)({}, makeRes())

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[runLog] test-job: OK'))
  })

  it('records a 5xx response as a failure, without altering the response', async () => {
    const handler = async (req, res) => res.status(500).json({ error: 'boom' })
    const res = makeRes()

    await withRunLog('test-job', handler)({}, res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'boom' })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[runLog] test-job: 1 ERROR(S)'))
  })

  it('records the failure and rethrows when the handler itself throws', async () => {
    const err = new Error('kaboom')
    const handler = async () => { throw err }

    await expect(withRunLog('test-job', handler)({}, makeRes())).rejects.toThrow('kaboom')

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[runLog] test-job: 1 ERROR(S)'))
  })

  it('treats a response with no status ever set as a 200', async () => {
    const handler = async () => 'nothing called res.status'

    await withRunLog('test-job', handler)({}, makeRes())

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[runLog] test-job: OK'))
  })
})
