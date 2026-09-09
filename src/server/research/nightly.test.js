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
  const archive = { put: vi.fn(async (_kind, _id, payload) => { publications.push(structuredClone(payload)); return payload }) }
  const master = { resolve: ({ ticker }) => [{ ticker, securityId: `figi:${ticker}` }] }
  return { values, publications, redis, archive, master, load: vi.fn(), extract: vi.fn(), reports: vi.fn(), record: vi.fn(), quotes: vi.fn() }
})
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: () => mocks.redis } }))
vi.mock('./foundation.js', () => ({ loadFoundation: mocks.load }))
vi.mock('../runLog.js', () => ({ recordRun: mocks.record }))
vi.mock('../xSignals.js', () => ({ collectXSignals: async () => ({ signals: [], queries: [], stats: { provider: 'fixture' } }), deriveAdaptiveSeed: () => ({}) }))
vi.mock('../researchEngine.js', () => ({ fetchAllYahooNews: async () => [], extractTickers: mocks.extract, finalizePicks: (picks) => picks, generateResearchReports: mocks.reports }))
vi.mock('../technicalScreener.js', () => ({ fetchBreakoutCandidates: async () => [], candidatesToSignals: () => [] }))
vi.mock('../agents/contrarianAgent.js', () => ({ runContrarianAgent: async (picks) => picks }))
vi.mock('../agents/catalystAgent.js', () => ({ runCatalystAgent: async (picks) => picks }))
vi.mock('../agents/exaDiscoveryAgent.js', () => ({ runExaDiscovery: async () => [] }))
vi.mock('../agents/slackAgent.js', () => ({ sendPickAlerts: vi.fn() }))
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
  mocks.reports.mockImplementation(async (picks) => picks.map((p) => ({ ...p, report: 'Supplement' })))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('nightly foundation integration', () => {
  it('publishes and archives primary-only picks before awaiting reports', async () => {
    mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary({ 20: [pick('QUIET', 20)], 60: [pick('SLOW', 60)] })); return [] })
    let finish
    mocks.reports.mockImplementation((picks) => new Promise((resolve) => { finish = () => resolve(picks.map((p) => ({ ...p, report: 'Done' }))) }))
    const res = response(), running = handler(request(), res)
    await vi.waitFor(() => expect(mocks.reports).toHaveBeenCalledOnce())
    const partial = mocks.values.get('research:latest')
    expect(partial.picks).toEqual([])
    expect(partial.picksByHorizon[20][0]).toMatchObject({ ticker: 'QUIET', signalCount: 0, regimeScore: 6 })
    expect(partial.reportsPending).toBe(true)
    expect(mocks.publications).toHaveLength(1)
    expect(mocks.redis.lpush).toHaveBeenCalledWith('research:history-index', '2026-09-09')
    finish(); await running
    expect(mocks.values.get('research:latest').picksByHorizon[20][0].report).toBe('Done')
    expect(mocks.values.get('research:latest').publicationId).toBe(partial.publicationId)
    expect(mocks.publications[0].picksByHorizon[20][0].report).toBeUndefined()
    expect(mocks.publications).toHaveLength(1)
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('carries winners whole, removes vetoes, and reports only new winners', async () => {
    mocks.values.set('research:latest', { generatedAt: '2026-09-09T10:00:00Z', picks: [pick('BAD')], picksByHorizon: { 20: [{ ...pick('KEPT', 20, 95), report: 'Original' }] } })
    mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary({ 20: [pick('KEPT', 20, 50)], 60: [pick('NEW', 60)] }, { vetoes: ['figi:BAD'] })); return [] })
    await handler(request(), response())
    const payload = mocks.values.get('research:latest')
    expect(payload.picks).toEqual([])
    expect(payload.picksByHorizon[20][0]).toMatchObject({ report: 'Original', finalScore: 95, generatedAt: '2026-09-09T10:00:00Z' })
    expect(mocks.reports.mock.calls[0][0].map((p) => p.ticker)).toEqual(['NEW'])
  })

  it('retries history indexing after a partial write failure and retains picks on report failure', async () => {
    mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary()); return [pick('FAST')] })
    mocks.redis.lpush.mockRejectedValueOnce(new Error('index unavailable'))
    mocks.reports.mockRejectedValueOnce(new Error('report unavailable'))
    await handler(request(), response())
    expect(mocks.redis.lpush).toHaveBeenCalledTimes(2)
    expect(mocks.values.get('research:latest')).toMatchObject({ picks: [{ ticker: 'FAST' }], reportsPending: false })
    expect(mocks.values.get('research:latest').errors.map((e) => e.step)).toEqual(expect.arrayContaining(['store-partial', 'reports']))
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
