import { describe, expect, it, vi } from 'vitest'
import { runOptionsPremarketStage } from './premarketEvidence.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'

const window = { stage: 'premarket', tradingDate: '2026-09-22', deadlineAt: '2026-09-22T13:20:00.000Z', policyVersion: 'options-morning-schedule-v1' }

function alpacaSnapshotFor(securities) {
  return {
    observations: securities.map((s) => ({
      securityId: s.securityId, fetchedAt: '2026-09-22T13:16:00.000Z', pricingReady: true,
      quote: { bid: 99.9, ask: 100.1, marketAt: '2026-09-22T13:15:59.000Z' },
    })),
  }
}

function alpacaBarsFor(securities) {
  const dates = ['2026-08-24', '2026-08-25']
  return {
    observations: securities.flatMap((s) => dates.map((date) => ({
      securityId: s.securityId, issuerId: s.issuerId, ticker: s.ticker, date, close: 100 + dates.indexOf(date),
      availableAt: '2026-09-21T20:00:00.000Z', source: { provider: 'alpaca', licenseId: 'alpaca-basic-indicative', url: 'https://data.alpaca.markets/v2/stocks/bars' },
    }))),
  }
}

function stubAlpaca() {
  return () => ({
    underlyingSnapshots: vi.fn(async (securities) => alpacaSnapshotFor(securities)),
    stockBars: vi.fn(async (securities) => alpacaBarsFor(securities)),
  })
}

describe('runOptionsPremarketStage', () => {
  it('produces a complete, frozen shortlist from live-shaped inputs', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const saveCheckpoint = vi.fn()
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: null, saveCheckpoint, archive,
      createAlpaca: stubAlpaca(),
      fetchRegime: async () => ({ asOf: '2026-09-22', score: 7, label: 'constructive' }),
      loadMaster: async () => ({ resolve: () => [] }), // no SEC master populated: sec/catalysts stay empty, honestly
      createSec: () => ({ request: vi.fn() }),
    })
    expect(result.status).toBe('complete')
    expect(result.records).toHaveLength(3)
    expect(result.records.map((r) => r.recordType).sort()).toEqual(['decision', 'evidence', 'score'])
    expect(result.metrics.candidateCount).toBeGreaterThan(0)
    expect(result.metrics.candidateCount).toBeLessThanOrEqual(10)
    expect(result.metrics.alpacaAvailable).toBe(true)
    expect(result.metrics.regimeAvailable).toBe(true)
    const decision = result.records.find((r) => r.recordType === 'decision')
    const accounted = [...decision.payload.candidates.map((c) => c.ticker), ...decision.payload.rejected.map((r) => r.ticker)]
    expect(new Set(accounted)).toEqual(new Set(OPTIONS_WATCHLIST_SNAPSHOT.securities.map((s) => s.ticker)))
  })

  it('degrades gracefully when Alpaca construction throws (missing credentials)', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: null, saveCheckpoint: vi.fn(), archive,
      createAlpaca: () => { throw new Error('Alpaca data credentials are required') },
      fetchRegime: async () => null,
      loadMaster: async () => ({ resolve: () => [] }),
      createSec: () => ({ request: vi.fn() }),
    })
    expect(result.status).toBe('complete')
    expect(result.metrics.alpacaAvailable).toBe(false)
    const decision = result.records.find((r) => r.recordType === 'decision')
    expect(decision.payload.candidates).toHaveLength(0)
    expect(decision.payload.rejected.every((r) => r.status === 'unavailable' && r.reason === 'no_premarket_price')).toBe(true)
  })

  it('passes prior checkpoint completion into the SEC gatherer and threads the result back out', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const gatherSec = vi.fn(async ({ completed }) => {
      expect(completed).toEqual(['cik:0000320193'])
      return { secItems: [], catalystItems: [], completed: ['cik:0000320193', 'cik:0000789019'] }
    })
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: { secCompleted: ['cik:0000320193'] }, saveCheckpoint: vi.fn(), archive,
      createAlpaca: stubAlpaca(), fetchRegime: async () => null, loadMaster: async () => ({ resolve: () => [] }),
      createSec: () => ({ request: vi.fn() }), gatherSec,
    })
    expect(result.metrics.secCompletedCount).toBe(2)
  })
})
