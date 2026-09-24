// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CronBudgetExceededError } from './runtimeBudget.js'
import { DEFERRED_REPORTS_POLICY, mergeReports, pendingReportPicks, runDeferredReports } from './deferredReports.js'

const RUN = '2026-09-24T07:24:00.000Z', PRIOR = '2026-09-23T07:24:00.000Z'
const pick = (ticker, extra = {}) => ({ ticker, candidateId: `c-${ticker}`, generatedAt: RUN, report: null, ...extra })

function payload() {
  const five = ['CRWV', 'AMZN', 'KLAC', 'PANW'].map((ticker) => pick(ticker))
  return {
    generatedAt: RUN, reportsPending: true, publicationId: 'pub',
    picks: five,
    picksByHorizon: {
      5: five,
      20: [pick('GWRE'), pick('URBN'), pick('OLD', { generatedAt: PRIOR, report: 'kept report' })],
      60: [pick('GME'), pick('BNC'), pick('AMZN')],
    },
  }
}

function fakeRedis(initial) {
  const values = new Map([['research:latest', structuredClone(initial)]]), lists = new Map()
  return {
    values,
    get: vi.fn(async (key) => structuredClone(values.get(key) ?? null)),
    set: vi.fn(async (key, value) => { values.set(key, structuredClone(value)); return 'OK' }),
    lrem: vi.fn(async (key, _count, value) => { lists.set(key, (lists.get(key) || []).filter((item) => item !== value)) }),
    lpush: vi.fn(async (key, value) => { lists.set(key, [value, ...(lists.get(key) || [])]) }),
    ltrim: vi.fn(async () => {}),
  }
}

const budget = (batchesAllowed = Infinity) => {
  let checks = 0
  return { availableMs: () => 250_000, canStart: () => checks++ < batchesAllowed }
}
const writeAll = vi.fn(async (batch) => batch.map((item) => ({ ...item, report: `Report for ${item.ticker}`, citations: ['https://example.com'] })))
const now = () => Date.parse('2026-09-24T09:10:00.000Z')
const stored = (redis) => redis.values.get('research:latest')
// The batch mechanics below are exercised with three reports per batch.
const policy = { ...DEFERRED_REPORTS_POLICY, batchSize: 3 }

beforeEach(() => { writeAll.mockClear() })

describe('pending reports', () => {
  it('selects each of this run\'s unreported picks once, across horizons, and never a carried pick', () => {
    expect(pendingReportPicks(payload()).map((item) => item.ticker)).toEqual(['CRWV', 'AMZN', 'KLAC', 'PANW', 'GWRE', 'URBN', 'GME', 'BNC'])
  })

  it('applies a report everywhere its pick appears and records a failure on the pick', () => {
    const merged = mergeReports(payload(), [
      { candidateId: 'c-AMZN', report: 'AMZN report', citations: ['u'] },
      { candidateId: 'c-KLAC', report: null, reportError: 'Request was aborted.' },
    ])
    expect(merged.picksByHorizon[5][1]).toMatchObject({ ticker: 'AMZN', report: 'AMZN report', citations: ['u'] })
    expect(merged.picksByHorizon[60][2].report).toBe('AMZN report')
    expect(merged.picks).toBe(merged.picksByHorizon[5])
    expect(merged.picksByHorizon[5][2]).toMatchObject({ ticker: 'KLAC', report: null, reportError: 'Request was aborted.' })
    expect(merged.picksByHorizon[20][2].report).toBe('kept report')
    expect(merged.reportsPending).toBe(true)
  })
})

describe('deferred report job', () => {
  it('stores each report as soon as it is written, one at a time by default', async () => {
    const redis = fakeRedis(payload())
    const result = await runDeferredReports({ redis, budget: budget(), generate: writeAll, now })
    expect(result).toEqual({ status: 'complete', generatedAt: RUN, candidates: 8, written: 8, failed: 0, deferred: 0 })
    expect(writeAll.mock.calls.map(([batch]) => batch.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
    expect(redis.set.mock.calls.filter(([key]) => key === 'research:latest')).toHaveLength(8)
  })

  it('writes every report in batches, storing after each batch, and clears the pending flag', async () => {
    const redis = fakeRedis(payload())
    const result = await runDeferredReports({ redis, budget: budget(), generate: writeAll, now, policy })
    expect(result).toEqual({ status: 'complete', generatedAt: RUN, candidates: 8, written: 8, failed: 0, deferred: 0 })
    expect(writeAll.mock.calls.map(([batch]) => batch.length)).toEqual([3, 3, 2])
    expect(writeAll.mock.calls[0][1].requestOptions).toEqual({ signal: expect.any(AbortSignal), timeout: 250_000 })
    expect(redis.set.mock.calls.filter(([key]) => key === 'research:latest')).toHaveLength(3)
    expect(stored(redis).reportsPending).toBe(false)
    expect(stored(redis).picksByHorizon[60].map((item) => item.report)).toEqual(['Report for GME', 'Report for BNC', 'Report for AMZN'])
    expect(redis.values.get('research:history:2026-09-24')).toEqual(stored(redis))
  })

  it('keeps a premarket re-rank written between batches instead of reverting it', async () => {
    const redis = fakeRedis(payload())
    const generate = vi.fn(async (batch) => {
      if (generate.mock.calls.length === 1) {
        const current = redis.values.get('research:latest')
        const reranked = [...current.picksByHorizon[5]].reverse()
        redis.values.set('research:latest', { ...current, picks: reranked, picksByHorizon: { ...current.picksByHorizon, 5: reranked }, premarketCheckedAt: '2026-09-24T09:11:00.000Z' })
      }
      return writeAll(batch)
    })
    await runDeferredReports({ redis, budget: budget(), generate, now, policy })
    expect(stored(redis).premarketCheckedAt).toBe('2026-09-24T09:11:00.000Z')
    expect(stored(redis).picks.map((item) => item.ticker)).toEqual(['PANW', 'KLAC', 'AMZN', 'CRWV'])
    expect(stored(redis).picks.every((item) => item.report)).toBe(true)
  })

  it('keeps finished batches when time runs out, and a later run writes only what is left', async () => {
    const redis = fakeRedis(payload())
    expect(await runDeferredReports({ redis, budget: budget(1), generate: writeAll, now, policy }))
      .toEqual({ status: 'partial', generatedAt: RUN, candidates: 8, written: 3, failed: 0, deferred: 5, stopped: 'time_budget' })
    expect(stored(redis).reportsPending).toBe(true)
    writeAll.mockClear()
    expect((await runDeferredReports({ redis, budget: budget(), generate: writeAll, now, policy })).written).toBe(5)
    expect(writeAll.mock.calls.flatMap(([batch]) => batch.map((item) => item.ticker))).toEqual(['PANW', 'GWRE', 'URBN', 'GME', 'BNC'])
  })

  it('keeps earlier batches when a batch hits the time limit mid-flight', async () => {
    const redis = fakeRedis(payload())
    const generate = vi.fn(async (batch) => {
      if (generate.mock.calls.length === 2) throw new CronBudgetExceededError('Report generation', 0)
      return writeAll(batch)
    })
    const result = await runDeferredReports({ redis, budget: budget(), generate, now, policy })
    expect(result).toMatchObject({ status: 'partial', written: 3, deferred: 5, stopped: 'time_budget' })
    expect(stored(redis).picks.slice(0, 3).every((item) => item.report)).toBe(true)
  })

  it('records a failed report, then a rerun retries it and clears the error', async () => {
    const redis = fakeRedis(payload())
    const flaky = vi.fn(async (batch) => batch.map((item) => (item.ticker === 'KLAC'
      ? { ...item, report: null, reportError: 'rate limited' } : { ...item, report: `Report for ${item.ticker}` })))
    expect(await runDeferredReports({ redis, budget: budget(), generate: flaky, now, policy })).toMatchObject({ status: 'partial', written: 7, failed: 1, deferred: 0 })
    expect(stored(redis).picks[2]).toMatchObject({ ticker: 'KLAC', reportError: 'rate limited' })
    expect(await runDeferredReports({ redis, budget: budget(), generate: writeAll, now, policy })).toMatchObject({ status: 'complete', written: 1 })
    expect(stored(redis).picks[2]).not.toHaveProperty('reportError')
    expect(stored(redis).reportsPending).toBe(false)
  })

  it('stops without overwriting when a newer run replaces the picks mid-job', async () => {
    const redis = fakeRedis(payload())
    const generate = vi.fn(async (batch) => {
      redis.values.set('research:latest', { ...payload(), generatedAt: '2026-09-24T09:15:00.000Z' })
      return writeAll(batch)
    })
    expect((await runDeferredReports({ redis, budget: budget(), generate, now, policy })).status).toBe('superseded')
    expect(stored(redis).picks.every((item) => !item.report)).toBe(true)
  })

  it('does not spend on missing, stale or already-complete runs', async () => {
    expect((await runDeferredReports({ redis: fakeRedis(null), budget: budget(), generate: writeAll, now, policy })).status).toBe('nothing_published')
    expect((await runDeferredReports({ redis: fakeRedis(payload()), budget: budget(), generate: writeAll, now: () => Date.parse('2026-09-25T09:10:00Z') })).status).toBe('stale')
    const done = mergeReports(payload(), pendingReportPicks(payload()).map((item) => ({ ...item, report: 'r' })))
    const redis = fakeRedis({ ...done, reportsPending: true })
    expect((await runDeferredReports({ redis, budget: budget(), generate: writeAll, now, policy })).status).toBe('complete')
    expect(stored(redis).reportsPending).toBe(false)
    expect(writeAll).not.toHaveBeenCalled()
  })
})
