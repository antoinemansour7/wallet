// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createArchive } from './archive.js'
import { evaluationTestStore } from './evaluationTestStore.js'
import { evaluateObservation, horizonSummary, latestOutcomes, portfolioSummary, trackEvaluation, evaluationReport } from './evaluationPerformance.js'
import { EVALUATION_ID, experimentDefinition } from './evaluationPolicy.js'

const at = '2026-09-04T22:00:00.000Z'
const observation = (id = 'stock', extra = {}) => ({ id, ticker: 'ABC', securityId: 'figi:ABC', issuerId: 'cik:ABC', currency: 'USD',
  decisionAt: at, earliestActionAt: at, horizons: [5, 20], costBps: 20, stressCostBps: [20, 50, 100], status: 'accepted',
  arm: 'combined', armVersion: 'combined-v1', cohort: 'shadow', period: 'development', runId: 'run', ...extra })
const bars = (count = 25) => {
  const output = []
  // Excludes the Labor Day holiday as well as weekends. The exchange calendar,
  // not a weekdays arithmetic approximation, determines the five-session date.
  for (let day = 8; output.length < count; day++) {
    const date = new Date(Date.UTC(2026, 8, day, 13, 30))
    if ([0, 6].includes(date.getUTCDay())) continue
    output.push({ timestamp: date.getTime(), date: date.toISOString().slice(0, 10), open: 100, close: 101 + output.length, currency: 'USD' })
  }
  return output
}
const market = bars(), now = market.at(-1).timestamp + 86400000
const evaluated = (o = observation(), inputs = {}) => evaluateObservation(o, { stock: market, benchmark: market, ...inputs }, now)

describe('predeclared session tracking', () => {
  it('tracks exactly 5 and 20 completed exchange sessions with next-open fills', () => {
    const results = evaluated()
    expect(results.map((r) => r.horizon)).toEqual([5, 20])
    expect(results[0]).toMatchObject({ status: 'completed', entryDate: '2026-09-08', exitDate: '2026-09-14', entryPrice: 100, exitPrice: 105 })
    expect(results[1].exitDate).toBe(market[19].date)
    expect(results[0].grossReturn).toBeCloseTo(5)
    expect(results[0].netReturn).toBeCloseTo(4.8)
    expect(results[0].excessReturn).toBeCloseTo(-0.2)
  })

  it('reports completed versus pending without borrowing future prices', () => {
    const results = evaluateObservation(observation(), { stock: market, benchmark: market }, market[4].timestamp + 7 * 3600000)
    expect(results[0].status).toBe('completed')
    expect(results[1]).toMatchObject({ status: 'pending', grossReturn: null, netReturn: null })
    expect(results[1].path).toHaveLength(5)
    const summary = horizonSummary([observation()], latestOutcomes(results), 20)
    expect(summary).toMatchObject({ completed: 0, pending: 1, meanReturn: null, medianReturn: null, wins: null, status: 'Insufficient data' })
  })

  it('respects an intraday decision and the declared execution latency', () => {
    const o = observation('stock', { decisionAt: market[0].date + 'T13:29:30Z', earliestActionAt: market[0].date + 'T13:30:30Z' })
    expect(evaluated(o)[0].entryDate).toBe(market[1].date)
  })

  it('never skips a missing stock candle to substitute a later exit', () => {
    const results = evaluated(observation(), { stock: market.filter((_, i) => i !== 3) })
    expect(results[0]).toMatchObject({ status: 'unavailable', reason: 'session_price_unavailable', exitDate: market[4].date, grossReturn: null })
    expect(results[1].grossReturn).toBeNull()
  })

  it('keeps missing benchmark, sector, price, identity and currency unknown', () => {
    expect(evaluated()[0].sectorExcessReturn).toBeNull()
    expect(evaluated(observation(), { benchmark: [] })[0]).toMatchObject({ status: 'unavailable', grossReturn: null })
    expect(evaluated(observation(), { stock: [] })[0]).toMatchObject({ status: 'unavailable', grossReturn: null })
    expect(evaluated(observation(), { identityAvailable: false })[0].reason).toBe('historical_security_identity_unavailable')
    expect(evaluated(observation('stock', { currency: null }))[0].netReturn).toBeNull()
    expect(evaluated(observation('stock', { costBps: null }))[0]).toMatchObject({ netReturn: null, excessReturn: null })
  })

  it('calculates sector excess and applies separately declared cost stresses', () => {
    const sector = market.map((b) => ({ ...b, close: 102 }))
    const r = evaluated(observation(), { sector })[0]
    expect(r.sectorExcessReturn).toBeCloseTo(2.8)
    expect(r.stressReturns[20]).toBeCloseTo(4.8)
    expect(r.stressReturns[50]).toBeCloseTo(4.5)
    expect(r.stressReturns[100]).toBeCloseTo(4)
    expect(evaluated(observation('stock', { costBps: 150 }))[0].stressReturns[20]).toBeCloseTo(3.5)
  })

  it('tracks shadow and rejected observations without writing ordinary research keys', async () => {
    const redis = evaluationTestStore(), archive = createArchive(redis)
    await archive.put('evaluation-run', 'run', { id: 'run', availableAt: at,
      observations: [observation(), observation('rejected', { status: 'rejected' })] }, 'evaluation-runs', at)
    const candlesFor = vi.fn(async () => market)
    const master = { resolve: () => [{ securityId: 'figi:ABC' }] }
    expect(await trackEvaluation(archive, { master, candlesFor, now })).toBe(4)
    const results = await archive.list('evaluation-outcomes', now)
    expect(results).toHaveLength(4)
    expect(redis.writes.every((key) => key.startsWith('research:archive:v1:evaluation-'))).toBe(true)
    expect(horizonSummary([observation(), observation('rejected', { status: 'rejected' })], latestOutcomes(results), 5).sampleSize).toBe(1)
    // A second cron, even with revised prices, cannot change completed outcomes.
    expect(await trackEvaluation(archive, { master, candlesFor: async () => market.map((b) => ({ ...b, close: 999 })), now: now + 86400000 })).toBe(0)
    expect(await archive.list('evaluation-outcomes', now + 86400000)).toEqual(results)
  })

  it('retains renamed/delisted securities as unavailable instead of fetching a reused ticker', async () => {
    const archive = createArchive(evaluationTestStore())
    await archive.put('evaluation-run', 'run', { id: 'run', availableAt: at, observations: [observation()] }, 'evaluation-runs', at)
    const candlesFor = vi.fn(async () => market)
    await trackEvaluation(archive, { master: { resolve: () => [{ securityId: 'figi:REUSED' }] }, candlesFor, now })
    expect(candlesFor.mock.calls.map(([ticker]) => ticker)).toEqual(['SPY'])
    expect((await archive.list('evaluation-outcomes', now))[0].reason).toBe('historical_security_identity_unavailable')
  })
})

describe('provider gaps and outcome growth', () => {
  const master = { resolve: () => [{ securityId: 'figi:ABC' }] }
  async function seeded(observations) {
    const redis = evaluationTestStore(), archive = createArchive(redis)
    await archive.put('evaluation-run', 'run', { id: 'run', availableAt: at, observations }, 'evaluation-runs', at)
    return { redis, archive }
  }

  it('scores a window across a gap-filled session and records which bars were filled', () => {
    const filled = market.map((b, i) => (i === 2 ? { ...b, source: 'alpaca-sip' } : b))
    const [five] = evaluateObservation(observation(), { stock: filled, benchmark: filled }, now)
    expect(five.status).toBe('completed')
    expect(five.path[2]).toMatchObject({ date: market[2].date, source: 'alpaca-sip' })
    expect(five.path[1]).not.toHaveProperty('source')
    expect(five.filledSessions).toEqual([{ date: market[2].date, series: 'stock', source: 'alpaca-sip' }, { date: market[2].date, series: 'benchmark', source: 'alpaca-sip' }])
    expect(evaluated()[0].filledSessions).toEqual([])
  })

  it('announces every ticker it will need, sector ETFs included, before fetching prices', async () => {
    const { archive } = await seeded([observation(), observation('b', { ticker: 'XYZ', securityId: 'figi:XYZ', sector: 'Technology' })])
    const prefetch = vi.fn(async () => {})
    const candlesFor = vi.fn(async () => market)
    await trackEvaluation(archive, { master: { resolve: ({ ticker }) => [{ securityId: `figi:${ticker}` }] }, candlesFor, prefetch, now })
    expect(prefetch).toHaveBeenCalledWith(['ABC', 'XYZ', 'XLK'])
    expect(prefetch.mock.invocationCallOrder[0]).toBeLessThan(candlesFor.mock.invocationCallOrder[1])
  })

  it('writes an unfinished outcome again only when something the report reads has changed', async () => {
    const early = market[7].timestamp + 7 * 3600000 // five-session horizon done, twenty pending
    const { archive } = await seeded([observation(), observation('rejected', { status: 'rejected' })])
    const candlesFor = async () => market
    expect(await trackEvaluation(archive, { master, candlesFor, now: early })).toBe(4)
    // Next day: the pending windows gained one session of path.
    expect(await trackEvaluation(archive, { master, candlesFor, now: early + 86400000 })).toBe(1)
    const outcomes = latestOutcomes(await archive.list('evaluation-outcomes', early + 86400000))
    expect(outcomes.get('stock:20').path).toHaveLength(9)
    expect(outcomes.get('rejected:20').path).toHaveLength(8)
    // Same prices again: nothing changed, nothing written.
    expect(await trackEvaluation(archive, { master, candlesFor, now: early + 86400000 + 3600000 })).toBe(0)
    expect(await archive.list('evaluation-outcomes', early + 2 * 86400000)).toHaveLength(5)
  })

  it('writes a status change for a rejected observation, and its final completed outcome', async () => {
    const { archive } = await seeded([observation('rejected', { status: 'rejected' })])
    const gap = market.filter((_, i) => i !== 3)
    const early = market[7].timestamp + 7 * 3600000
    await trackEvaluation(archive, { master, candlesFor: async (ticker) => (ticker === 'SPY' ? market : gap), now: early })
    expect(latestOutcomes(await archive.list('evaluation-outcomes', early)).get('rejected:5').reason).toBe('session_price_unavailable')
    expect(await trackEvaluation(archive, { master, candlesFor: async () => market, now: early + 86400000 })).toBe(1)
    expect(latestOutcomes(await archive.list('evaluation-outcomes', early + 86400000)).get('rejected:5').status).toBe('completed')
  })
})

describe('cohort reporting and uncertainty', () => {
  it('groups uncertainty by decision date and reports finite-only means, medians and losses', () => {
    const rows = [observation('a'), observation('b'), observation('c', { decisionAt: '2026-09-05T22:00:00Z' })]
    const outcomes = rows.map((o, i) => ({ ...evaluated(o)[0], observationId: o.id, netReturn: [-10, 4, 9][i], excessReturn: [1, 3, 6][i] }))
    const result = horizonSummary(rows, latestOutcomes(outcomes), 5)
    expect(result.distinctDates).toBe(2)
    expect(result.dailyMeanExcess).toBe(4) // averages daily means 2 and 6, not three picks
    expect(result.lowerBound).toBe(0)
    expect(result.upperBound).toBe(8)
    expect(result.meanNetReturn).toBe(1)
    expect(result.medianNetReturn).toBe(4)
    expect(result.worstLoss).toBe(-10)
    expect(result.wins).toBe(2)
    expect(result.losses).toBe(1)
  })

  it('does not present an uncertainty interval with only one date', () => {
    const result = horizonSummary([observation()], latestOutcomes(evaluated()), 5)
    expect(result.lowerBound).toBeNull()
    expect(result.upperBound).toBeNull()
  })

  it('shows six empty arms and no manufactured historical observations', async () => {
    const redis = evaluationTestStore(), report = await evaluationReport(createArchive(redis), now)
    expect(report.status).toBe('Insufficient data')
    expect(report.observations).toEqual([])
    expect(report.latestRun).toBeNull()
    expect(report.arms.filter((a) => a.cohort === 'shadow')).toHaveLength(6)
    expect(report.arms.every((a) => a.emptyHorizons[1].completed === 0 && a.emptyHorizons[1].pending === 0)).toBe(true)
    expect(redis.writes).toEqual([])
  })

  it('keeps periods and versions separate and seals final outcomes until release', async () => {
    const archive = createArchive(evaluationTestStore()), definition = experimentDefinition(at)
    await archive.put('evaluation-definition', EVALUATION_ID, definition, 'evaluation-definitions', at)
    const rows = [observation('dev'), observation('validation', { period: 'validation', armVersion: 'combined-v2' }),
      observation('final', { period: 'final-untouched' })]
    await archive.put('evaluation-run', 'run', { id: 'run', availableAt: at, observations: rows }, 'evaluation-runs', at)
    for (const o of rows) for (const result of evaluated(o)) await archive.put('evaluation-outcome', `${o.id}:${result.horizon}`, result, 'evaluation-outcomes', result.availableAt)
    const report = await evaluationReport(archive, now)
    expect(report.arms.find((a) => a.id === 'combined').cohorts).toHaveLength(3)
    expect(report.observations.find((o) => o.id === 'final').outcomes).toEqual([
      { horizon: 5, status: 'sealed', reason: 'Untouched evaluation' }, { horizon: 20, status: 'sealed', reason: 'Untouched evaluation' },
    ])
    const unsealed = await evaluationReport(archive, Date.parse(definition.finalReleaseAt) + 1)
    expect(unsealed.observations.find((o) => o.id === 'final').outcomes[0].grossReturn).toBeCloseTo(5)
  })

  it('marks a funded portfolio on common dates and makes missing marks unavailable', () => {
    const a = observation('a', { arm: 'constrained', sector: 'Technology', portfolio: { orderSize: 10000 } })
    const b = observation('b', { arm: 'constrained', sector: 'Energy', portfolio: { orderSize: 10000 } })
    const prices = market.map((bar, i) => ({ ...bar, close: i < 10 ? 110 : 90 }))
    const outcomes = latestOutcomes([a, b].flatMap((o) => evaluated(o, { stock: prices })))
    const portfolio = portfolioSummary([a, b], outcomes)
    expect(portfolio.status).toBe('Preliminary')
    expect(portfolio.drawdown).toBeLessThan(-3)
    expect(portfolio.concurrentExposure).toBeGreaterThan(20)
    expect(portfolio.sectorConcentration).toBeGreaterThan(10)
    expect(portfolio.equity).toBeCloseTo(97960)
    outcomes.get('a:20').path[2].returnPercent = null
    expect(portfolioSummary([a, b], outcomes).drawdown).toBeNull()
  })
})

describe('surfacing pending/failed evaluation jobs', () => {
  // freezeEvaluationJob/markJob* stamp records with real `new Date()`. Pin the
  // system clock for this block so every query-by-time call below (evaluationReport,
  // pendingEvaluationJobs) shares the same clock as those writes — otherwise
  // whether a freshly frozen job even falls inside the query's time window
  // depends on the real wall-clock offset from `at`, which is exactly the class
  // of bug the pre-flight review caught in Task 2's original draft.
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(at)) })
  afterEach(() => { vi.useRealTimers() })

  it('reports a frozen-but-not-yet-processed job instead of looking blank', async () => {
    const archive = createArchive(evaluationTestStore())
    const { freezeEvaluationJob } = await import('./evaluationJob.js')
    await freezeEvaluationJob(archive, { runId: 'run-1', publicationId: 'pub-1', decisionAt: at, evaluationInputs: {} })

    const report = await evaluationReport(archive, Date.now())
    expect(report.currentJob).toMatchObject({ status: 'pending', publicationId: 'pub-1' })
  })

  it('reports a failed job with its retry state', async () => {
    const archive = createArchive(evaluationTestStore())
    const { freezeEvaluationJob, markJobStarted, markJobFailed, pendingEvaluationJobs } = await import('./evaluationJob.js')
    const input = await freezeEvaluationJob(archive, { runId: 'run-1', publicationId: 'pub-1', decisionAt: at, evaluationInputs: {} })
    const [job] = await pendingEvaluationJobs(archive, Date.now())
    const started = await markJobStarted(archive, job)
    await markJobFailed(archive, input.id, started.attempt, { error: new Error('anthropic unavailable') })

    const report = await evaluationReport(archive, Date.now())
    expect(report.currentJob).toMatchObject({ status: 'failed', error: 'anthropic unavailable', retryState: 'pending' })
  })

  it('clears currentJob once the job has completed, since latestRun already reflects it', async () => {
    const archive = createArchive(evaluationTestStore())
    const { freezeEvaluationJob, markJobStarted, markJobCompleted, pendingEvaluationJobs } = await import('./evaluationJob.js')
    const input = await freezeEvaluationJob(archive, { runId: 'run-1', publicationId: 'pub-1', decisionAt: at, evaluationInputs: {} })
    const [job] = await pendingEvaluationJobs(archive, Date.now())
    const started = await markJobStarted(archive, job)
    await markJobCompleted(archive, input.id, started.attempt, { resultRunId: 'evaluation-run-1' })

    const report = await evaluationReport(archive, Date.now())
    expect(report.currentJob).toBeNull()
  })
})
