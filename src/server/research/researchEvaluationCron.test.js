// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluationTestStore } from './evaluationTestStore.js'
import { createArchive } from './archive.js'
import { freezeEvaluationJob, latestEvaluationJob, pendingEvaluationJobs } from './evaluationJob.js'

const mocks = vi.hoisted(() => ({ store: null, load: vi.fn(), prepareEvaluation: vi.fn(), freezeEvaluation: vi.fn() }))
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: () => mocks.store } }))
vi.mock('./foundation.js', () => ({ loadFoundation: mocks.load }))
vi.mock('./evaluation.js', () => ({ prepareEvaluation: mocks.prepareEvaluation, freezeEvaluation: mocks.freezeEvaluation }))
import handler from '../../../api/research-evaluation.js'

function fakeRedis() {
  const store = evaluationTestStore()
  return { ...store, async eval(_script, [key], [token]) { if (store.values.get(key) === token) store.values.delete(key) },
    async lpush() {}, async ltrim() {} }
}

const at = '2026-09-10T07:02:00.000Z'
const evaluationInputs = () => ({ admission: { candidates: [] }, baselineBoard: [], baselineSignals: [], signals: [], articles: [],
  quotesByTicker: new Map(), sectorTrends: new Map(), coverageHistory: new Map(), technicals: new Map(),
  performanceStats: null, performanceBlock: null, discoveryHealthy: true })
const request = () => ({ method: 'POST', headers: { authorization: 'Bearer test' }, query: {} })
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() })

async function seedPendingJob(archive, overrides = {}) {
  const job = await freezeEvaluationJob(archive, {
    runId: 'nightly-run-1', publicationId: 'pub-1', decisionAt: at, evaluationInputs: evaluationInputs(), ...overrides,
  })
  await archive.put('publication', job.publicationId, { publicationId: job.publicationId, generatedAt: job.decisionAt, picksByHorizon: {} }, 'publications', job.decisionAt)
  return job
}

const sixArms = () => ['frozen-existing', 'fundamentals-only', 'combined', 'no-attention', 'no-quiet', 'constrained']
  .flatMap((arm) => [{ arm, status: 'accepted' }, { arm, status: 'rejected' }])

beforeEach(() => {
  vi.clearAllMocks()
  mocks.store = fakeRedis()
  vi.stubEnv('CRON_SECRET', 'test'); vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fixture.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test')
  mocks.load.mockResolvedValue({ master: { resolve: () => [] } })
  mocks.prepareEvaluation.mockResolvedValue({ id: 'snapshot-1' })
  mocks.freezeEvaluation.mockResolvedValue({ id: 'evaluation-run-1', observations: sixArms() })
})
afterEach(() => vi.unstubAllEnvs())

describe('research-evaluation cron', () => {
  it('retries a partial review instead of publishing failed-review rejections as success', async () => {
    const archive = createArchive(mocks.store)
    await seedPendingJob(archive)
    mocks.prepareEvaluation.mockResolvedValueOnce({ id: 'partial', failures: ['OpenAI temporarily unavailable', null] })
    await handler(request(), response())
    expect(mocks.freezeEvaluation).not.toHaveBeenCalled()
    expect(await latestEvaluationJob(archive)).toMatchObject({ status: 'failed', retryState: 'pending' })
    await handler(request(), response())
    expect(await latestEvaluationJob(archive)).toMatchObject({ status: 'completed', attempt: 2 })
  })

  it('resumes a persisted result after an interrupted delivery without another model review', async () => {
    const archive = createArchive(mocks.store)
    const job = await seedPendingJob(archive)
    await archive.put('evaluation-run', 'persisted', { id: 'persisted', observations: [] }, `evaluation-job-runs:${job.id}`)
    await handler(request(), response())
    expect(mocks.prepareEvaluation).not.toHaveBeenCalled()
    expect(await latestEvaluationJob(archive)).toMatchObject({ status: 'completed', resultRunId: 'persisted' })
  })
  it('processes a pending job end-to-end and marks it completed', async () => {
    const archive = createArchive(mocks.store)
    await seedPendingJob(archive)

    const res = response()
    await handler(request(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ processed: 1, results: [{ jobId: expect.any(String), status: 'completed', runId: 'evaluation-run-1' }] })
    expect(mocks.prepareEvaluation).toHaveBeenCalledOnce()
    expect(await pendingEvaluationJobs(archive, Date.now())).toEqual([])
    const latest = await latestEvaluationJob(archive, Date.now())
    expect(latest).toMatchObject({ status: 'completed', resultRunId: 'evaluation-run-1' })
    expect(await archive.get('evaluation-delivery', 'evaluation-run-1')).toMatchObject({ runId: 'evaluation-run-1' })
  })

  it('does not reprocess an already-completed job on a retried invocation', async () => {
    const archive = createArchive(mocks.store)
    await seedPendingJob(archive)
    await handler(request(), response())
    const res = response()
    await handler(request(), res)

    expect(res.json).toHaveBeenCalledWith({ processed: 0, results: [] })
    expect(mocks.prepareEvaluation).toHaveBeenCalledOnce() // not called a second time
  })

  it('marks a job failed without creating an observation record, and succeeds on retry', async () => {
    const archive = createArchive(mocks.store)
    await seedPendingJob(archive)
    mocks.prepareEvaluation.mockRejectedValueOnce(new Error('anthropic unavailable'))

    const first = response()
    await handler(request(), first)
    expect(first.json).toHaveBeenCalledWith({ processed: 1, results: [{ jobId: expect.any(String), status: 'failed', error: 'anthropic unavailable' }] })
    expect(mocks.freezeEvaluation).not.toHaveBeenCalled()

    const second = response()
    await handler(request(), second)
    expect(second.json).toHaveBeenCalledWith({ processed: 1, results: [{ jobId: expect.any(String), status: 'completed', runId: 'evaluation-run-1' }] })
  })

  it('gives up automatic retries after the attempt limit and reports the job as retryable', async () => {
    const archive = createArchive(mocks.store)
    await seedPendingJob(archive)
    mocks.prepareEvaluation.mockRejectedValue(new Error('anthropic unavailable'))

    for (let attempt = 1; attempt <= 3; attempt++) await handler(request(), response())
    const exhausted = response()
    await handler(request(), exhausted)
    expect(exhausted.json).toHaveBeenCalledWith({ processed: 0, results: [] })

    const latest = await latestEvaluationJob(archive, Date.now())
    expect(latest).toMatchObject({ status: 'failed', attempt: 3, retryState: 'retryable' })
  })

  it('defers a claimed job to preserve its own time budget instead of failing it', async () => {
    const archive = createArchive(mocks.store)
    await seedPendingJob(archive)
    vi.stubEnv('RESEARCH_CRON_MAX_DURATION_MS', '1000') // budget exhausted before any job can start

    const res = response()
    await handler(request(), res)
    expect(res.json).toHaveBeenCalledWith({ processed: 1, results: [{ jobId: expect.any(String), status: 'deferred' }] })
    expect(mocks.prepareEvaluation).not.toHaveBeenCalled()

    vi.unstubAllEnvs(); vi.stubEnv('CRON_SECRET', 'test'); vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fixture.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test')
    const retried = response()
    await handler(request(), retried)
    expect(retried.json).toHaveBeenCalledWith({ processed: 1, results: [{ jobId: expect.any(String), status: 'completed', runId: 'evaluation-run-1' }] })
  })

  it('refuses to run concurrently with another invocation', async () => {
    mocks.store.values.set('research:evaluation:lock:v1', 'other-run')
    const res = response()
    await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(mocks.prepareEvaluation).not.toHaveBeenCalled()
  })

  it('rejects unauthorized requests and reports missing Redis configuration', async () => {
    const unauthorized = response()
    await handler({ ...request(), headers: {} }, unauthorized)
    expect(unauthorized.status).toHaveBeenCalledWith(401)

    vi.unstubAllEnvs()
    const misconfigured = response()
    await handler(request(), misconfigured)
    expect(misconfigured.status).toHaveBeenCalledWith(401) // CRON_SECRET unset now denies before Redis is even checked
  })
})
