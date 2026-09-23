import { describe, expect, it, vi } from 'vitest'
import { runOptionsOpeningStage } from './openingEvidence.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'

const SCAN_ID = 'a'.repeat(64)
const DECISION_ID = 'b'.repeat(64)
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
      if (kind === 'options-scan' && id === SCAN_ID) return { payload: { metrics: { decisionRecordId: DECISION_ID } } }
      if (kind === 'options-decision' && id === DECISION_ID) return { payload: { candidates } }
      return null
    }),
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
  return { underlying: { quote: quote('2026-09-22T13:31:00.000Z', 2000) }, contracts, rejected }
}

describe('runOptionsOpeningStage', () => {
  it('reports an honest complete-but-empty result when the premarket shortlist never completed', async () => {
    const result = await runOptionsOpeningStage({ window, deadlineAt: window.deadlineAt, redis: redisStub(null), archive: archiveStub({ candidates: [] }) })
    expect(result).toMatchObject({ status: 'complete', records: [], metrics: { premarketShortlistAvailable: false, securityCount: 0 } })
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
    expect(result.records).toHaveLength(1)
    expect(result.records[0].recordType).toBe('chain')
    expect(result.records[0].payload.contracts).toHaveLength(1)
    expect(result.records[0].payload.underlying).toMatchObject({ securityId: security.securityId, ticker: 'NVDA', direction: 'call' })
    expect(result.metrics).toMatchObject({ acceptedCount: 1, rejectedCount: 0, securityCount: 1, alpacaAvailable: true })
    expect(optionChain).toHaveBeenCalledWith(expect.objectContaining({ type: 'call', expirationDateGte: '2026-09-29', expirationDateLte: '2026-11-21' }))
  })

  it('degrades to an honest unavailable chain record when Alpaca construction throws', async () => {
    const result = await runOptionsOpeningStage({
      window, deadlineAt: window.deadlineAt,
      redis: redisStub({ status: 'complete', auditRecordId: SCAN_ID }),
      archive: archiveStub({ candidates: [candidate()] }),
      createAlpaca: () => { throw new Error('Alpaca data credentials are required') },
    })
    expect(result.status).toBe('complete')
    expect(result.metrics.alpacaAvailable).toBe(false)
    expect(result.records[0].payload.contracts).toHaveLength(0)
    expect(result.records[0].payload.rejected[0]).toMatchObject({ reason: 'alpaca_unavailable' })
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
    expect(optionChain).toHaveBeenCalledTimes(2)
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
  })
})
