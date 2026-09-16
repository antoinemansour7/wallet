// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ verify: vi.fn(), redis: vi.fn(), runLog: vi.fn(), lrange: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{ name: 'research-evaluation' }], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify }) }))
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: mocks.redis } }))
vi.mock('../runLog.js', () => ({ withRunLog: (_name, handler) => (...args) => { mocks.runLog(); return handler(...args) } }))
vi.mock('./evaluationJob.js', () => ({ evaluationJobsByRunId: vi.fn() }))
import handler from '../../../api/get-research.js'
import { evaluationJobsByRunId } from './evaluationJob.js'

const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() })
const request = (query = {}) => ({ method: 'GET', headers: { authorization: 'Bearer signed-token' }, query: { runs: '1', ...query } })
const body = (res) => res.json.mock.calls[0][0]

const run = (overrides = {}) => JSON.stringify({
  runId: 'run-1', job: 'nightly-research', status: 'success',
  startedAt: '2026-09-10T07:00:00.000Z', finishedAt: '2026-09-10T07:02:14.000Z', durationMs: 134000,
  stages: [{ stage: 'x_discovery', status: 'success', durationMs: 900, metrics: { signals: 24 } }],
  candidates: [{ ticker: 'RKLB', outcome: 'published', reviewed: true, rank: 2 }],
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T12:00:00.000Z'))
  vi.stubEnv('RESEARCH_EVALUATION_OWNER', 'owner-uid')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fixture.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test')
  mocks.verify.mockResolvedValue({ uid: 'owner-uid' })
  mocks.lrange.mockResolvedValue([run()])
  mocks.redis.mockReturnValue({ lrange: mocks.lrange })
  vi.mocked(evaluationJobsByRunId).mockResolvedValue(new Map())
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('private research run log', () => {
  it('returns recent runs with their stages to the owner', async () => {
    const res = response(); await handler(request(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(body(res).runs[0]).toMatchObject({
      runId: 'run-1', job: 'nightly-research', status: 'success', durationMs: 134000,
      stages: [{ stage: 'x_discovery', status: 'success' }],
    })
    expect(body(res).scheduleHealth).toMatchObject({ checkedAt: '2026-09-10T12:00:00.000Z', graceMinutes: 90 })
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
  })

  it('reports a missing nightly slot after the delivery grace period', async () => {
    mocks.lrange.mockResolvedValue([
      run({ runId: 'old-nightly', startedAt: '2026-09-10T02:30:00.000Z' }),
      run({ runId: 'performance', job: 'track-performance', startedAt: '2026-09-10T09:42:00.000Z' }),
      run({ runId: 'foundation', job: 'research-foundation', startedAt: '2026-09-10T10:45:00.000Z' }),
    ])
    const res = response(); await handler(request({ hours: '720' }), res)

    expect(body(res).scheduleHealth.missing).toContainEqual(expect.objectContaining({
      job: 'nightly-research', expectedAt: '2026-09-10T07:00:00.000Z', lastRunAt: '2026-09-10T02:30:00.000Z',
    }))
  })

  it('reads beyond the default 30-run limit for windowed ticker search without changing records', async () => {
    const history = Array.from({ length: 42 }, (_, i) => run({
      runId: `run-${i}`, startedAt: new Date(Date.now() - i * 12 * 3600000).toISOString(),
      candidates: [{ ticker: i === 41 ? 'LATE' : 'RKLB', reason: 'review_budget_exhausted', priority: i }],
    }))
    mocks.lrange.mockResolvedValue(history)
    const res = response(); await handler(request({ hours: '720', ticker: 'late' }), res)
    expect(mocks.lrange).toHaveBeenCalledWith('research:runs:v1', 0, -1)
    expect(body(res).runs).toHaveLength(42)
    expect(body(res).traces).toEqual([expect.objectContaining({ runId: 'run-41', ticker: 'LATE', reason: 'review_budget_exhausted', priority: 41 })])
    expect(body(res).runs[41]).toMatchObject(JSON.parse(history[41]))
  })

  it.each([12, 24, 72, 168, 720])('limits a %s-hour window including its boundary', async (hours) => {
    mocks.lrange.mockResolvedValue([
      run({ runId: 'boundary', startedAt: new Date(Date.now() - hours * 3600000).toISOString() }),
      run({ runId: 'older', startedAt: new Date(Date.now() - hours * 3600000 - 1).toISOString() }),
      run({ runId: 'future', startedAt: new Date(Date.now() + 1).toISOString() }),
      run({ runId: 'invalid', startedAt: 'invalid' }), 'not json',
    ])
    const res = response(); await handler(request({ hours: String(hours) }), res)
    expect(body(res).runs.map((r) => r.runId)).toEqual(['boundary'])
  })

  it('checks schedule health against retained history outside a narrow display window', async () => {
    mocks.lrange.mockResolvedValue([
      run({ runId: 'recent', job: 'research-foundation', startedAt: new Date(Date.now() - 60 * 60000).toISOString() }),
      run({ runId: 'nightly', startedAt: '2026-09-10T07:40:00.000Z' }),
      run({ runId: 'prior-evaluation', job: 'research-evaluation', startedAt: '2026-09-09T11:45:00.000Z' }),
    ])
    const res = response(); await handler(request({ hours: '12' }), res)

    expect(body(res).runs.map((item) => item.runId)).toEqual(['recent', 'nightly'])
    expect(body(res).scheduleHealth.missing.map((item) => item.job)).not.toContain('research-evaluation')
  })

  it.each(['', '0', '-1', '721', 'Infinity', 'invalid'])('rejects an invalid window: %s', async (hours) => {
    const res = response(); await handler(request({ hours }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mocks.lrange).not.toHaveBeenCalled()
  })

  it('preserves the default query limit', async () => {
    const res = response(); await handler(request(), res)
    expect(mocks.lrange).toHaveBeenCalledWith('research:runs:v1', 0, 29)
  })

  it('requires owner authorization for the extended history query too', async () => {
    mocks.verify.mockResolvedValue({ uid: 'someone-else' })
    const res = response(); await handler(request({ hours: '720', ticker: 'RKLB' }), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(mocks.lrange).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 'Bearer cron-secret'])('denies unverified credentials: %s', async (authorization) => {
    mocks.verify.mockRejectedValue(new Error('Invalid token'))
    const res = response(); await handler({ ...request(), headers: { authorization } }, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(mocks.lrange).not.toHaveBeenCalled()
  })

  it('denies another signed-in user rather than exposing internal research data', async () => {
    mocks.verify.mockResolvedValue({ uid: 'someone-else' })
    const res = response(); await handler(request(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(mocks.lrange).not.toHaveBeenCalled()
  })

  it('fails closed when no owner is configured', async () => {
    vi.stubEnv('RESEARCH_EVALUATION_OWNER', '')
    const res = response(); await handler(request(), res)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(mocks.lrange).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('does not permit %s mutations', async (method) => {
    const res = response(); await handler({ ...request(), method }, res)

    expect(res.status).toHaveBeenCalledWith(405)
    expect(mocks.lrange).not.toHaveBeenCalled()
  })

  it('traces one ticker across runs, and says which run it came from', async () => {
    mocks.lrange.mockResolvedValue([
      run({ runId: 'run-2', candidates: [{ ticker: 'LATE', outcome: 'not_reviewed', reason: 'review_budget_exhausted' }] }),
      run(),
    ])

    const res = response(); await handler(request({ ticker: 'rklb' }), res)

    expect(body(res).traces).toEqual([
      expect.objectContaining({ runId: 'run-1', ticker: 'RKLB', outcome: 'published', rank: 2 }),
    ])
  })

  it('survives a corrupt entry rather than failing the whole history', async () => {
    mocks.lrange.mockResolvedValue(['not json', run()])

    const res = response(); await handler(request(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(body(res).runs).toHaveLength(1)
  })

  it('attaches the evaluation handoff status to each nightly-research run', async () => {
    const map = new Map([['run-1', { jobId: 'job-1', status: 'pending', frozenAt: '2026-09-10T07:02:00.000Z', error: null, retryState: null }]])
    vi.mocked(evaluationJobsByRunId).mockResolvedValue(map)

    const res = response(); await handler(request(), res)
    expect(body(res).runs[0]).toMatchObject({ runId: 'run-1', evaluation: { jobId: 'job-1', status: 'pending' } })
  })

  it('reports no evaluation handoff for a run the packet freeze never reached', async () => {
    const res = response(); await handler(request(), res) // beforeEach already stubs an empty map
    expect(body(res).runs[0].evaluation).toBeNull()
  })
})
