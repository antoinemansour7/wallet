// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const values = new Map(), publications = []
  const redis = {
    get: vi.fn(async (key) => structuredClone(values.get(key))),
    set: vi.fn(async (key, value, options = {}) => {
      if (options.nx && values.has(key)) return null
      values.set(key, structuredClone(value)); return 'OK'
    }),
    eval: vi.fn(async (_script, [key], [token]) => { if (values.get(key) === token) values.delete(key) }),
    lrem: vi.fn(async () => {}), lpush: vi.fn(async () => {}), ltrim: vi.fn(async () => {}),
  }
  const archive = { put: vi.fn(async (kind, _id, payload) => { if (kind === 'publication') publications.push(structuredClone(payload)); return payload }) }
  const master = { resolve: ({ ticker }) => [{ ticker, securityId: `figi:${ticker}` }] }
  return { values, publications, redis, archive, master, load: vi.fn(), extract: vi.fn(), reports: vi.fn(), record: vi.fn(), quotes: vi.fn(),
    yahoo: vi.fn(), freezeEvaluationJob: vi.fn() }
})
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: () => mocks.redis } }))
vi.mock('./evaluationJob.js', () => ({ freezeEvaluationJob: mocks.freezeEvaluationJob }))
vi.mock('./foundation.js', () => ({ loadFoundation: mocks.load }))
vi.mock('../runLog.js', () => ({ recordRun: mocks.record }))
vi.mock('../xSignals.js', () => ({ collectXSignals: async () => ({ signals: [], queries: [], stats: { provider: 'fixture' } }), deriveAdaptiveSeed: () => ({}) }))
vi.mock('../researchEngine.js', () => ({ fetchAllYahooNews: mocks.yahoo, extractTickers: (...args) => { args[2].onEvaluationInputs({}); return mocks.extract(...args) }, finalizePicks: (picks) => picks, generateResearchReports: mocks.reports }))
vi.mock('../technicalScreener.js', () => ({ fetchBreakoutCandidates: async () => [], candidatesToSignals: () => [] }))
vi.mock('../agents/contrarianAgent.js', () => ({ runContrarianAgent: async (picks) => picks }))
vi.mock('../agents/catalystAgent.js', () => ({ runCatalystAgent: async (picks) => picks }))
vi.mock('../agents/exaDiscoveryAgent.js', () => ({ runExaDiscovery: async () => [] }))
vi.mock('../dayTradeSignals.js', () => ({ collectDayTradeSignals: async () => [] }))
vi.mock('../marketRegime.js', () => ({ getMarketRegime: async () => ({ score: 6, label: 'Mixed' }), regimeSizeMultiplier: () => 0.75 }))
vi.mock('../marketQuotes.js', () => ({ fetchMarketQuotes: mocks.quotes }))
import handler from '../../../api/nightly-research.js'

const pick = (ticker, horizon = 5, score = 70) => ({ ticker, securityId: `figi:${ticker}`, candidateId: `${ticker}-${horizon}`, horizon, price: 100, finalScore: score, signalCount: 0, earliestActionAt: '2026-09-09T08:01:00Z' })
const primary = (picksByHorizon = { 20: [], 60: [] }, extra = {}) => ({ id: 'review', admission: { id: 'admission', audit: { rejected: [] } }, picksByHorizon, ...extra })
const request = (query = {}) => ({ method: 'POST', headers: { authorization: 'Bearer test' }, query })
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() })

beforeEach(() => {
  vi.clearAllMocks(); mocks.values.clear(); mocks.publications.length = 0
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))
  vi.stubEnv('CRON_SECRET', 'test'); vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fixture.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test')
  mocks.load.mockResolvedValue({ redis: mocks.redis, archive: mocks.archive, master: mocks.master })
  mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary()); return [] })
  mocks.yahoo.mockResolvedValue([])
  mocks.freezeEvaluationJob.mockResolvedValue({ id: 'job-1' })
  mocks.reports.mockImplementation(async (picks) => picks.map((p) => ({ ...p, report: 'Supplement' })))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('nightly foundation integration', () => {
  it('publishes and archives picks with reports pending, and leaves reports to the separate report job', async () => {
    mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary({ 20: [pick('QUIET', 20)], 60: [pick('SLOW', 60)] })); return [] })
    mocks.reports.mockImplementation(async (picks) => picks.map((p) => ({ ...p, report: 'Done' })))
    const res = response()
    await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.reports).not.toHaveBeenCalled()
    const published = mocks.values.get('research:latest')
    expect(published.picks).toEqual([])
    expect(published.picksByHorizon[20][0]).toMatchObject({ ticker: 'QUIET', signalCount: 0, regimeScore: 6 })
    expect(published.reportsPending).toBe(true)
    expect(mocks.publications).toHaveLength(1)
    expect(mocks.redis.lpush).toHaveBeenCalledWith('research:history-index', '2026-09-09')

    vi.setSystemTime(new Date('2026-09-09T14:05:00Z'))
    const reports = response()
    await handler(request({ mode: 'reports' }), reports)
    expect(reports.status).toHaveBeenCalledWith(200)
    expect(reports.json).toHaveBeenCalledWith(expect.objectContaining({ mode: 'reports', status: 'complete', candidates: 2, written: 2 }))
    const completed = mocks.values.get('research:latest')
    expect(completed.picksByHorizon[20][0].report).toBe('Done')
    expect(completed.picksByHorizon[60][0].report).toBe('Done')
    expect(completed.reportsPending).toBe(false)
    expect(completed.publicationId).toBe(published.publicationId)
    expect(mocks.publications[0].picksByHorizon[20][0].report).toBeUndefined()
    expect(mocks.publications).toHaveLength(1)
  })

  it('runs the report job for the request its QStash schedule sends', async () => {
    const { RESEARCH_SCHEDULES } = await import('./scheduleHealth.js')
    const scheduled = new URL(RESEARCH_SCHEDULES.find((entry) => entry.job === 'research-reports').path, 'https://wallai.test')
    mocks.values.set('research:latest', { generatedAt: '2026-09-09T11:30:00.000Z', picks: [], picksByHorizon: { 5: [], 20: [{ ...pick('QUIET', 20), generatedAt: '2026-09-09T11:30:00.000Z' }], 60: [] }, reportsPending: true })
    const res = response()
    expect(scheduled.pathname).toBe('/api/nightly-research')
    await handler({ method: 'GET', headers: { authorization: 'Bearer test' }, query: Object.fromEntries(scheduled.searchParams) }, res)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mode: 'reports', written: 1 }))
    expect(mocks.extract).not.toHaveBeenCalled()
    const [, line] = mocks.redis.lpush.mock.calls.find(([key]) => key === 'research:runs:v1')
    expect(JSON.parse(line)).toMatchObject({ job: 'research-reports', status: 'success',
      stages: [expect.objectContaining({ stage: 'report_generation', metrics: expect.objectContaining({ outcome: 'complete', reports: 1, candidates: 1 }) })] })
    expect(mocks.record).toHaveBeenCalledWith('research-reports', expect.any(Number), { errors: [] })
  })

  it('schedules the report job two hours after the nightly run, so the nightly lock is long released', async () => {
    const { RESEARCH_SCHEDULES } = await import('./scheduleHealth.js')
    const hours = (job) => RESEARCH_SCHEDULES.find((entry) => entry.job === job).hours
    expect(hours('nightly-research')).toEqual([7])
    expect(hours('research-reports')).toEqual([9])
  })

  it('does not run the report job while a nightly run holds the publication lock', async () => {
    mocks.values.set('research:publication:lock:v1', 'nightly-token')
    const res = response()
    await handler(request({ mode: 'reports' }), res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(mocks.reports).not.toHaveBeenCalled()
  })

  it('ends the nightly run at the durable evaluation handoff, with no report stage', async () => {
    mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary()); return [pick('FAST')] })

    await handler(request(), response())

    const [, line] = mocks.redis.lpush.mock.calls.find(([key]) => key === 'research:runs:v1')
    const stages = JSON.parse(line).stages.map((entry) => entry.stage)
      .filter((stage) => ['publication', 'persistence', 'evaluation_input_freeze', 'report_generation'].includes(stage))
    expect(stages).toEqual(['publication', 'persistence', 'evaluation_input_freeze'])
    expect(mocks.reports).not.toHaveBeenCalled()
    expect(mocks.freezeEvaluationJob).toHaveBeenCalledWith(mocks.archive, {
      runId: expect.any(String),
      publicationId: mocks.values.get('research:latest').publicationId,
      decisionAt: '2026-09-09T12:00:00.000Z',
      evaluationInputs: { discoveryHealthy: false },
    })
  })

  it('carries winners whole, removes vetoes, and reports only new winners', async () => {
    mocks.values.set('research:latest', { generatedAt: '2026-09-09T10:00:00Z', picks: [pick('BAD')], picksByHorizon: { 20: [{ ...pick('KEPT', 20, 95), report: 'Original' }] } })
    mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary({ 20: [pick('KEPT', 20, 50)], 60: [pick('NEW', 60)] }, { vetoes: ['figi:BAD'] })); return [] })
    await handler(request(), response())
    const payload = mocks.values.get('research:latest')
    expect(payload.picks).toEqual([])
    expect(payload.picksByHorizon[20][0]).toMatchObject({ report: 'Original', finalScore: 95, generatedAt: '2026-09-09T10:00:00Z' })
    await handler(request({ mode: 'reports' }), response())
    expect(mocks.reports.mock.calls[0][0].map((p) => p.ticker)).toEqual(['NEW'])
    expect(mocks.values.get('research:latest').picksByHorizon[20][0].report).toBe('Original')
  })

  it('keeps the published picks when the report job fails, and says how many reports are missing', async () => {
    mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary()); return [pick('FAST')] })
    mocks.redis.lpush.mockRejectedValueOnce(new Error('index unavailable'))
    await handler(request(), response())
    expect(mocks.redis.lpush.mock.calls.filter(([key]) => key === 'research:history-index')).toHaveLength(2)
    expect(mocks.values.get('research:latest').errors.map((e) => e.step)).toEqual(expect.arrayContaining(['store-partial']))
    expect(mocks.freezeEvaluationJob).toHaveBeenCalledOnce()

    mocks.reports.mockRejectedValueOnce(new Error('report unavailable'))
    mocks.redis.lpush.mockClear()
    const res = response()
    await handler(request({ mode: 'reports' }), res)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'partial', written: 0, deferred: 1, stopped: 'generation_failed' }))
    expect(mocks.values.get('research:latest')).toMatchObject({ picks: [{ ticker: 'FAST' }], reportsPending: true })
    expect(mocks.record).toHaveBeenLastCalledWith('research-reports', expect.any(Number), { errors: [{ step: 'reports', error: '0/1 reports written (generation_failed)' }] })
    const [, line] = mocks.redis.lpush.mock.calls.find(([key]) => key === 'research:runs:v1')
    expect(JSON.parse(line).stages).toEqual([expect.objectContaining({ stage: 'report_generation', metrics: expect.objectContaining({ outcome: 'partial', deferred: 1 }) })])
  })

  it('synchronizes only the five-session premarket projection', async () => {
    const slow = pick('QUIET', 20)
    mocks.values.set('research:latest', { generatedAt: '2026-09-09T10:00:00Z', picks: [pick('FAST')], picksByHorizon: { 5: [pick('FAST')], 20: [slow], 60: [] } })
    mocks.quotes.mockResolvedValue({ quotes: [{ symbol: 'FAST', price: 110 }] })
    await handler(request({ mode: 'premarket' }), response())
    const payload = mocks.values.get('research:latest')
    expect(payload.picksByHorizon[5]).toEqual(payload.picks)
    expect(payload.picks[0].gappedAway).toBe(true)
    expect(payload.picksByHorizon[20]).toEqual([slow])
    expect(mocks.publications).toEqual([])
  })

  it('retains the previous briefing and logs a failed foundation bootstrap', async () => {
    mocks.values.set('research:latest', { picks: [pick('OLD')] })
    mocks.load.mockRejectedValueOnce(new Error('missing master'))
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(503)
    expect(mocks.values.get('research:latest').picks[0].ticker).toBe('OLD')
    expect(mocks.record).toHaveBeenCalled()
    expect(mocks.values.has('research:publication:lock:v1')).toBe(false)
  })

  it('still publishes the briefing when the evaluation packet cannot be frozen', async () => {
    mocks.freezeEvaluationJob.mockRejectedValue(new Error('archive unavailable'))
    mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary({ 20: [pick('QUIET', 20)] })); return [] })
    const res = response()
    await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.values.get('research:latest').picksByHorizon[20][0].ticker).toBe('QUIET')
    expect(mocks.freezeEvaluationJob).toHaveBeenCalledOnce()
    expect(res.json.mock.calls[0][0].errors).toContainEqual({ step: 'evaluation', error: 'archive unavailable' })
  })

  it('records a run summary naming the stages it ran, so an overnight run is legible by morning', async () => {
    const { RESEARCH_RUNS_KEY } = await import('./observability.js')
    await handler(request(), response())

    const [, line] = mocks.redis.lpush.mock.calls.find(([key]) => key === RESEARCH_RUNS_KEY)
    const summary = JSON.parse(line)
    expect(summary).toMatchObject({ job: 'nightly-research', status: 'success', runId: expect.any(String) })
    expect(summary.stages.map((s) => s.stage)).toEqual(expect.arrayContaining([
      'foundation_load', 'x_discovery', 'news_discovery', 'claude_review',
    ]))
  })

  it('publishes within five minutes by skipping optional work when the finishing reserve is reached', async () => {
    mocks.extract.mockImplementation(async (_s, _a, options) => {
      options.onPrimaryReview(primary())
      vi.setSystemTime(new Date('2026-09-09T12:03:50Z'))
      return [pick('FAST')]
    })

    const res = response()
    await handler(request(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.values.get('research:latest')).toMatchObject({
      picks: [{ ticker: 'FAST' }],
      reportsPending: true,
    })
    expect(mocks.reports).not.toHaveBeenCalled()
    const [, line] = mocks.redis.lpush.mock.calls.find(([key]) => key === 'research:runs:v1')
    const summary = JSON.parse(line)
    expect(summary.status).toBe('partial')
    expect(summary.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'contrarian_review', status: 'skipped' }),
      expect.objectContaining({ stage: 'catalyst_verification', status: 'skipped' }),
      expect.objectContaining({ stage: 'evaluation_input_freeze', status: 'success' }),
      expect.objectContaining({ stage: 'persistence', status: 'success' }),
    ]))
    expect(mocks.freezeEvaluationJob).toHaveBeenCalledOnce()
  })

  it('freezes the evaluation packet even with only ~30 seconds left — the exact Sep 10 production shortfall', async () => {
    mocks.extract.mockImplementation(async (_s, _a, options) => {
      options.onPrimaryReview(primary())
      vi.setSystemTime(new Date('2026-09-09T12:04:03Z')) // ~32s left before the 275s work deadline
      return [pick('FAST')]
    })
    await handler(request(), response())
    expect(mocks.freezeEvaluationJob).toHaveBeenCalledOnce()
    const [, line] = mocks.redis.lpush.mock.calls.find(([key]) => key === 'research:runs:v1')
    const summary = JSON.parse(line)
    expect(summary.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'evaluation_input_freeze', status: 'success' }),
    ]))
  })

  it('reports a degraded discovery leg as a partial run rather than a clean one', async () => {
    const { RESEARCH_RUNS_KEY } = await import('./observability.js')
    mocks.yahoo.mockRejectedValueOnce(new Error('yahoo unavailable'))

    await handler(request(), response())

    const [, line] = mocks.redis.lpush.mock.calls.find(([key]) => key === RESEARCH_RUNS_KEY)
    const summary = JSON.parse(line)
    expect(summary.status).toBe('partial')
    expect(summary.stages.find((s) => s.stage === 'news_discovery')).toMatchObject({
      status: 'failed', error: { message: 'yahoo unavailable' },
    })
  })

  it('traces why each candidate did or did not reach the board', async () => {
    const { RESEARCH_RUNS_KEY } = await import('./observability.js')
    mocks.extract.mockImplementation(async (_s, _a, options) => {
      options.onBoard([{ ticker: 'QUIET', securityId: 'figi:QUIET' }])
      options.onPrimaryReview(primary({ 20: [], 60: [] }, {
        admission: { id: 'admission', audit: {
          rejected: [{ securityId: 'figi:XYZ', ticker: 'XYZ', reason: 'unresolved_identity' }],
          notReviewed: [{ securityId: 'figi:LATE', ticker: 'LATE', reason: 'review_budget_exhausted' }],
        } },
      }))
      return [pick('FAST')]
    })

    await handler(request(), response())

    const [, line] = mocks.redis.lpush.mock.calls.find(([key]) => key === RESEARCH_RUNS_KEY)
    const byTicker = Object.fromEntries(JSON.parse(line).candidates.map((c) => [c.ticker, c]))
    expect(byTicker.FAST).toMatchObject({ outcome: 'published', reviewed: true, rank: 1 })
    expect(byTicker.XYZ).toMatchObject({ outcome: 'discovered', reason: 'unresolved_identity', reviewed: false, sentToClaude: false })
    expect(byTicker.LATE).toMatchObject({ outcome: 'not_reviewed', reason: 'review_budget_exhausted', reviewed: false })
    expect(byTicker.QUIET).toMatchObject({ outcome: 'reviewed_rejected', reviewed: true, sentToClaude: true })
  })

  it('does not allow overlapping publishers to overwrite a newer board', async () => {
    mocks.values.set('research:publication:lock:v1', 'other-run')
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(mocks.extract).not.toHaveBeenCalled()
    expect(mocks.values.get('research:publication:lock:v1')).toBe('other-run')
  })
})

// #107: forward observations only accumulate if the longer-horizon boards reach
// the tracker. track-performance reads published payloads through
// allResearchPicks, so a fundamentals pick that never appears there is measured
// at no horizon at all, declared or not.
describe('fundamentals picks reach the performance tracker', () => {
  it('publishes the 20-session board and surfaces it to allResearchPicks', async () => {
    const fundamentals = { ...pick('QUIET', 20), strategyFamily: 'fundamentals', horizons: [5, 20], experiment: { version: 'fundamentals-quiet-v1', quiet: true, attention: 0, repricingPercent: 1 } }
    mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary({ 20: [fundamentals], 60: [] })); return [] })

    await handler(request(), response())
    const published = mocks.publications.at(-1)
    expect(published.picksByHorizon[20].map((p) => p.ticker)).toEqual(['QUIET'])

    const { allResearchPicks } = await import('./review.js')
    const tracked = allResearchPicks(published)
    const quiet = tracked.find((p) => p.ticker === 'QUIET')
    expect(quiet).toBeDefined()
    // Both the declared set and the arm survive publication, which is what
    // track-performance forwards into the stored record.
    expect(quiet.horizons).toEqual([5, 20])
    expect(quiet.experiment.quiet).toBe(true)
  })

  it('keeps the attention board separate rather than duplicating the candidate into it', async () => {
    const fundamentals = { ...pick('QUIET', 20), strategyFamily: 'fundamentals', horizons: [5, 20] }
    mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary({ 20: [fundamentals], 60: [] })); return [] })

    await handler(request(), response())
    const published = mocks.publications.at(-1)
    // The same candidate is evaluated at 5 via its checkpoint, not by being
    // ranked on the attention board, which would double-count it.
    expect(published.picksByHorizon[5].some((p) => p.ticker === 'QUIET')).toBe(false)
  })
})
