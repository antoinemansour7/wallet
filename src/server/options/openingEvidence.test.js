import { describe, expect, it, vi } from 'vitest'
import { runOptionsOpeningStage } from './openingEvidence.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'

const SCAN_ID = 'a'.repeat(64)
const DECISION_ID = 'b'.repeat(64)
const EVIDENCE_ID = 'c'.repeat(64)
const security = OPTIONS_WATCHLIST_SNAPSHOT.securities.find((s) => s.ticker === 'NVDA')

const window = { stage: 'opening', tradingDate: '2026-09-22', deadlineAt: '2026-09-22T13:35:00.000Z', policyVersion: 'options-morning-schedule-v1' }

function candidate(overrides = {}) {
  return { securityId: security.securityId, ticker: security.ticker, direction: 'call', score: 20, ...overrides }
}

function redisStub(completion) {
  return { get: vi.fn(async () => (completion ? JSON.stringify(completion) : null)) }
}

function archiveStub({ candidates }) {
  return {
    get: vi.fn(async (kind, id) => {
      if (kind === 'options-scan' && id === SCAN_ID) return { payload: { metrics: { decisionRecordId: DECISION_ID, evidenceRecordId: EVIDENCE_ID } } }
      if (kind === 'options-decision' && id === DECISION_ID) return { payload: { candidates } }
      if (kind === 'options-evidence' && id === EVIDENCE_ID) return { payload: { securities: [featureRecord()] } }
      return null
    }),
  }
}

function featureRecord() {
  const directional = { premarketMovePct: 1, return5dPct: 3, return20dPct: 8, relativeStrength20dPct: 6 }
  return {
    recordId: 'd'.repeat(64), featureVersion: 'features-v1', security,
    technicals: { laggedThrough: '2026-09-21', return5dPct: 3, return20dPct: 8, relativeStrength20dPct: 6,
      realizedVolatility20dPct: 30, distanceFromSma20Pct: 3 },
    regime: { score: 8 }, directional: { call: directional, put: Object.fromEntries(Object.entries(directional).map(([key, value]) => [key, -value])) },
    events: { earnings: [], dividends: [], catalysts: [] },
    coverage: { earnings: { status: 'complete' }, catalysts: { status: 'complete' } },
    nonEventHorizon: { state: 'eligible', through: '2026-09-27' }, pricingInputs: { rates: [] },
  }
}

function quote(marketAt, ageMs = 5000) {
  return { bid: 2, ask: 2.1, bidSize: 5, askSize: 5, marketAt, ageMs }
}

function alpacaContract(overrides = {}) {
  return {
    rawId: 'raw-1', contractId: 'osi:NVDA261016C00500000', osiSymbol: 'NVDA261016C00500000', type: 'call',
    strikePrice: 500, expirationDate: '2026-10-16',
    quote: quote('2026-09-22T13:31:02.000Z'),
    trade: null,
    volume: { value: 10, session: 'rth', sessionDate: '2026-09-22' },
    previousDailyBar: null,
    openInterest: { value: 200, asOfDate: '2026-09-19' },
    analytics: { greeks: { delta: 0.35 }, age: 'unknown' },
    fetchedAt: '2026-09-22T13:31:31.000Z',
    rawReferenceHash: 'hash-1',
    ...overrides,
  }
}

function chainObservation({ contracts = [alpacaContract()], rejected = [] } = {}) {
  return { underlying: { quote: { ...quote('2026-09-22T13:31:00.000Z', 2000), bid: 499.9, ask: 500.1 } }, contracts, rejected }
}

describe('runOptionsOpeningStage', () => {
  it('blocks publication when the premarket shortlist never completed', async () => {
    const result = await runOptionsOpeningStage({ window, deadlineAt: window.deadlineAt, redis: redisStub(null), archive: archiveStub({ candidates: [] }) })
    expect(result).toMatchObject({ status: 'incomplete', reason: 'premarket_stage_unavailable', records: [], metrics: { premarketShortlistAvailable: false, securityCount: 0 } })
  })

  it('produces a chain record with the shortlist candidate accepted', async () => {
    const optionChain = vi.fn(async () => chainObservation())
    const result = await runOptionsOpeningStage({
      window, deadlineAt: window.deadlineAt,
      redis: redisStub({ status: 'complete', auditRecordId: SCAN_ID }),
      archive: archiveStub({ candidates: [candidate()] }),
      createAlpaca: () => ({ optionChain }),
    })
    expect(result.status).toBe('complete')
    expect(result.records.filter((record) => record.recordType === 'chain')).toHaveLength(2)
    expect(result.records[0].payload.contracts).toHaveLength(1)
    expect(result.records[0].payload.underlying).toMatchObject({ securityId: security.securityId, ticker: 'NVDA', direction: 'call' })
    expect(result.records.at(-1).payload).toMatchObject({ state: 'theoretical', result: 'candidates' })
    expect(result.metrics).toMatchObject({ acceptedCount: 1, rejectedCount: 0, securityCount: 1, alpacaAvailable: true, selectedCount: 1 })
    expect(optionChain).toHaveBeenCalledWith(expect.objectContaining({ type: 'call', expirationDateGte: '2026-09-29', expirationDateLte: '2026-11-21' }))
  })

  it('sums provider request diagnostics across every optionChain call into the stage metrics (#215)', async () => {
    const optionChain = vi.fn(async () => ({
      ...chainObservation(),
      requestCount: 2, pageCounts: { metadata: 1, snapshots: 1 },
      diagnostics: [{ status: 429 }, { status: 200 }],
    }))
    const result = await runOptionsOpeningStage({
      window, deadlineAt: window.deadlineAt,
      redis: redisStub({ status: 'complete', auditRecordId: SCAN_ID }),
      archive: archiveStub({ candidates: [candidate()] }),
      createAlpaca: () => ({ optionChain }),
    })
    expect(result.status).toBe('complete')
    // One optionChain() call for the initial fetch and one more for the
    // single selected contract's prepublication revalidation pass -- both
    // are real provider traffic for this stage attempt, so both count.
    expect(optionChain).toHaveBeenCalledTimes(2)
    expect(result.metrics).toMatchObject({ providerRequestCount: 4, providerPagesFetched: 4, provider429Count: 2, providerServerErrorCount: 0, revalidationFailedCount: 0 })
  })

  it('blocks publication when opening data is unavailable', async () => {
    const result = await runOptionsOpeningStage({
      window, deadlineAt: window.deadlineAt,
      redis: redisStub({ status: 'complete', auditRecordId: SCAN_ID }),
      archive: archiveStub({ candidates: [candidate()] }),
      createAlpaca: () => { throw new Error('Alpaca data credentials are required') },
    })
    expect(result.status).toBe('incomplete')
    expect(result.reason).toBe('opening_chain_unavailable')
    expect(result.metrics.alpacaAvailable).toBe(false)
    expect(result.records).toEqual([])
  })

  it('retries a contract still pending regular-open timing, then accepts it once fresh', async () => {
    const stillOpening = chainObservation({ contracts: [alpacaContract({ quote: quote('2026-09-22T13:15:00.000Z') })] })
    const nowOpen = chainObservation()
    const optionChain = vi.fn().mockResolvedValueOnce(stillOpening).mockResolvedValueOnce(nowOpen)
    const sleep = vi.fn(async () => {})
    const result = await runOptionsOpeningStage({
      window, deadlineAt: window.deadlineAt,
      redis: redisStub({ status: 'complete', auditRecordId: SCAN_ID }),
      archive: archiveStub({ candidates: [candidate()] }),
      createAlpaca: () => ({ optionChain }),
      sleep, retryDelayMs: 1000, now: () => Date.parse('2026-09-22T13:31:32.000Z'),
    })
    expect(optionChain).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(result.records[0].payload.contracts).toHaveLength(1)
    expect(result.metrics.retriedCount).toBe(1)
  })

  it('reports a contract still pending at the deadline as rejected, not silently dropped', async () => {
    const stillOpening = chainObservation({ contracts: [alpacaContract({ quote: quote('2026-09-22T13:15:00.000Z') })] })
    const optionChain = vi.fn(async () => stillOpening)
    const result = await runOptionsOpeningStage({
      window, deadlineAt: window.deadlineAt,
      redis: redisStub({ status: 'complete', auditRecordId: SCAN_ID }),
      archive: archiveStub({ candidates: [candidate()] }),
      createAlpaca: () => ({ optionChain }),
      sleep: vi.fn(async () => {}), retryDelayMs: 1000, maxRetries: 1, now: () => Date.parse('2026-09-22T13:31:32.000Z'),
    })
    expect(optionChain).toHaveBeenCalledTimes(2)
    expect(result.records[0].payload.contracts).toHaveLength(0)
    expect(result.records[0].payload.rejected[0]).toMatchObject({ reason: 'series_not_yet_open' })
    expect(result.records.at(-1).payload).toMatchObject({ state: 'empty', result: 'empty' })
  })

  it('recomputes a selected contract when its final quote changes materially', async () => {
    const initial = chainObservation()
    const changed = chainObservation({ contracts: [alpacaContract({
      quote: { bid: 2.4, ask: 2.5, bidSize: 5, askSize: 5, marketAt: '2026-09-22T13:32:02.000Z', ageMs: 1000 },
    })] })
    changed.underlying.quote.marketAt = '2026-09-22T13:32:01.000Z'
    const optionChain = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(changed)
    const result = await runOptionsOpeningStage({
      window, deadlineAt: window.deadlineAt,
      redis: redisStub({ status: 'complete', auditRecordId: SCAN_ID }), archive: archiveStub({ candidates: [candidate()] }),
      createAlpaca: () => ({ optionChain }), now: () => Date.parse('2026-09-22T13:32:03.000Z'),
    })
    const publication = result.records.at(-1).payload
    expect(publication.selected[0]).toMatchObject({
      observedMid: 2.45,
      revalidation: { status: 'recomputed_material_change', comparison: { material: true } },
    })
    expect(result.records.find((record) => record.recordType === 'score').payload.scores[0].tieBreakers.spreadPct).toBeCloseTo(4.0816, 4)
  })

  it('publishes a valid empty revision when the completed shortlist has no candidates', async () => {
    const result = await runOptionsOpeningStage({
      window, deadlineAt: window.deadlineAt,
      redis: redisStub({ status: 'complete', auditRecordId: SCAN_ID }), archive: archiveStub({ candidates: [] }),
    })
    expect(result.status).toBe('complete')
    expect(result.records.filter((record) => record.recordType === 'chain')).toHaveLength(0)
    expect(result.records.at(-1).payload).toMatchObject({ state: 'empty', result: 'empty' })
  })
})
