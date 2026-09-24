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
    const records = [{ recordId: 'record' }]
    const runOpeningStage = vi.fn(async () => ({ status: 'complete', scanId: 'scan', availableAt: '2026-09-22T13:34:00.000Z', records, metrics: { acceptedCount: 2 } }))
    const commitScan = vi.fn(async () => ({ manifest: { manifestId: 'manifest' } }))
    const redis = { redis: true }
    const runStage = vi.fn(async ({ stage, execute, publish }) => {
      const outcome = await execute({ checkpoint: null })
      expect(outcome).toMatchObject({ status: 'complete', metrics: { acceptedCount: 2 } })
      await publish(outcome, { lockKey: 'lease-key', lockToken: 'lease-token' })
      return { status: 'complete', stage, tradingDate: '2026-09-22', attempt: 1, auditRecordId: 'audit-reference' }
    })
    const handler = createOptionsScanHandler({ getRedis: () => redis, makeArchive: () => ({ archive: true }), runStage, enabled: () => true, runOpeningStage, commitScan })
    const res = response()
    await handler(request({ query: { mode: 'opening' } }), res)
    expect(res.statusCode).toBe(200)
    expect(runOpeningStage).toHaveBeenCalledWith(expect.objectContaining({ redis, archive: { archive: true } }))
    expect(commitScan).toHaveBeenCalledWith(expect.objectContaining({
      redis, records, scanId: 'scan', lockKey: 'lease-key', lockToken: 'lease-token', requirePublication: true,
    }))
  })

  it('dispatches the shadow stage, archives its frozen experiment and points capture at it without publishing a scan', async () => {
    const experiment = { experimentId: 'e'.repeat(64), availableAt: '2026-09-22T13:37:30.000Z', tradingDate: '2026-09-22' }
    const runShadowStage = vi.fn(async () => ({ status: 'complete', scanId: 'shadow-scan', availableAt: experiment.availableAt, records: [], experiment, metrics: { selectedContracts: 4 } }))
    const redis = { set: vi.fn(async () => 'OK') }
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const commitScan = vi.fn()
    const runStage = vi.fn(async ({ stage, execute, publish }) => {
      const outcome = await execute({ checkpoint: null })
      await publish(outcome, { lockKey: 'lease-key', lockToken: 'lease-token' })
      return { status: 'complete', stage, tradingDate: '2026-09-22', attempt: 1 }
    })
    const handler = createOptionsScanHandler({ getRedis: () => redis, makeArchive: () => archive, runStage, enabled: () => true, runShadowStage, commitScan })
    const res = response()
    await handler(request({ query: { mode: 'shadow' } }), res)
    expect(res.statusCode).toBe(200)
    // The stage receives the command-counting proxy over this same client.
    expect(runShadowStage).toHaveBeenCalledWith(expect.objectContaining({ archive, redis: expect.anything() }))
    expect(archive.put).toHaveBeenCalledWith('options-experiment', experiment.experimentId, experiment, 'options-experiments', experiment.availableAt)
    expect(redis.set).toHaveBeenCalledWith('research:options:experiments:latest:v1', experiment.experimentId)
    expect(commitScan).not.toHaveBeenCalled()

    const missing = createOptionsScanHandler({ getRedis: () => redis, makeArchive: () => archive, enabled: () => true, commitScan,
      runShadowStage: async () => ({ status: 'complete', records: [], metrics: {} }),
      runStage: async ({ execute, publish }) => { await publish(await execute({ checkpoint: null }), {}) } })
    const failed = response()
    await missing(request({ query: { mode: 'shadow' } }), failed)
    expect(failed.statusCode).toBe(503)
    expect(failed.body).toMatchObject({ category: 'schedule_dispatch_failed' })
  })

  it('counts Redis commands through the whole stage attempt and totals archived bytes into the metrics (#215)', async () => {
    const records = [{ recordId: 'r1', byteLength: 1200 }, { recordId: 'r2', byteLength: 800 }]
    const runOpeningStage = vi.fn(async ({ redis }) => {
      await redis.get('x') // the scheduler's own lease/checkpoint calls land on the same shared, counted client
      await redis.get('y')
      return { status: 'complete', scanId: 'scan', availableAt: '2026-09-22T13:34:00.000Z', records, metrics: { acceptedCount: 2 } }
    })
    const commitScan = vi.fn(async () => ({ manifest: { manifestId: 'manifest' } }))
    const redis = { get: vi.fn(async () => null) }
    const runStage = vi.fn(async ({ execute, publish }) => {
      const outcome = await execute({ checkpoint: null })
      expect(outcome.metrics).toMatchObject({ acceptedCount: 2, r2Bytes: 2000, redisCommandCount: 2 })
      await publish(outcome, { lockKey: 'lease-key', lockToken: 'lease-token' })
      return { status: 'complete', stage: 'opening', tradingDate: '2026-09-22', attempt: 1, auditRecordId: 'audit-reference' }
    })
    const handler = createOptionsScanHandler({ getRedis: () => redis, makeArchive: () => ({ archive: true }), runStage, enabled: () => true, runOpeningStage, commitScan })
    const res = response()
    await handler(request({ query: { mode: 'opening' } }), res)
    expect(res.statusCode).toBe(200)
    expect(redis.get).toHaveBeenCalledTimes(2) // the real client actually received the calls, unchanged
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

  describe('forward outcome capture (mode=observe)', () => {
    const redis = { redis: true }
    const observeHandler = (runObserveTick, extra = {}) => createOptionsScanHandler({
      getRedis: () => redis, makeArchive: () => ({ archive: true }), runStage: vi.fn(), makeAdapter: () => ({ adapter: true }),
      runObserveTick, ...extra,
    })

    it('runs the capture tick outside the once-a-day stage runner, with redis, archive and the Alpaca adapter', async () => {
      const runObserveTick = vi.fn(async () => ({ status: 'captured', tradingDate: '2026-09-22', instants: ['2026-09-22T20:00:00.000Z'], recordIds: ['a'.repeat(64)], failed: [] }))
      const runStage = vi.fn()
      const res = response()
      await observeHandler(runObserveTick, { runStage, captureEnabled: () => true })(request({ query: { mode: 'observe' } }), res)
      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({ status: 'captured', stage: 'observe', tradingDate: '2026-09-22', instants: 1, failed: 0 })
      expect(runStage).not.toHaveBeenCalled()
      expect(runObserveTick).toHaveBeenCalledWith(expect.objectContaining({ redis, archive: { archive: true }, adapter: { adapter: true }, enabled: true }))
    })

    it('does not build the provider adapter when capture is disabled', async () => {
      const makeAdapter = vi.fn(() => { throw new Error('credentials required') })
      const runObserveTick = vi.fn(async ({ enabled }) => ({ status: enabled ? 'captured' : 'disabled' }))
      const res = response()
      await observeHandler(runObserveTick, { captureEnabled: () => false, makeAdapter })(request({ query: { mode: 'observe' } }), res)
      expect(res.statusCode).toBe(200)
      expect(res.body.status).toBe('disabled')
      expect(makeAdapter).not.toHaveBeenCalled()
    })

    it('reports a partial capture as 503 so the scheduler surfaces it, without provider detail', async () => {
      const runObserveTick = vi.fn(async () => ({ status: 'partial', tradingDate: '2026-09-22', instants: ['x'], failed: [{ jobId: 'j', reason: 'daily_request_budget_exhausted' }] }))
      const res = response()
      await observeHandler(runObserveTick, { captureEnabled: () => true })(request({ query: { mode: 'observe' } }), res)
      expect(res.statusCode).toBe(503)
      expect(res.body).toEqual({ status: 'partial', stage: 'observe', tradingDate: '2026-09-22', instants: 1, failed: 1 })
    })

    it('fails closed and sanitized when capture throws', async () => {
      const runObserveTick = vi.fn(async () => { throw new Error('Redis quota secret') })
      const res = response()
      await observeHandler(runObserveTick, { captureEnabled: () => true })(request({ query: { mode: 'observe' } }), res)
      expect(res.statusCode).toBe(503)
      expect(res.body).toMatchObject({ error: 'Options outcome capture is unavailable.', category: 'capture_failed' })
      expect(JSON.stringify(res.body)).not.toContain('secret')
    })

    it('defaults capture to the scanner flag unless OPTIONS_FORWARD_CAPTURE_ENABLED is set explicitly', async () => {
      const runObserveTick = vi.fn(async ({ enabled }) => ({ status: enabled ? 'idle' : 'disabled' }))
      const run = async () => { const res = response(); await observeHandler(runObserveTick)(request({ query: { mode: 'observe' } }), res); return res.body.status }
      vi.stubEnv('OPTIONS_SCANNER_ENABLED', 'true')
      vi.stubEnv('OPTIONS_FORWARD_CAPTURE_ENABLED', '')
      expect(await run()).toBe('idle')
      vi.stubEnv('OPTIONS_SCANNER_ENABLED', 'false')
      vi.stubEnv('OPTIONS_FORWARD_CAPTURE_ENABLED', 'true')
      expect(await run()).toBe('idle')
      vi.stubEnv('OPTIONS_SCANNER_ENABLED', 'true')
      vi.stubEnv('OPTIONS_FORWARD_CAPTURE_ENABLED', 'false')
      expect(await run()).toBe('disabled')
      vi.unstubAllEnvs()
    })
  })
})
