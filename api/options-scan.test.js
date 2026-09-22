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

  it('dispatches through one route and does not expose the provider message ID', async () => {
    const runStage = vi.fn(async ({ stage, requestId, execute }) => {
      expect(stage).toBe('premarket')
      expect(requestId).toBe('message-secret-id')
      expect(await execute({ checkpoint: null })).toMatchObject({ status: 'incomplete', reason: 'premarket_worker_not_installed' })
      return { status: 'incomplete', stage, tradingDate: '2026-09-22', attempt: 1, auditRecordId: 'audit-reference' }
    })
    const handler = createOptionsScanHandler({ getRedis: () => ({ redis: true }), makeArchive: () => ({ archive: true }), runStage, enabled: () => true })
    const res = response()
    await handler(request(), res)
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ status: 'incomplete', stage: 'premarket', tradingDate: '2026-09-22', attempt: 1, reference: 'audit-reference' })
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
