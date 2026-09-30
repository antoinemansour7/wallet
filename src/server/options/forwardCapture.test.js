// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createArchive } from '../research/archive.js'
import { memoryObjectStore, memoryRedis } from '../../test/memoryRedis.js'
import { optionsResearchFixture } from '../../test/optionsResearchFixture.js'
import { OPTIONS_LATEST_POINTER_KEY, archiveOptionsAuditRecord } from './auditStore.js'
import { evaluateOptionsOutcome } from './evaluation.js'
import { createOutcomeCaptureAuditRecord } from './observations.js'
import { OUTCOME_RECOVERY_FEED, archiveOutcomeRecovery } from './outcomeRecovery.js'
import {
  OPTIONS_CAPTURE_ACTIVE_KEY, OPTIONS_EXPERIMENT_LATEST_KEY, captureInstantsFor, forwardCaptureScanId, publishedOutcomePlans,
  rollUpObservationDay, runOptionsForwardCaptureTick,
} from './forwardCapture.js'

let clock, redis, archive, fixture
const now = () => clock
const sleep = async (ms) => { clock += ms }
const iso = (ms) => new Date(ms).toISOString()

function fakeAdapter({ latencyMs = 1000, missing = [] } = {}) {
  return {
    contractSnapshots: vi.fn(async (symbols) => {
      clock += latencyMs
      return {
        observations: symbols.filter((symbol) => !missing.includes(symbol)).map((symbol) => ({
          symbol, fetchedAt: iso(clock), impliedVolatility: 0.62, volume: 150, rawReferenceHash: 'c'.repeat(64),
          quote: { bid: 6.4, ask: 6.6, bidSize: 15, askSize: 12, marketAt: iso(clock - 3000) },
        })),
        missing: missing.filter((symbol) => symbols.includes(symbol)).map((symbol) => ({ symbol, reason: 'provider_snapshot_absent' })),
        requestCount: 1,
      }
    }),
    underlyingSnapshots: vi.fn(async (securities) => ({
      observations: securities.map((security) => ({ securityId: security.securityId, rawReferenceHash: 'd'.repeat(64),
        quote: { bid: 184.9, ask: 185.1, marketAt: iso(clock - 1000) } })),
      missing: [], requestCount: 1,
    })),
  }
}

async function publish(manifest = fixture.manifest) {
  for (const record of fixture.records) await archiveOptionsAuditRecord(archive, record)
  await archive.put('options-manifest', manifest.manifestId, manifest, 'options-manifests', manifest.availableAt)
  await redis.set(OPTIONS_LATEST_POINTER_KEY, JSON.stringify({ schemaVersion: 'options-latest-pointer-v1', scanId: manifest.scanId, manifestId: manifest.manifestId, availableAt: manifest.availableAt }))
}

const tick = (adapter, extra = {}) => runOptionsForwardCaptureTick({ redis, archive, adapter, now, sleep, ...extra })
const planFor = (contractId) => fixture.records.find((record) => record.recordType === 'outcome').payload.outcomes.find((plan) => plan.contract.contractId === contractId)
const entryFor = (contractId) => {
  const contract = fixture.finalChain.payload.contracts.find((item) => item.contractId === contractId)
  return { quote: contract.quote, underlyingPrice: 180, iv: contract.analytics.impliedVolatility, volume: contract.volume.value }
}
async function observationRecords(tradingDate) {
  return archive.list(`options-records:scan:${forwardCaptureScanId(tradingDate)}`, Date.parse(`${tradingDate}T23:59:59Z`), { since: Date.parse(`${tradingDate}T00:00:00Z`) })
}

beforeEach(async () => {
  clock = Date.parse('2026-09-22T19:59:30.000Z')
  redis = memoryRedis(now)
  archive = createArchive(redis, { objectStore: memoryObjectStore() })
  fixture = optionsResearchFixture()
  await publish()
})

describe('forward capture schedule', () => {
  it('reads every archived plan and groups the contracts due at each instant of a trading date', async () => {
    const plans = await publishedOutcomePlans({ archive, now: clock })
    expect(plans).toHaveLength(2)
    const today = captureInstantsFor(plans, '2026-09-22')
    expect(today[0].scheduledAt).toBe('2026-09-22T13:32:15.000Z')
    const close = today.find((entry) => entry.scheduledAt === '2026-09-22T20:00:00.000Z')
    expect(close.contracts.map((item) => [item.symbol, item.purposes])).toEqual([
      ['EX261022C00200000', ['endpoint+0']], ['EX261022P00160000', ['endpoint+0']],
    ])
    expect(close.contracts[0]).toMatchObject({ securityId: 'sec:EX', issuerId: 'iss:EX', ticker: 'EX', scanId: fixture.manifest.scanId })
    const nextDay = captureInstantsFor(plans, '2026-09-23')
    expect(nextDay[0].scheduledAt).toBe('2026-09-23T13:30:00.000Z')
    expect(nextDay.find((entry) => entry.scheduledAt === '2026-09-23T20:00:00.000Z').contracts[0].purposes).toEqual(['endpoint+1'])
    expect(captureInstantsFor(plans, '2026-09-26')).toEqual([])
  })

  it('counts a plan once even when a revised morning re-publishes it', async () => {
    const plans = await publishedOutcomePlans({ archive, now: clock })
    expect(captureInstantsFor([...plans, ...plans], '2026-09-22').at(-1).contracts).toHaveLength(2)
  })
})

describe('capture contract identity', () => {
  it('reads the stock ticker from the option symbol when a plan was stored without one', async () => {
    const plans = (await publishedOutcomePlans({ archive, now: clock }))
      .map((plan) => ({ ...plan, contract: { ...plan.contract, ticker: null } }))
    const close = captureInstantsFor(plans, '2026-09-22').find((entry) => entry.scheduledAt === '2026-09-22T20:00:00.000Z')
    expect(close.contracts.map((item) => item.ticker)).toEqual(['EX', 'EX'])
  })
})

describe('recovered capture plans', () => {
  it('captures plans recovered for a morning that was stored without any', async () => {
    archive = createArchive(memoryRedis(now), { objectStore: memoryObjectStore() })
    const outcome = fixture.records.find((record) => record.recordType === 'outcome')
    await publish({ ...fixture.manifest, records: fixture.manifest.records.filter((ref) => ref.type !== 'outcome') })
    expect(await publishedOutcomePlans({ archive, now: clock })).toEqual([])
    await archiveOutcomeRecovery(archive, createOutcomeCaptureAuditRecord({
      scanId: fixture.manifest.scanId, availableAt: '2026-09-22T14:00:00.000Z', plans: outcome.payload.outcomes, feed: OUTCOME_RECOVERY_FEED,
    }))
    const plans = await publishedOutcomePlans({ archive, now: clock })
    expect(plans.map((plan) => plan.planId).sort()).toEqual(outcome.payload.outcomes.map((plan) => plan.planId).sort())
    expect(plans[0].scanId).toBe(fixture.manifest.scanId)
  })
})

describe('experiment capture plans', () => {
  // A frozen Step 1 experiment run holding one close-only plan.
  async function archiveExperiment({ experimentId, availableAt, planId }) {
    const plan = { ...planFor(fixture.contracts[0].contractId), planId, scanId: '2026-09-22:shadow:options-step1-experiments-v1' }
    const run = { experimentId, policyVersion: 'options-step1-experiments-v1', tradingDate: '2026-09-22', availableAt, observations: [{ observationId: planId, plan }] }
    await archive.put('options-experiment', experimentId, run, 'options-experiments', availableAt)
  }

  it('captures the first frozen experiment run of each date alongside the published plans', async () => {
    await archiveExperiment({ experimentId: 'exp-a', availableAt: '2026-09-22T13:37:00.000Z', planId: 'experiment-plan-a' })
    await archiveExperiment({ experimentId: 'exp-b', availableAt: '2026-09-22T13:38:00.000Z', planId: 'experiment-plan-b' })
    const plans = await publishedOutcomePlans({ archive, now: clock })
    expect(plans.map((plan) => plan.planId)).toContain('experiment-plan-a')
    expect(plans.map((plan) => plan.planId)).not.toContain('experiment-plan-b')
    expect(plans).toHaveLength(3)
  })

  it('rebuilds the day\'s capture schedule when a new experiment run is frozen', async () => {
    await tick(fakeAdapter())
    clock += 60_000
    expect(await tick(fakeAdapter())).toMatchObject({ rebuilt: false })
    await archiveExperiment({ experimentId: 'exp-a', availableAt: '2026-09-22T13:37:00.000Z', planId: 'experiment-plan-a' })
    await redis.set(OPTIONS_EXPERIMENT_LATEST_KEY, 'exp-a')
    expect(await tick(fakeAdapter())).toMatchObject({ rebuilt: true })
    expect(JSON.parse(await redis.get(OPTIONS_CAPTURE_ACTIVE_KEY))).toMatchObject({ latestExperimentId: 'exp-a' })
  })
})

describe('forward capture tick', () => {
  it('captures every due contract in one batched request just before the instant, in a form #214 accepts', async () => {
    const adapter = fakeAdapter()
    const result = await tick(adapter)
    expect(result).toMatchObject({ status: 'captured', tradingDate: '2026-09-22', rebuilt: true, instants: ['2026-09-22T20:00:00.000Z'] })
    expect(adapter.contractSnapshots).toHaveBeenCalledTimes(1)
    expect(adapter.contractSnapshots.mock.calls[0]).toEqual([['EX261022C00200000', 'EX261022P00160000'], { deadline: '2026-09-22T20:00:00.000Z' }])
    expect(adapter.underlyingSnapshots).toHaveBeenCalledTimes(1)

    const [record] = await observationRecords('2026-09-22')
    expect(record).toMatchObject({ recordType: 'observation', scanId: 'forward-capture:2026-09-22', source: { provider: 'alpaca', feed: 'indicative' } })
    expect(record.payload.observations).toHaveLength(2)
    const call = record.payload.observations.find((item) => item.contractId === fixture.contracts[0].contractId)
    expect(call).toMatchObject({ status: 'observed', scheduledAt: '2026-09-22T20:00:00.000Z', purposes: ['endpoint+0'], underlyingPrice: 185, iv: 0.62 })
    expect(Date.parse(call.at)).toBeLessThanOrEqual(Date.parse('2026-09-22T20:00:00.000Z'))

    const outcome = evaluateOptionsOutcome({ plan: planFor(call.contractId), entry: entryFor(call.contractId),
      observations: record.payload.observations.filter((item) => item.planId === call.planId), asOf: '2026-09-22T20:05:00.000Z' })
    const sameDay = outcome.endpoints.find((item) => item.key === '0')
    expect(sameDay.status).toBe('observed')
    expect(sameDay.returnPct).toBeGreaterThan(0)
    expect(sameDay.underlyingMovePct).toBeCloseTo(100 * (185 / 180 - 1), 4)
  })

  it('keeps the option prices when the stock price request fails', async () => {
    const adapter = fakeAdapter()
    adapter.underlyingSnapshots.mockRejectedValue(new Error('Invalid Alpaca underlying symbol ""'))
    expect(await tick(adapter)).toMatchObject({ status: 'captured' })
    const [record] = await observationRecords('2026-09-22')
    expect(record.payload.observations.map((item) => [item.status, item.underlyingPrice])).toEqual([['observed', null], ['observed', null]])
  })

  it('costs a single Redis read when nothing is due in the minute', async () => {
    clock = Date.parse('2026-09-22T19:58:05.000Z')
    await tick(fakeAdapter())
    const before = { ...redis.calls }
    const adapter = fakeAdapter()
    expect(await tick(adapter)).toEqual({ status: 'idle', tradingDate: '2026-09-22', rebuilt: false })
    const used = Object.fromEntries(Object.entries(redis.calls).map(([name, value]) => [name, value - (before[name] || 0)]).filter(([, value]) => value))
    expect(used).toEqual({ mget: 1 })
    expect(adapter.contractSnapshots).not.toHaveBeenCalled()
  })

  it('lets only one delivery of a minute fetch, and never recaptures a completed instant', async () => {
    const start = clock
    const first = fakeAdapter()
    await tick(first)
    clock = start
    const duplicate = fakeAdapter()
    expect((await tick(duplicate)).status).toBe('duplicate')
    await redis.del(`research:options:capture:tick:v1:${Math.floor(start / 60000) * 60000}`)
    clock = start
    const retry = fakeAdapter()
    expect((await tick(retry)).status).toBe('captured')
    expect(duplicate.contractSnapshots).not.toHaveBeenCalled()
    expect(retry.contractSnapshots).not.toHaveBeenCalled()
    expect(await observationRecords('2026-09-22')).toHaveLength(1)
  })

  it('labels a snapshot that lands after its instant, so the evaluator does not count it', async () => {
    await tick(fakeAdapter({ latencyMs: 25000 }))
    const [record] = await observationRecords('2026-09-22')
    const call = record.payload.observations.find((item) => item.contractId === fixture.contracts[0].contractId)
    expect(call.status).toBe('late_observation')
    const outcome = evaluateOptionsOutcome({ plan: planFor(call.contractId), entry: entryFor(call.contractId),
      observations: [call], asOf: '2026-09-22T20:05:00.000Z' })
    expect(outcome.endpoints.find((item) => item.key === '0')).toMatchObject({ returnPct: null, status: 'missing_exit_quote' })
  })

  it('keeps a contract the provider omitted as an explicit gap', async () => {
    await tick(fakeAdapter({ missing: ['EX261022P00160000'] }))
    const [record] = await observationRecords('2026-09-22')
    const put = record.payload.observations.find((item) => item.contractId === fixture.contracts[1].contractId)
    expect(put).toMatchObject({ status: 'provider_snapshot_absent', quote: null, iv: null })
    expect(record.missing.some((item) => item.path.includes('observations[1].quote'))).toBe(true)
  })

  it.each([
    ['disabled by configuration', { enabled: false }, null],
    ['stopped by the kill switch', {}, async () => redis.set('research:options:kill:v1', 'on')],
  ])('does nothing when %s', async (_label, extra, setup) => {
    await setup?.()
    const adapter = fakeAdapter()
    expect((await tick(adapter, extra)).status).toBe('disabled')
    expect(adapter.contractSnapshots).not.toHaveBeenCalled()
  })

  it('does nothing on a closed market day', async () => {
    clock = Date.parse('2026-09-26T15:00:00.000Z')
    const adapter = fakeAdapter()
    expect(await tick(adapter)).toEqual({ status: 'closed', tradingDate: '2026-09-26' })
    expect(redis.calls.mget).toBeUndefined()
  })

  it('rebuilds the schedule when a new morning is published', async () => {
    clock = Date.parse('2026-09-22T19:58:05.000Z')
    expect((await tick(fakeAdapter())).rebuilt).toBe(true)
    expect((await tick(fakeAdapter())).rebuilt).toBe(false)
    await publish({ ...fixture.manifest, manifestId: 'e'.repeat(64) })
    expect((await tick(fakeAdapter())).rebuilt).toBe(true)
    expect(JSON.parse(await redis.get(OPTIONS_CAPTURE_ACTIVE_KEY)).latestManifestId).toBe('e'.repeat(64))
  })
})

describe('daily observation rollup', () => {
  it('compacts the finished day once, on the first tick of the next trading day', async () => {
    await tick(fakeAdapter())
    clock = Date.parse('2026-09-23T13:29:30.000Z')
    expect(await tick(fakeAdapter())).toMatchObject({ status: 'captured', tradingDate: '2026-09-23', instants: ['2026-09-23T13:30:00.000Z'] })
    const [rollup] = await archive.list('options-observation-days', Date.parse('2026-09-24T00:00:00Z'))
    expect(rollup).toMatchObject({ schemaVersion: 'options-forward-observation-day-v1', tradingDate: '2026-09-22' })
    expect(rollup.observations).toHaveLength(2)
    expect(rollup.observations[0].sourceRecordId).toBe(rollup.sourceRecordIds[0])
  })

  it('is deterministic, so compacting the same day again stores nothing new', async () => {
    await tick(fakeAdapter())
    const first = await rollUpObservationDay(archive, '2026-09-22')
    const second = await rollUpObservationDay(archive, '2026-09-22')
    expect(second.rollupId).toBe(first.rollupId)
    expect(await rollUpObservationDay(archive, '2026-09-21')).toBeNull()
  })
})
