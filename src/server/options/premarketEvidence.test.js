import { describe, expect, it, vi } from 'vitest'
import { runOptionsPremarketStage } from './premarketEvidence.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'

vi.mock('./eventEvidence.js', () => ({ gatherOptionsEventEvidence: async () => ({ earnings: [], news: [], coverage: {}, metrics: {} }) }))

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
  it('sums provider request diagnostics from both Alpaca calls into the stage metrics (#215)', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const createAlpaca = () => ({
      underlyingSnapshots: vi.fn(async (securities) => ({ ...alpacaSnapshotFor(securities), requestCount: 1, pageCounts: {}, diagnostics: [{ status: 200 }] })),
      stockBars: vi.fn(async (securities) => ({ ...alpacaBarsFor(securities), requestCount: 1, pageCounts: { bars: 1 }, diagnostics: [{ status: 429 }, { status: 200 }] })),
    })
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: null, saveCheckpoint: vi.fn(), archive,
      createAlpaca,
      fetchRegime: async () => ({ asOf: '2026-09-22', score: 7, label: 'constructive' }),
      loadMaster: async () => ({ resolve: () => [] }),
      createSec: () => ({ request: vi.fn() }),
    })
    expect(result.status).toBe('complete')
    expect(result.metrics).toMatchObject({ providerRequestCount: 2, providerPagesFetched: 1, provider429Count: 1, providerServerErrorCount: 0 })
  })

  it('produces a complete, frozen shortlist from live-shaped inputs', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const saveCheckpoint = vi.fn()
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: null, saveCheckpoint, archive,
      now: () => '2026-09-22T13:10:00.000Z',
      createAlpaca: stubAlpaca(),
      fetchRegime: async () => ({ asOf: '2026-09-22', score: 7, label: 'constructive' }),
      loadMaster: async () => ({ resolve: () => [] }), // no SEC master populated: sec/catalysts stay empty, honestly
      createSec: () => ({ request: vi.fn() }),
    })
    expect(result.status).toBe('complete')
    expect(result.records).toHaveLength(3)
    expect(result.records.map((r) => r.recordType).sort()).toEqual(['decision', 'evidence', 'score'])
    expect(result.metrics.candidateCount).toBeGreaterThan(0)
    expect(result.metrics.candidateCount).toBeLessThanOrEqual(15)
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

  it('threads the market regime into every security\'s score, not a single observation matching nothing', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: null, saveCheckpoint: vi.fn(), archive,
      createAlpaca: stubAlpaca(),
      fetchRegime: async () => ({ asOf: '2026-09-22', score: 9, label: 'constructive' }),
      loadMaster: async () => ({ resolve: () => [] }),
      createSec: () => ({ request: vi.fn() }),
      now: () => '2026-09-22T13:10:00.000Z',
    })
    const scoreRecord = result.records.find((r) => r.recordType === 'score')
    const regimeEvidence = scoreRecord.payload.scores
      .flatMap((entry) => entry.scores)
      .flatMap((score) => score.components)
      .filter((component) => component.component === 'underlyingSetup')
      .flatMap((component) => component.evidence)
      .find((item) => item.feature === 'regimeScore')
    expect(regimeEvidence.raw).toBe(9)
    expect(regimeEvidence.points).toBeGreaterThan(0)
  })

  it('excludes a security for a catalyst before the actual three-session exit', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const sandisk = OPTIONS_WATCHLIST_SNAPSHOT.securities.find((s) => s.ticker === 'SNDK')
    const gatherSec = vi.fn(async () => ({
      secItems: [],
      catalystItems: [{
        eventId: 'test-catalyst-1', issuerId: sandisk.issuerId, ticker: sandisk.ticker, eventDate: '2026-09-24',
        kind: 'sec_8k', label: '8-K filing', publicAt: '2026-09-22T12:00:00.000Z', availableAt: '2026-09-22T13:10:00.000Z',
        source: { provider: 'sec', licenseId: 'sec-edgar-public', url: 'https://data.sec.gov/submissions/CIK0000320193.json' },
      }],
      completed: [],
    }))
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: null, saveCheckpoint: vi.fn(), archive,
      createAlpaca: stubAlpaca(), fetchRegime: async () => null, loadMaster: async () => ({ resolve: () => [] }),
      createSec: () => ({ request: vi.fn() }), gatherSec,
    })
    const decision = result.records.find((r) => r.recordType === 'decision')
    expect(decision.payload.rejected.find((r) => r.ticker === 'SNDK')).toMatchObject({ status: 'rejected', reason: 'known_event_in_holding_window' })
  })

  it('keeps successfully fetched underlying prices when the separate bars fetch fails', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const createAlpaca = () => ({
      underlyingSnapshots: vi.fn(async (securities) => alpacaSnapshotFor(securities)),
      stockBars: vi.fn(async () => { throw new Error('bars endpoint rate limited') }),
    })
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: null, saveCheckpoint: vi.fn(), archive,
      createAlpaca, fetchRegime: async () => null, loadMaster: async () => ({ resolve: () => [] }),
      createSec: () => ({ request: vi.fn() }),
    })
    const decision = result.records.find((r) => r.recordType === 'decision')
    const accounted = [...decision.payload.candidates, ...decision.payload.rejected]
    expect(accounted.some((r) => r.reason === 'no_premarket_price')).toBe(false)
    expect(result.metrics.underlyingAvailable).toBe(true)
    expect(result.metrics.barsAvailable).toBe(false)
  })

  it('reports sec coverage as unavailable, not unknown, when the security master has nothing resolvable', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: null, saveCheckpoint: vi.fn(), archive,
      createAlpaca: stubAlpaca(), fetchRegime: async () => null,
      loadMaster: async () => ({ resolve: () => [] }), // unresolved master — Review Focus item 5
      createSec: () => ({ request: vi.fn() }),
    })
    const evidence = result.records.find((r) => r.recordType === 'evidence')
    const coverages = evidence.payload.securities.map((record) => record.coverage.sec.status)
    expect(coverages.every((status) => status === 'unavailable')).toBe(true)
  })
})
