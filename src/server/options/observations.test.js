// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { digest } from '../research/archive.js'
import { OPTIONS_CALENDAR_2026 } from './calendar.js'
import {
  acquisitionJobId,
  contractVersionAt,
  createHistoricalContractVersion,
  createHistoricalBackfillPlan,
  createObservationAuditRecord,
  createOptionsCoverageManifest,
  createOutcomeCapturePlan,
  OPTIONS_OBSERVATION_POLICY,
  observationLicense,
  outcomeAcquisitionJobs,
  replayCoverageDecision,
  runObservationAcquisition,
} from './observations.js'

const hash = (value) => digest(value)
const identity = {
  ticker: 'NVDA',
  securityId: 'wallai:security:nvidia:common',
  issuerId: 'wallai:issuer:nvidia',
}

describe('options historical and forward observation acquisition', () => {
  it('keeps coverage field/date specific and refuses late or wrong-date observations for replay', () => {
    const manifest = createOptionsCoverageManifest({
      scanId: '2026-09-22:opening:v1', ...identity, tradingDate: '2026-09-22',
      freezeAt: '2026-09-22T13:35:00.000Z', availableAt: '2026-09-24T12:00:00.000Z',
      identitySnapshotId: hash('identity'), contractEnumerationId: hash('enumeration'),
      fields: [
        {
          path: 'contract.quote', status: 'observed', expectedDate: '2026-09-22',
          marketAt: '2026-09-22T13:32:00.000Z', publicAt: '2026-09-22T13:32:00.100Z', acquiredAt: '2026-09-24T12:00:00.000Z',
          sourceChecksum: hash('historical quote'),
        },
        {
          path: 'contract.openInterest', status: 'observed', expectedDate: '2026-09-22',
          marketAt: '2026-09-23T00:00:00.000Z', publicAt: '2026-09-23T12:00:00.000Z', acquiredAt: '2026-09-24T12:00:00.000Z',
          sourceChecksum: hash('current oi'),
        },
        {
          path: 'contract.greeks', status: 'observed', expectedDate: '2026-09-22',
          marketAt: '2026-09-22T13:32:00.000Z', publicAt: null, acquiredAt: '2026-09-24T12:00:00.000Z',
          sourceChecksum: hash('undated greeks'),
        },
        { path: 'contract.iv', status: 'missing', reason: 'historical_provider_does_not_publish_iv' },
        { path: 'underlying.close', status: 'reconstructed', method: 'split_adjusted_from_dated_bars', inputHashes: [hash('bars')] },
      ],
    })
    expect(manifest.payload.counts).toEqual({ observed: 3, reconstructed: 1, missing: 1, replayEligible: 2 })
    expect(manifest.payload.fields.find((item) => item.path === 'contract.openInterest')).toMatchObject({
      replayEligible: false, reason: 'observation_date_mismatch',
    })
    expect(manifest.payload.fields.find((item) => item.path === 'contract.greeks')).toMatchObject({
      replayEligible: false, reason: 'publication_time_unknown',
    })
    expect(replayCoverageDecision([manifest], ['contract.quote'])).toMatchObject({ mode: 'point_in_time_replay', fullHistoricalCoverageClaimAllowed: true })
    expect(replayCoverageDecision([manifest], ['contract.quote', 'underlying.close'])).toMatchObject({ mode: 'restricted_replay', reconstructed: ['underlying.close'] })
    expect(replayCoverageDecision([manifest], ['contract.quote', 'contract.iv', 'contract.openInterest', 'contract.greeks'])).toMatchObject({
      mode: 'forward_only', missing: ['contract.iv'], retrospective: ['contract.openInterest', 'contract.greeks'], fullHistoricalCoverageClaimAllowed: false,
    })
  })

  it('retains expired, delisted and adjusted contract versions without crossing issuer intervals', () => {
    const standard = createHistoricalContractVersion({
      contractId: 'osi:NVDA260918C00200000', rawId: 'provider-standard', ...identity,
      validFrom: '2026-07-01T00:00:00.000Z', validThrough: '2026-09-18T20:00:00.000Z',
      expirationDate: '2026-09-18', status: 'expired', provider: 'fixture', observedAt: '2026-09-19T01:00:00.000Z',
      deliverable: { multiplier: 100, components: [{ securityId: identity.securityId, shares: 100 }], adjusted: false },
    })
    const adjusted = createHistoricalContractVersion({
      contractId: 'occ:NVDA1:fixture', rawId: 'provider-adjusted', ...identity,
      validFrom: '2026-08-15T00:00:00.000Z', validThrough: '2026-09-10T20:00:00.000Z',
      expirationDate: '2026-09-18', status: 'delisted', provider: 'fixture', observedAt: '2026-09-11T01:00:00.000Z',
      corporateActionIds: ['split-2026-08-15'],
      deliverable: { multiplier: 100, components: [{ securityId: identity.securityId, shares: 50 }, { cashUsd: 25 }], adjusted: true },
    })
    expect(standard.status).toBe('expired')
    expect(adjusted.deliverable.adjusted).toBe(true)
    expect(contractVersionAt([standard], { contractId: standard.contractId, securityId: identity.securityId, issuerId: identity.issuerId, at: '2026-09-01T14:00:00Z' })).toMatchObject({ available: true })
    expect(contractVersionAt([standard], { contractId: standard.contractId, at: '2026-10-01T14:00:00Z' })).toEqual({ available: false, reason: 'contract_not_available_at_scan' })
    expect(contractVersionAt([{ ...standard, issuerId: 'wallai:issuer:old-nvidia' }], {
      contractId: standard.contractId, securityId: identity.securityId, issuerId: identity.issuerId, at: '2026-09-01T14:00:00Z',
    })).toEqual({ available: false, reason: 'contract_not_available_at_scan' })
  })

  it('plans close endpoints, expiry follow-through and explicit five-minute path samples across a holiday', () => {
    const plan = createOutcomeCapturePlan({
      scanId: 'thanksgiving-scan', tradingDate: '2026-11-25', entryAt: '2026-11-25T14:32:00.000Z',
      contract: {
        contractId: 'osi:NVDA261204C00200000', rawId: 'provider-1', ...identity,
        underlyingTicker: 'NVDA', type: 'call', strikePrice: 200, expirationDate: '2026-12-04',
      },
      calendar: OPTIONS_CALENDAR_2026,
    })
    expect(plan.endpointTargets.filter((target) => target.kind === 'endpoint_close').map((target) => [target.sessionOffset, target.tradingDate])).toEqual([
      [0, '2026-11-25'], [1, '2026-11-27'], [3, '2026-12-01'], [5, '2026-12-03'], [10, '2026-12-10'],
    ])
    expect(plan.endpointTargets.find((target) => target.sessionOffset === 10)).toMatchObject({ status: 'unavailable', reason: 'contract_expired_before_endpoint' })
    expect(plan.endpointTargets.at(-1)).toMatchObject({ kind: 'expiry_close', tradingDate: '2026-12-04', scheduledAt: '2026-12-04T21:00:00.000Z' })
    expect(plan.pathSampling.resolutionMinutes).toBe(5)
    expect(plan.pathSampling.samples.some((sample) => sample.tradingDate === '2026-11-26')).toBe(false)
    expect(plan.pathSampling.samples.some((sample) => sample.tradingDate === '2026-11-27' && sample.scheduledAt === '2026-11-27T17:55:00.000Z')).toBe(true)
    expect(plan.pathSampling.limitation).toContain('unknown')
    const jobs = outcomeAcquisitionJobs(plan)
    expect(new Set(jobs.map((job) => job.scheduledAt)).size).toBe(jobs.length)
    expect(jobs.find((job) => job.scheduledAt === '2026-12-04T21:00:00.000Z').purposes).toContain('expiry_close')
    expect(jobs.every((job) => job.pool === 'forward')).toBe(true)
  })

  it('starts entry-day path samples on the shared five-minute market grid, not at each pick\'s entry second', () => {
    const plan = createOutcomeCapturePlan({
      scanId: 'grid-scan', tradingDate: '2026-11-25', entryAt: '2026-11-25T14:32:07.412Z',
      contract: {
        contractId: 'osi:NVDA261204C00200000', rawId: 'provider-1', ...identity,
        underlyingTicker: 'NVDA', type: 'call', strikePrice: 200, expirationDate: '2026-12-04',
      },
    })
    const entryDay = plan.pathSampling.samples.filter((sample) => sample.tradingDate === '2026-11-25')
    expect(entryDay[0].scheduledAt).toBe('2026-11-25T14:35:00.000Z')
    expect(plan.pathSampling.samples.every((sample) => /:[0-5][05]:00\.000Z$/.test(sample.scheduledAt))).toBe(true)
  })

  it('keeps reserved requests for close captures once routine samples have spent the rest of the day', async () => {
    const policy = { ...OPTIONS_OBSERVATION_POLICY, pools: { ...OPTIONS_OBSERVATION_POLICY.pools,
      forward: { maxRequestsPerDay: 3, reservedRequests: 1, maxBytesPerDay: 1000, maxConcurrency: 1 } } }
    const job = (name, reserved = false) => ({ pool: 'forward', provider: 'fixture', endpoint: '/snapshot', parameters: { name }, tradingDate: '2026-09-22', ...(reserved && { reserved }) })
    let checkpoint = null
    const run = (jobs) => runObservationAcquisition({
      jobs, pool: 'forward', day: '2026-09-22', maxAttempts: 1, policy,
      fetchJob: async (item) => ({ record: { recordId: hash(item.parameters.name), byteLength: 1 } }),
      archiveRecord: async (record) => record,
      loadCheckpoint: async () => checkpoint,
      saveCheckpoint: async (value) => { checkpoint = structuredClone(value) },
    })
    const routine = await run([job('a'), job('b'), job('c')])
    expect(routine.manifest.requestCount).toBe(2)
    expect(routine.failed).toEqual([{ jobId: acquisitionJobId(job('c')), reason: 'daily_request_budget_exhausted' }])
    const close = await run([job('close', true)])
    expect(close.manifest.requestCount).toBe(3)
    expect(close.completedJobIds).toContain(acquisitionJobId(job('close', true)))
  })

  it('creates a reproducible backfill manifest that preserves holidays and named cohorts as gaps/evidence', () => {
    const plan = createHistoricalBackfillPlan({
      tradingDates: ['2026-09-04', '2026-09-07', '2026-09-08'], securities: [identity],
      licenseId: 'test-fixture', provider: 'fixture', cohortTags: {
        '2026-09-04': ['normal_week', 'expired_contract'],
        '2026-09-07': ['holiday'],
        '2026-09-08': ['earnings_event', 'corporate_action'],
      },
    })
    expect(plan.jobs).toHaveLength(2)
    expect(plan.jobs[1].parameters.cohortTags).toEqual(['earnings_event', 'corporate_action'])
    expect(plan.gaps).toEqual([{ tradingDate: '2026-09-07', reason: 'holiday', cohortTags: ['holiday'] }])
    expect(plan.jobs[0].parameters.fields).toEqual(expect.arrayContaining(['contract_reference', 'open_interest_publication', 'events', 'dividends', 'rates']))
    expect(plan.planId).toMatch(/^[a-f0-9]{64}$/)
  })

  it('stores immutable normalized observations with request checksums and enforces retention rights', () => {
    expect(observationLicense('alpaca-basic-indicative', { rawPayload: true })).toMatchObject({ allowed: false, reason: 'raw_payload_retention_not_authorized' })
    const record = createObservationAuditRecord({
      scanId: 'scan', availableAt: '2026-09-22T20:00:01.000Z', licenseId: 'alpaca-basic-indicative',
      source: { provider: 'alpaca', feed: 'indicative-history', session: 'rth-close', entitlement: 'basic-free' },
      request: {
        endpoint: '/v1beta1/options/bars', parametersHash: hash('params'), bodyChecksum: hash('body'),
        requestedAt: '2026-09-22T20:00:00.000Z', receivedAt: '2026-09-22T20:00:01.000Z', attempt: 1, status: 200,
      },
      observations: [{ contractId: 'osi:NVDA261016C00200000', marketAt: '2026-09-22T19:59:00.000Z', bid: 4.9, ask: 5.1 }],
    })
    expect(record).toMatchObject({ recordType: 'observation', archiveKind: 'options-observation' })
    expect(record.payload).toMatchObject({ observationCount: 1, normalizedChecksum: hash(record.payload.observations) })
    expect(() => createObservationAuditRecord({
      scanId: 'scan', availableAt: '2026-09-22T20:00:01.000Z', licenseId: 'alpaca-basic-indicative',
      source: { provider: 'alpaca', feed: 'history', session: 'rth', entitlement: 'basic-free' },
      request: { endpoint: '/history', parametersHash: hash('p'), requestedAt: '2026-09-22T20:00:00Z', receivedAt: '2026-09-22T20:00:01Z', attempt: 1 },
      observations: [], rawProviderPayload: { forbidden: true },
    })).toThrow('raw_payload_retention_not_authorized')
  })

  it('resumes after failure, deduplicates jobs and keeps historical spend outside the opening pool', async () => {
    const jobs = ['a', 'b', 'b'].map((symbol) => ({
      pool: 'historical', provider: 'fixture', endpoint: '/quotes', parameters: { symbol }, tradingDate: '2026-09-22',
    }))
    let checkpoint = null
    let failB = true
    const archived = []
    const fetchJob = async (job) => {
      if (job.parameters.symbol === 'b' && failB) { const error = new Error('interrupted'); error.code = 'fixture_interrupted'; throw error }
      const recordId = hash(job.parameters.symbol)
      return { record: { recordId, byteLength: job.parameters.symbol === 'a' ? 101 : 202 } }
    }
    const run = () => runObservationAcquisition({
      jobs, pool: 'historical', day: '2026-09-22', maxAttempts: 1, fetchJob,
      archiveRecord: async (record) => { archived.push(record.recordId); return record },
      loadCheckpoint: async () => checkpoint,
      saveCheckpoint: async (value) => { checkpoint = structuredClone(value) },
    })
    const first = await run()
    expect(first.manifest).toMatchObject({ requestCount: 2, byteCount: 101 })
    expect(first.manifest.completedJobIds).toEqual([acquisitionJobId(jobs[0])])
    failB = false
    const second = await run()
    expect(second.manifest).toMatchObject({ requestCount: 3, byteCount: 303 })
    expect(second.manifest.completedJobIds).toHaveLength(2)
    expect(archived).toEqual([hash('a'), hash('b')])
    expect(second.manifest.limits).not.toEqual(expect.objectContaining({ reserved: true }))
    expect(() => acquisitionJobId({ ...jobs[0], pool: 'opening' })).toThrow('live opening budget')
    expect(() => acquisitionJobId({ ...jobs[0], endpoint: '/options/latest-snapshot' })).toThrow('cannot source historical')
  })
})
