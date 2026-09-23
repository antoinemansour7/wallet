// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  compareRevalidatedQuote, createOpeningAuditRecords, createOptionsPublicationAuditRecord,
  OPTIONS_PUBLICATION_POLICY, optionsPublicationSummary, publicationProjection, scoreOpeningChains, scoreOpeningContract,
} from './publication.js'
import { validateOptionsAuditRecord } from './audit.js'

const TRADING_DATE = '2026-09-22'
const AVAILABLE_AT = '2026-09-22T13:32:20.000Z'
const security = { securityId: 'sec:EX', issuerId: 'iss:EX', ticker: 'EX' }

function quote(bid = 5.4, ask = 5.6, marketAt = '2026-09-22T13:32:15.000Z') {
  return { bid, ask, bidSize: 20, askSize: 20, marketAt, ageMs: 2000 }
}

function underlying(bid = 179.9, ask = 180.1, marketAt = '2026-09-22T13:32:16.000Z') {
  return { quote: { bid, ask, marketAt, ageMs: 1000 } }
}

function contract(overrides = {}) {
  return {
    rawId: 'raw-1', contractId: 'osi:EX261016C00185000', osiSymbol: 'EX261016C00185000',
    type: 'call', strikePrice: 185, expirationDate: '2026-10-16', dte: 24, cohort: 'primary',
    openInterest: 1200, openInterestDate: '2026-09-21', quote: quote(),
    volume: { value: 40, session: 'rth', sessionDate: TRADING_DATE }, previousVolume: 800,
    analytics: { impliedVolatility: 0.4, greeks: { delta: 0.42 } },
    fetchedAt: AVAILABLE_AT, rawReferenceHash: 'b'.repeat(64),
    ...overrides,
  }
}

function feature() {
  const raw = { premarketMovePct: 1, return5dPct: 3, return20dPct: 12, relativeStrength20dPct: 8 }
  return {
    recordId: 'a'.repeat(64), featureVersion: 'features-v1', security,
    technicals: { laggedThrough: '2026-09-21', return5dPct: 3, return20dPct: 12, relativeStrength20dPct: 8,
      realizedVolatility20dPct: 30, distanceFromSma20Pct: 4 },
    regime: { score: 8 }, directional: { call: raw, put: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, -value])) },
    events: { earnings: [], dividends: [], catalysts: [] },
    coverage: { earnings: { status: 'complete' }, catalysts: { status: 'complete' } },
    nonEventHorizon: { state: 'eligible', through: '2026-09-27' },
    pricingInputs: { rates: [{ eventId: 'rate', ratePct: 4, asOfDate: '2026-09-21' }] },
  }
}

function evaluated() {
  const entry = { security, direction: 'call', chain: { contracts: [contract()] }, underlying: underlying() }
  return scoreOpeningChains({ entries: [entry], featuresBySecurity: new Map([[security.securityId, feature()]]), tradingDate: TRADING_DATE })
}

describe('quote revalidation', () => {
  it('records small changes without calling them material', () => {
    expect(compareRevalidatedQuote(contract(), contract({ quote: quote(5.42, 5.62) }), underlying(), underlying(179.95, 180.15))).toMatchObject({
      material: false, reasons: [],
    })
  })

  it('flags material option and underlying changes with reproducible measurements', () => {
    const result = compareRevalidatedQuote(contract(), contract({ quote: quote(5.8, 6.2) }), underlying(), underlying(181.9, 182.1))
    expect(result.material).toBe(true)
    expect(result.reasons).toEqual(expect.arrayContaining(['mid_changed', 'spread_changed', 'underlying_changed']))
    expect(result.midChangePct).toBeGreaterThan(8)
  })
})

describe('opening publication records', () => {
  it('chooses the latest visible dated rate independently of array order', () => {
    const record = feature()
    const newer = { eventId: 'newer', ratePct: 3, asOfDate: '2026-09-22', availableAt: '2026-09-22T12:00:00.000Z' }
    const future = { eventId: 'future', ratePct: 10, asOfDate: '2026-09-23' }
    const unavailable = { eventId: 'unavailable', ratePct: 9, asOfDate: '2026-09-22', availableAt: '2026-09-22T15:00:00.000Z' }
    record.pricingInputs.rates = [newer, ...record.pricingInputs.rates, future, unavailable]
    const run = () => scoreOpeningContract({ security, direction: 'call', contract: contract(), underlying: underlying(), feature: record, tradingDate: TRADING_DATE })
    expect(run().scenario.rateAssumption).toMatchObject({ value: 0.03, source: 'feature:newer', fallback: false })
    record.pricingInputs.rates.reverse()
    expect(run().scenario.rateAssumption.value).toBe(0.03)
  })

  it('rechecks quote gates even when passed an already flattened contract', () => {
    const stale = contract({ quote: { ...quote(), ageMs: null } })
    const result = scoreOpeningContract({ security, direction: 'call', contract: stale, underlying: underlying(), feature: feature(), tradingDate: TRADING_DATE })
    expect(result.score.status).toBe('ineligible')
    expect(result.score.blockers).toContainEqual({ code: 'hard_gate_failed', detail: 'stale_contract_quote' })
  })
  it('scores the ranking profile and emits complete immutable lineage', () => {
    const result = evaluated()
    expect(result.ranking.displayed).toHaveLength(1)
    expect(result.scenarios[0]).toMatchObject({ purpose: 'ranking', contractId: contract().contractId })
    const observations = new Map([[contract().contractId, { contract: contract(), underlying: underlying(), revalidation: { status: 'confirmed' } }]])
    const records = createOpeningAuditRecords({
      scanId: `${TRADING_DATE}:opening:policy`, tradingDate: TRADING_DATE, availableAt: AVAILABLE_AT,
      ranking: result.ranking, scenarios: result.scenarios,
      chainRecordIds: ['c'.repeat(64)], premarketRecordIds: ['d'.repeat(64)], observations,
    })
    for (const record of Object.values(records)) expect(validateOptionsAuditRecord(record)).toBe(record)
    expect(records.publicationRecord.payload).toMatchObject({
      state: 'theoretical', observationMode: 'theoretical', completeness: 'complete', result: 'candidates',
      selected: [expect.objectContaining({ contractId: contract().contractId, quoteMarketAt: '2026-09-22T13:32:15.000Z' })],
    })
    expect(records.publicationRecord.payload.lineage).toMatchObject({
      scenarioRecordId: records.scenarioRecord.recordId,
      scoreRecordId: records.scoreRecord.recordId,
      decisionRecordId: records.decisionRecord.recordId,
    })
  })

  it('publishes an all-rejected result as valid empty rather than unavailable', () => {
    const ranking = { ...evaluated().ranking, ranked: [], displayed: [], suppressed: [], ineligible: [],
      metrics: { scoredCount: 0, ineligibleCount: 0, displayedCount: 0, suppressedCount: 0, topScore: null, blockerCodes: [] } }
    const records = createOpeningAuditRecords({
      scanId: 'empty', tradingDate: TRADING_DATE, availableAt: AVAILABLE_AT, ranking, scenarios: [],
    })
    expect(records.publicationRecord.payload).toMatchObject({ state: 'empty', result: 'empty' })
  })

  it('supports a separately entitled live-at-scan publication state', () => {
    const result = evaluated()
    const observations = new Map([[contract().contractId, { contract: contract(), underlying: underlying(), revalidation: { status: 'confirmed' } }]])
    const record = createOptionsPublicationAuditRecord({
      scanId: 'live', tradingDate: TRADING_DATE, availableAt: AVAILABLE_AT,
      ranking: result.ranking, observations, lineage: {},
      policy: { ...OPTIONS_PUBLICATION_POLICY, observationMode: 'live_at_scan' },
    })
    expect(record.payload.state).toBe('live_at_scan')
  })
})

describe('time-driven response states', () => {
  const record = () => {
    const result = evaluated()
    const observations = new Map([[contract().contractId, { contract: contract(), underlying: underlying() }]])
    return createOpeningAuditRecords({ scanId: 'scan', tradingDate: TRADING_DATE, availableAt: AVAILABLE_AT,
      ranking: result.ranking, scenarios: result.scenarios, observations }).publicationRecord
  }

  it('becomes stale from timestamps without rewriting the publication', () => {
    const publication = publicationProjection(record())
    const manifest = { manifestId: 'f'.repeat(64), publication }
    expect(optionsPublicationSummary(manifest, '2026-09-22T13:32:20.000Z').state).toBe('theoretical')
    expect(optionsPublicationSummary(manifest, '2026-09-22T13:33:00.000Z').state).toBe('stale')
  })

  it('does not label the prior session as today and distinguishes a closed day', () => {
    const manifest = { manifestId: 'f'.repeat(64), publication: publicationProjection(record()) }
    expect(optionsPublicationSummary(manifest, '2026-09-23T14:00:00.000Z')).toMatchObject({ state: 'unavailable', reason: 'no_scan_for_current_session' })
    expect(optionsPublicationSummary(manifest, '2026-09-26T14:00:00.000Z')).toMatchObject({ state: 'closed' })
  })
})
