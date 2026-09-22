// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'
import {
  OPTIONS_FEATURE_SOURCE_POLICY,
  attachOptionsNarrative,
  createOptionsFeatureAuditRecord,
  createOptionsFeatureSnapshot,
  planCurrentDaySecRefresh,
} from './features.js'

const replay = JSON.parse(readFileSync(new URL('./fixtures/features/replay.json', import.meta.url)))
const securities = OPTIONS_WATCHLIST_SNAPSHOT.securities
const nvda = securities.find((item) => item.ticker === 'NVDA')
const spcx = securities.find((item) => item.ticker === 'SPCX')
const fixture = (feed) => ({ provider: 'fixture', licenseId: 'test-fixture', url: `https://example.test/${feed}` })
const alpaca = { provider: 'alpaca', licenseId: 'alpaca-basic-indicative', url: 'https://data.alpaca.markets/v2/stocks/snapshots' }

function datedBars(securityId, base, count = 25) {
  return Array.from({ length: count }, (_, index) => ({
    securityId,
    date: new Date(Date.UTC(2026, 7, 28 + index)).toISOString().slice(0, 10),
    close: base + index,
    availableAt: new Date(Date.UTC(2026, 7, 28 + index, 21)).toISOString(),
    source: alpaca,
  }))
}

const rates = [{
  eventId: 'sofr-2026-09-21', tenor: 'overnight', ratePct: 4.1, asOfDate: '2026-09-21',
  availableAt: '2026-09-22T12:00:00.000Z', source: fixture('rates'),
}]

const completeCoverage = Object.fromEntries(Object.keys(OPTIONS_FEATURE_SOURCE_POLICY.feeds).map((feed) => [feed, {
  status: 'complete',
  asOf: '2026-09-22T12:45:00.000Z',
  source: feed === 'underlying' || feed === 'bars' ? alpaca
    : feed === 'sec' ? { provider: 'sec', licenseId: 'sec-edgar-public', url: 'https://www.sec.gov/edgar/search/' }
      : fixture(feed),
}]))

function inputs(overrides = {}) {
  const sameDay = { securityId: nvda.securityId, date: '2026-09-22', close: 999, availableAt: '2026-09-22T12:30:00.000Z', source: alpaca }
  return {
    bars: [...datedBars(nvda.securityId, 100), ...datedBars('benchmark:SPY', 400), ...datedBars(spcx.securityId, 50, 2), sameDay],
    underlyings: [{ securityId: nvda.securityId, price: 126, marketAt: '2026-09-22T12:44:59.000Z', availableAt: '2026-09-22T12:45:00.000Z', pricingReady: true, source: alpaca }],
    news: replay.news,
    sec: replay.sec,
    analyst: [],
    earnings: replay.earnings,
    dividends: [{ eventId: 'nvda-dividend', securityId: nvda.securityId, exDate: '2026-10-01', paymentDate: '2026-10-23', amount: 0.01, currency: 'USD', availableAt: '2026-09-21T12:00:00.000Z', source: fixture('dividends') }],
    rates,
    catalysts: [],
    regime: [{ eventId: 'regime-2026-09-22', score: 6.2, label: 'constructive', availableAt: '2026-09-22T12:40:00.000Z', source: fixture('regime') }],
    ...overrides,
  }
}

function snapshot(overrides = {}) {
  return createOptionsFeatureSnapshot({
    securities,
    tradingDate: '2026-09-22',
    freezeAt: '2026-09-22T13:00:00.000Z',
    inputs: inputs(),
    coverage: completeCoverage,
    nonEventHoldingDays: 10,
    mode: 'replay',
    ...overrides,
  })
}

describe('point-in-time options features', () => {
  it('always emits a sourced feature record for all 25 securities and reports sparse history', () => {
    const result = snapshot()
    expect(result.securities).toHaveLength(25)
    expect(new Set(result.securities.map((item) => item.security.securityId)).size).toBe(25)
    expect(result.snapshotId).toMatch(/^[a-f0-9]{64}$/)

    const sparse = result.securities.find((item) => item.security.securityId === spcx.securityId)
    expect(sparse.technicals).toMatchObject({ historySessions: 2, return5dPct: null, return20dPct: null, realizedVolatility20dPct: null })
    expect(sparse.missing).toContainEqual({ path: 'technicals.realizedVolatility20dPct', reason: 'insufficient_lagged_history' })
    expect(sparse.nonEventHorizon.state).toBe('eligible')
  })

  it('uses only bars from prior sessions and creates exactly mirrored call and put direction features', () => {
    const record = snapshot().securities.find((item) => item.security.securityId === nvda.securityId)
    expect(record.underlying).toMatchObject({ previousClose: 124, premarketPrice: 126 })
    expect(record.underlying.premarketMovePct).toBeCloseTo(1.612903, 6)
    expect(record.technicals.laggedThrough).toBe('2026-09-21')
    expect(record.technicals.return20dPct).toBeCloseTo(19.230769, 6)
    for (const key of Object.keys(record.directional.call)) {
      expect(record.directional.put[key]).toBeCloseTo(-record.directional.call[key], 8)
    }
  })

  it('separates publication from availability and replays revised event knowledge at each freeze', () => {
    const early = snapshot()
    const later = snapshot({ freezeAt: '2026-09-22T14:30:00.000Z' })
    const earlyNvda = early.securities.find((item) => item.security.securityId === nvda.securityId)
    const laterNvda = later.securities.find((item) => item.security.securityId === nvda.securityId)

    expect(earlyNvda.evidence.news.map((item) => item.eventId)).toEqual(['news-overnight'])
    expect(laterNvda.evidence.news.map((item) => item.eventId)).toEqual(['news-overnight', 'news-late'])
    expect(laterNvda.evidence.news[1]).toMatchObject({ publishedAt: '2026-09-22T12:00:00.000Z', availableAt: '2026-09-22T14:00:00.000Z' })
    expect(earlyNvda.events.earnings[0]).toMatchObject({ eventDate: '2026-09-30', timing: 'before_open' })
    expect(laterNvda.events.earnings[0]).toMatchObject({ eventDate: '2026-10-02', timing: 'after_close', supersedesRevisionId: 'prior-revision' })
    expect(earlyNvda.recordId).not.toBe(laterNvda.recordId)
  })

  it('includes overnight and current-day SEC evidence only after it was observed', () => {
    const before = snapshot({ freezeAt: '2026-09-22T11:04:59.000Z' })
    const after = snapshot({ freezeAt: '2026-09-22T11:05:00.000Z' })
    expect(before.securities.find((item) => item.security.securityId === nvda.securityId).evidence.sec).toEqual([])
    expect(after.securities.find((item) => item.security.securityId === nvda.securityId).evidence.sec[0]).toMatchObject({
      documentId: 'sec-current-day', publicAt: '2026-09-22T11:00:00.000Z', availableAt: '2026-09-22T11:05:00.000Z',
    })
  })

  it('enforces known event exclusions and treats an unavailable feed as unknown rather than no catalyst', () => {
    const record = snapshot().securities.find((item) => item.security.securityId === nvda.securityId)
    expect(record.nonEventHorizon).toMatchObject({ state: 'excluded', through: '2026-10-02' })
    expect(record.nonEventHorizon.reasons).toContainEqual({ type: 'earnings', eventId: 'nvda-q3', date: '2026-09-30' })

    const outageCoverage = structuredClone(completeCoverage)
    outageCoverage.earnings = { status: 'unavailable', reason: 'provider_outage', source: fixture('earnings') }
    const outage = snapshot({ inputs: inputs({ earnings: [] }), coverage: outageCoverage })
    const outageRecord = outage.securities.find((item) => item.security.securityId === nvda.securityId)
    expect(outageRecord.nonEventHorizon).toMatchObject({ state: 'unknown' })
    expect(outageRecord.nonEventHorizon.reasons).toContainEqual({ type: 'coverage', feed: 'earnings', status: 'unavailable' })
  })

  it('keeps scheduled dividends and dated rates as frozen pricing inputs', () => {
    const record = snapshot().securities.find((item) => item.security.securityId === nvda.securityId)
    expect(record.events.dividends[0]).toMatchObject({ exDate: '2026-10-01', paymentDate: '2026-10-23', amount: 0.01, currency: 'USD' })
    expect(record.pricingInputs.rates[0]).toMatchObject({ tenor: 'overnight', ratePct: 4.1, asOfDate: '2026-09-21' })
  })

  it('plans a current-day SEC refresh by issuer and supports a newly added issuer identity', () => {
    const newSecurity = { ticker: 'NEW', securityId: 'wallai:security:new:common', issuerId: 'wallai:issuer:new', secIssuerId: 'cik:0000000123' }
    const plan = planCurrentDaySecRefresh({
      securities: [nvda, newSecurity],
      freezeAt: '2026-09-22T13:00:00.000Z',
      completed: [],
    })
    expect(plan.requests).toEqual([{ secIssuerId: 'cik:0000000123', issuerId: newSecurity.issuerId, ticker: 'NEW', through: '2026-09-22T13:00:00.000Z', reason: 'current_day_refresh_required' }])
    expect(plan.unresolved).toContainEqual({ securityId: nvda.securityId, issuerId: nvda.issuerId, ticker: 'NVDA', reason: 'sec_identity_unresolved' })
  })

  it('does not let an optional narrative failure alter or block deterministic facts', async () => {
    const record = snapshot().securities.find((item) => item.security.securityId === nvda.securityId)
    const generate = vi.fn().mockRejectedValue(new Error('max_output_tokens'))
    const result = await attachOptionsNarrative(record, generate)
    expect(result.record).toBe(record)
    expect(result.narrative).toBeNull()
    expect(result.diagnostic).toEqual({ code: 'narrative_unavailable', message: 'max_output_tokens' })
  })

  it('rejects unlicensed or unattributed provider observations', () => {
    expect(() => snapshot({ inputs: inputs({ news: [{ ...replay.news[0], source: { provider: 'scraper', licenseId: 'unknown', url: 'https://example.test' } }] }) }))
      .toThrow('news observation source is not allowed')
  })

  it('archives the frozen batch through the existing options evidence envelope', () => {
    const result = snapshot()
    const audit = createOptionsFeatureAuditRecord({ snapshot: result, scanId: 'scan-206-fixture' })
    expect(audit).toMatchObject({
      recordType: 'evidence',
      archiveKind: 'options-evidence',
      scanId: 'scan-206-fixture',
      payload: { snapshotId: result.snapshotId, securities: result.securities },
    })
    expect(audit.recordId).toMatch(/^[a-f0-9]{64}$/)
  })

  it('never permits replay fixtures in live feature snapshots', () => {
    expect(() => snapshot({ mode: 'live' })).toThrow('Fixture observations are only allowed in replay mode')
  })
})
