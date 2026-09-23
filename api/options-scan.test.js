// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOptionsScanHandler } from './options-scan.js'

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this }, json(value) { this.body = value; return this } }
}

const request = (overrides = {}) => ({
  method: 'POST',
  headers: { authorization: 'Bearer cron-secret', 'x-qstash-message-id': 'message-secret-id' },
  query: { mode: 'premarket' },
  ...overrides,
})

describe('options scan dispatcher', () => {
  beforeEach(() => { process.env.CRON_SECRET = 'cron-secret' })

  it('requires the cron secret and a bounded mode', async () => {
    const handler = createOptionsScanHandler({ runStage: vi.fn() })
    let res = response()
    await handler(request({ headers: {} }), res)
    expect(res.statusCode).toBe(401)
    res = response()
    await handler(request({ query: { mode: 'other' } }), res)
    expect(res.statusCode).toBe(400)
  })

  it('dispatches opening into the real worker with the redis handle attached', async () => {
    const runOpeningStage = vi.fn(async () => ({ status: 'complete', records: [], metrics: { acceptedCount: 2 } }))
    const redis = { redis: true }
    const runStage = vi.fn(async ({ stage, execute }) => {
      expect(await execute({ checkpoint: null })).toMatchObject({ status: 'complete', metrics: { acceptedCount: 2 } })
      return { status: 'complete', stage, tradingDate: '2026-09-22', attempt: 1, auditRecordId: 'audit-reference' }
    })
    const handler = createOptionsScanHandler({ getRedis: () => redis, makeArchive: () => ({ archive: true }), runStage, enabled: () => true, runOpeningStage })
    const res = response()
    await handler(request({ query: { mode: 'opening' } }), res)
    expect(res.statusCode).toBe(200)
    expect(runOpeningStage).toHaveBeenCalledWith(expect.objectContaining({ redis, archive: { archive: true } }))
  })

  it('dispatches premarket into the real worker and does not expose the provider message ID', async () => {
    const runPremarketStage = vi.fn(async () => ({ status: 'complete', records: [], metrics: { candidateCount: 3 } }))
    const runStage = vi.fn(async ({ stage, requestId, execute }) => {
      expect(stage).toBe('premarket')
      expect(requestId).toBe('message-secret-id')
      const outcome = await execute({ checkpoint: null })
      expect(outcome).toMatchObject({ status: 'complete', metrics: { candidateCount: 3 } })
      return { status: 'complete', stage, tradingDate: '2026-09-22', attempt: 1, auditRecordId: 'audit-reference' }
    })
    const handler = createOptionsScanHandler({ getRedis: () => ({ redis: true }), makeArchive: () => ({ archive: true }), runStage, enabled: () => true, runPremarketStage })
    const res = response()
    await handler(request(), res)
    expect(res.statusCode).toBe(200)
    expect(runPremarketStage).toHaveBeenCalledOnce()
    expect(JSON.stringify(res.body)).not.toContain('message-secret-id')
  })

  it('returns a sanitized fail-closed response on lease storage failure', async () => {
    const runStage = vi.fn(async () => { throw new Error('ERR max requests limit exceeded token=secret') })
    const handler = createOptionsScanHandler({ getRedis: () => ({ redis: true }), makeArchive: () => ({}), runStage, enabled: () => true })
    const res = response()
    await handler(request(), res)
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ error: 'Options scan scheduling is unavailable.', category: 'schedule_dispatch_failed' })
    expect(JSON.stringify(res.body)).not.toContain('max requests')
    expect(JSON.stringify(res.body)).not.toContain('secret')
  })
})
