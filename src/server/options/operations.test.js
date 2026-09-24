// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  accumulateProviderStats, buildOptionsOperationsReport, emptyProviderStats, finalizeProviderStats,
  OPTIONS_OPERATIONS_POLICY_VERSION, sanitizeOperationsReport, summarizeChainQuality,
  summarizeMissingEvidence, summarizePercentiles, summarizePricingResiduals, summarizeStageTimings,
  summarizeWatchlistCoverage,
} from './operations.js'
import { OPTIONS_KILL_SWITCH_KEY, OPTIONS_SCHEDULE_POLICY } from './scheduler.js'

const HASH = (byte) => byte.repeat(64)

describe('provider request accounting', () => {
  it('sums requests, pages and status codes across several adapter calls without a new request', () => {
    let stats = emptyProviderStats()
    stats = accumulateProviderStats(stats, {
      requestCount: 3, pageCounts: { metadata: 1, snapshots: 1 },
      diagnostics: [{ status: 200 }, { status: 429 }, { status: 200 }],
    })
    stats = accumulateProviderStats(stats, {
      requestCount: 2, pageCounts: { metadata: 1 },
      diagnostics: [{ status: 502 }, { status: 200 }],
    })
    stats = accumulateProviderStats(stats, null) // a failed adapter construction returns no observation
    const finalized = finalizeProviderStats(stats)
    expect(finalized).toEqual({
      providerRequestCount: 5, providerPagesFetched: 3, provider429Count: 1, providerServerErrorCount: 1,
    })
  })

  it('tolerates a mock observation with no diagnostics fields at all', () => {
    const stats = accumulateProviderStats(emptyProviderStats(), { underlying: {} })
    expect(finalizeProviderStats(stats)).toEqual({ providerRequestCount: 0, providerPagesFetched: 0, provider429Count: 0, providerServerErrorCount: 0 })
  })
})

describe('summarizePercentiles', () => {
  it('reports p50/p90/p99/max and an honest empty state', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    const summary = summarizePercentiles(values)
    expect(summary.count).toBe(100)
    expect(summary.p50).toBeCloseTo(50.5, 1)
    expect(summary.p90).toBeCloseTo(90.1, 1)
    expect(summary.p99).toBeCloseTo(99.01, 1)
    expect(summary.max).toBe(100)
    expect(summarizePercentiles([])).toEqual({ count: 0, p50: null, p90: null, p99: null, max: null })
  })

  it('drops non-finite values rather than letting them corrupt the ranking', () => {
    expect(summarizePercentiles([10, null, NaN, 20, undefined]).count).toBe(2)
  })
})

describe('summarizeChainQuality', () => {
  it('reports quote age/skew percentiles, missing-analytics count and rejection reasons from archived chain records', () => {
    const chainRecords = [
      { payload: { contracts: [
        { quote: { ageMs: 4000 }, skewMs: 1000, analyticsAgeUnknown: false },
        { quote: { ageMs: 8000 }, skewMs: 3000, analyticsAgeUnknown: true },
      ], rejected: [{ reason: 'stale_contract_quote' }, { reason: 'stale_contract_quote' }, { reason: 'zero_bid' }] } },
      { payload: { contracts: [{ quote: { ageMs: 6000 }, skewMs: 2000, analyticsAgeUnknown: false }], rejected: [] } },
    ]
    const summary = summarizeChainQuality(chainRecords)
    expect(summary.contractsObserved).toBe(3)
    expect(summary.quoteAgeMs.count).toBe(3)
    expect(summary.quoteSkewMs.count).toBe(3)
    expect(summary.analyticsAgeUnknownCount).toBe(1)
    expect(summary.rejectionReasons).toEqual({ stale_contract_quote: 2, zero_bid: 1 })
  })

  it('handles an empty or malformed record list without throwing', () => {
    expect(summarizeChainQuality([])).toMatchObject({ contractsObserved: 0, analyticsAgeUnknownCount: 0, rejectionReasons: {} })
    expect(summarizeChainQuality([{ payload: null }, null, {}])).toMatchObject({ contractsObserved: 0 })
  })
})

describe('summarizePricingResiduals', () => {
  it('separates calibration residual magnitude from calibration and convergence failure counts', () => {
    const scenarioRecords = [{ payload: { scenarios: [
      { calibration: { status: 'calibrated', residual: 0.0003 } },
      { calibration: { status: 'calibrated', residual: 0.0007 } },
      { calibration: { status: 'failed', reason: 'residual_above_tolerance' } },
      { calibration: { status: 'calibrated', residual: 0.0001 }, convergence: { converged: false } },
    ] } }]
    const summary = summarizePricingResiduals(scenarioRecords)
    expect(summary.residual.count).toBe(3)
    expect(summary.calibrationFailures).toBe(1)
    expect(summary.convergenceFailures).toBe(1)
  })
})

describe('summarizeMissingEvidence', () => {
  it('counts missing-data reasons across every security in the frozen evidence record', () => {
    const evidenceRecord = { payload: { securities: [
      { missing: [{ path: 'underlying.premarketPrice', reason: 'no_point_in_time_underlying_observation' }] },
      { missing: [{ path: 'coverage.earnings', reason: 'coverage_unknown' }, { path: 'coverage.catalysts', reason: 'coverage_unknown' }] },
      { missing: [] },
    ] } }
    const summary = summarizeMissingEvidence(evidenceRecord)
    expect(summary.securitiesObserved).toBe(3)
    expect(summary.missingByReason).toEqual({ no_point_in_time_underlying_observation: 1, coverage_unknown: 2 })
  })

  it('reports null observation counts rather than zero when no evidence record was found', () => {
    expect(summarizeMissingEvidence(null)).toEqual({ securitiesObserved: null, missingByReason: {} })
  })
})

describe('summarizeWatchlistCoverage', () => {
  it('flags incomplete all-watchlist coverage explicitly rather than only counting candidates', () => {
    const evidenceRecord = { payload: { securities: [{}, {}, {}] } }
    const decisionRecord = { payload: { candidates: [{}, {}] } }
    expect(summarizeWatchlistCoverage({ watchlistSize: 25, evidenceRecord, decisionRecord }))
      .toEqual({ watchlistSize: 25, securitiesObserved: 3, coverageComplete: false, candidateCount: 2 })
    expect(summarizeWatchlistCoverage({ watchlistSize: 3, evidenceRecord, decisionRecord }).coverageComplete).toBe(true)
    expect(summarizeWatchlistCoverage({ watchlistSize: 25, evidenceRecord: null, decisionRecord: null }))
      .toEqual({ watchlistSize: 25, securitiesObserved: null, coverageComplete: null, candidateCount: null })
  })
})

describe('summarizeStageTimings', () => {
  it('reports scheduled-vs-started latency and duration from already-archived, already-redacted scan records', () => {
    const scanRecords = [{ payload: {
      stage: 'opening', tradingDate: '2026-09-22', status: 'complete',
      scheduledAt: '2026-09-22T13:31:00.000Z', deadlineAt: '2026-09-22T13:35:00.000Z',
      startedAt: '2026-09-22T13:31:05.000Z', endedAt: '2026-09-22T13:33:00.000Z', attempt: 1,
      metrics: { acceptedCount: 12, provider429Count: 0 },
    } }]
    const [row] = summarizeStageTimings(scanRecords)
    expect(row).toMatchObject({ stage: 'opening', tradingDate: '2026-09-22', status: 'complete', startedLatencyMs: 5000, durationMs: 115000 })
    expect(row.metrics).toEqual({ acceptedCount: 12, provider429Count: 0 })
  })

  it('reports null latency/duration instead of throwing on a partial attempt record', () => {
    const [row] = summarizeStageTimings([{ payload: { stage: 'premarket', tradingDate: '2026-09-22', status: 'missed' } }])
    expect(row).toMatchObject({ startedLatencyMs: null, durationMs: null })
  })
})

describe('sanitizeOperationsReport', () => {
  it('redacts any accidentally secret-shaped key and strips stack traces, deeply', () => {
    const dirty = {
      chain: { rejectionReasons: { zero_bid: 3 } },
      provider: { apiKey: 'sk-live-should-never-appear', nested: { authToken: 'abc' } },
      failure: { message: 'ok to keep a short reason code', stack: 'Error: boom\n at fetch (...)' },
      list: [{ password: 'hunter2' }, { fine: 1 }],
    }
    const clean = sanitizeOperationsReport(dirty)
    expect(clean.chain.rejectionReasons).toEqual({ zero_bid: 3 })
    expect(clean.provider.apiKey).toBe('[redacted]')
    expect(clean.provider.nested.authToken).toBe('[redacted]')
    expect(clean.failure.stack).toBeUndefined()
    expect(clean.failure.message).toBe('ok to keep a short reason code')
    expect(clean.list[0].password).toBe('[redacted]')
    expect(clean.list[1].fine).toBe(1)
  })

  it('leaves ordinary counts, percentiles and our own reason strings untouched', () => {
    const report = { policyVersion: OPTIONS_OPERATIONS_POLICY_VERSION, quoteAgeMs: { p50: 4000, p90: 12000, count: 9 } }
    expect(sanitizeOperationsReport(report)).toEqual(report)
  })
})

describe('buildOptionsOperationsReport', () => {
  function record(kind, id, payload) {
    return { recordType: kind, recordId: id, payload }
  }

  function scanRecord(overrides = {}) {
    return record('scan', HASH('1'), {
      stage: 'opening', tradingDate: '2026-09-22', status: 'complete',
      scheduledAt: '2026-09-22T13:31:00.000Z', deadlineAt: '2026-09-22T13:35:00.000Z',
      startedAt: '2026-09-22T13:31:05.000Z', endedAt: '2026-09-22T13:33:00.000Z', attempt: 1,
      metrics: { acceptedCount: 2, provider429Count: 1 }, ...overrides,
    })
  }

  function archiveStub({ scanRecords = [scanRecord()], byId = {} } = {}) {
    return {
      list: async (index) => (index === 'options-records:scan' ? scanRecords : []),
      get: async (kind, id) => byId[`${kind}:${id}`] || null,
    }
  }

  function fakeManifest() {
    return {
      manifestId: 'manifest-1', scanId: '2026-09-22:opening:options-morning-schedule-v1',
      publication: { tradingDate: '2026-09-22' },
      storage: { uncompressedBytes: 45000 },
      records: [
        { type: 'chain', kind: 'options-chain', id: HASH('2') },
        { type: 'scenario', kind: 'options-scenario', id: HASH('3') },
        { type: 'decision', kind: 'options-decision', id: HASH('4') },
        { type: 'scan', kind: 'options-scan', id: HASH('5') },
      ],
    }
  }

  it('reports null-state operations honestly when no scan has ever published', async () => {
    const archive = archiveStub({ scanRecords: [] })
    const redis = { get: async () => null }
    const report = await buildOptionsOperationsReport({ archive, redis, latestManifest: async () => null, now: () => Date.parse('2026-09-22T14:00:00.000Z') })
    expect(report.status).toBe('no_published_scan')
    expect(report.policyVersion).toBe(OPTIONS_OPERATIONS_POLICY_VERSION)
    expect(report.scheduleHealth).toBeTruthy()
    expect(report.killSwitchEngaged).toBe(false)
  })

  it('reports killSwitchEngaged from the same key the scheduler itself checks', async () => {
    const archive = archiveStub({ scanRecords: [] })
    const redis = { get: async (key) => (key === OPTIONS_KILL_SWITCH_KEY ? 'maintenance' : null) }
    const report = await buildOptionsOperationsReport({ archive, redis, latestManifest: async () => null, now: () => Date.parse('2026-09-22T14:00:00.000Z') })
    expect(report.killSwitchEngaged).toBe(true)
  })

  it('assembles the full report from already-archived records without any new provider or write call', async () => {
    const manifest = fakeManifest()
    const chainRecord = record('chain', HASH('2'), {
      contracts: [{ quote: { ageMs: 5000 }, skewMs: 1500, analyticsAgeUnknown: false }],
      rejected: [{ reason: 'stale_contract_quote' }],
    })
    const scenarioRecord = record('scenario', HASH('3'), {
      scenarios: [{ calibration: { status: 'calibrated', residual: 0.0004 } }],
    })
    const decisionRecord = record('decision', HASH('4'), { candidates: [{ contractId: 'x' }], rejected: [] })
    const publicationScanRecord = record('scan', HASH('5'), { ...scanRecord({ stage: 'opening', status: 'published' }).payload })
    const premarketScanRecord = record('scan', HASH('8'), {
      stage: 'premarket', tradingDate: '2026-09-22', status: 'complete',
      metrics: { evidenceRecordId: HASH('6'), decisionRecordId: HASH('7'), candidateCount: 1 },
    })
    const evidenceRecord = { payload: { securities: [{ security: { securityId: 'sec-1' }, missing: [] },
      { security: { securityId: 'sec-2' }, missing: [{ path: 'x', reason: 'insufficient_lagged_history' }] }] } }

    // resolvePremarketContext (openingEvidence.js) reads the completion
    // pointer, follows it to the premarket-stage scan record, then reads the
    // evidence/decision records its own metrics name -- mirror that exact
    // chain of archived records rather than a shortcut through it.
    const archive = archiveStub({
      scanRecords: [premarketScanRecord, publicationScanRecord],
      // archive.get is called with the archive KIND (optionsAuditRecord looks
      // it up from OPTIONS_RECORD_TYPES), not the plain record type -- mirror
      // that exactly so this test would catch a real kind/type mismatch.
      byId: {
        [`options-chain:${HASH('2')}`]: chainRecord,
        [`options-scenario:${HASH('3')}`]: scenarioRecord,
        [`options-decision:${HASH('4')}`]: decisionRecord,
        [`options-scan:${HASH('8')}`]: premarketScanRecord,
        [`options-evidence:${HASH('6')}`]: evidenceRecord,
        [`options-decision:${HASH('7')}`]: { payload: { candidates: [{ ticker: 'NVDA' }], rejected: [] } },
      },
    })
    const redis = {
      get: async (key) => {
        if (key === OPTIONS_KILL_SWITCH_KEY) return null
        if (key.includes(':premarket:')) return JSON.stringify({ auditRecordId: HASH('8') })
        return null
      },
    }
    const report = await buildOptionsOperationsReport({
      archive, redis, latestManifest: async () => manifest, watchlistSize: 25,
      now: () => Date.parse('2026-09-22T14:00:00.000Z'),
    })
    expect(report.status).toBe('ok')
    expect(report.manifestId).toBe('manifest-1')
    expect(report.r2UncompressedBytes).toBe(45000)
    expect(report.chainQuality.contractsObserved).toBe(1)
    expect(report.chainQuality.rejectionReasons).toEqual({ stale_contract_quote: 1 })
    expect(report.pricingResiduals.residual.count).toBe(1)
    expect(report.watchlistCoverage).toEqual({ watchlistSize: 25, securitiesObserved: 2, coverageComplete: false, candidateCount: 1 })
    expect(report.missingEvidence.missingByReason).toEqual({ insufficient_lagged_history: 1 })
    expect(report.stageTimings.length).toBeGreaterThanOrEqual(2)
    expect(report.killSwitchEngaged).toBe(false)
    // Structurally safe by construction: nothing here is a vendor message or a stack.
    expect(JSON.stringify(report)).not.toMatch(/at fetch|Error:\s|\.js:\d+:\d+/)
  })

  it('never throws into its caller; a broken archive read degrades to an unavailable report', async () => {
    const archive = { list: async () => { throw new Error('quota exceeded, no retries here') }, get: async () => null }
    const redis = { get: async () => null }
    const report = await buildOptionsOperationsReport({ archive, redis, latestManifest: async () => null, now: () => Date.now() })
    expect(report.status).toBe('unavailable')
    expect(JSON.stringify(report)).not.toMatch(/quota exceeded/)
  })

  it('issues exactly one archive.list call regardless of scan history depth (no polling loop)', async () => {
    let listCalls = 0
    const archive = { list: async () => { listCalls += 1; return [] }, get: async () => null }
    const redis = { get: async () => null }
    await buildOptionsOperationsReport({ archive, redis, latestManifest: async () => null, now: () => Date.now() })
    expect(listCalls).toBe(1)
  })
})

describe('OPTIONS_OPERATIONS_POLICY_VERSION', () => {
  it('is a stable version string', () => {
    expect(typeof OPTIONS_OPERATIONS_POLICY_VERSION).toBe('string')
    expect(OPTIONS_OPERATIONS_POLICY_VERSION.length).toBeGreaterThan(0)
  })
})

describe('schedule policy stages stay the ones this report understands', () => {
  it('covers premarket, opening and the shadow experiment stage', () => {
    expect(Object.keys(OPTIONS_SCHEDULE_POLICY.stages)).toEqual(['premarket', 'opening', 'shadow'])
  })
})
