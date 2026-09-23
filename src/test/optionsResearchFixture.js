// Synthetic archived evidence, priced and scored by the production engines.
// Shared by integration tests and the local rendered review, never production.
import { createOptionsAuditRecord } from '../server/options/audit.js'
import { createOpeningAuditRecords, scoreOpeningContract } from '../server/options/publication.js'
import { rankOptionsScores } from '../server/options/scoring.js'

export function optionsResearchFixture() {
  const tradingDate = '2026-09-22'
  const availableAt = '2026-09-22T13:32:20.000Z'
  const scanId = `${tradingDate}:opening:fixture`
  const security = { securityId: 'sec:EX', issuerId: 'iss:EX', ticker: 'EX' }
  const quoteAt = '2026-09-22T13:32:15.000Z'
  const underlying = { quote: { bid: 179.9, ask: 180.1, marketAt: quoteAt, ageMs: 2000 } }
  const feature = {
    recordId: 'a'.repeat(64), featureVersion: 'features-v1', security,
    technicals: { laggedThrough: '2026-09-21', return5dPct: 3, return20dPct: 12, relativeStrength20dPct: 8, realizedVolatility20dPct: 30, distanceFromSma20Pct: 4 },
    regime: { score: 8 }, directional: { call: { return5dPct: 3, return20dPct: 12, relativeStrength20dPct: 8 }, put: { return5dPct: -3, return20dPct: -12, relativeStrength20dPct: -8 } },
    events: { earnings: [], dividends: [], catalysts: [] }, coverage: { earnings: { status: 'complete' }, catalysts: { status: 'complete' } },
    pricingInputs: { rates: [{ eventId: 'rate', ratePct: 4, asOfDate: '2026-09-21' }] },
  }
  const contracts = ['call', 'put'].map((type) => ({
    rawId: `raw-${type}`, contractId: `osi:EX261022${type === 'call' ? 'C00200000' : 'P00160000'}`,
    osiSymbol: `EX261022${type === 'call' ? 'C00200000' : 'P00160000'}`, type,
    strikePrice: type === 'call' ? 200 : 160, expirationDate: '2026-10-22', dte: 30, cohort: 'primary',
    quote: { bid: 5.45, ask: 5.55, bidSize: 20, askSize: 20, marketAt: quoteAt, ageMs: 2000, semantics: { name: 'indicative', label: 'modified indicative quotes', live: false } },
    openInterest: 1200, openInterestDate: '2026-09-21', volume: { value: 40, session: 'rth', sessionDate: tradingDate }, previousVolume: 800,
    analytics: { impliedVolatility: 0.6, greeks: { delta: type === 'call' ? 0.3 : -0.3 }, marketAt: null }, fetchedAt: availableAt, rawReferenceHash: 'b'.repeat(64),
  }))
  function chainRecord(items, at) {
    return createOptionsAuditRecord({ type: 'chain', scanId, availableAt: at,
      source: { provider: 'fixture', feed: 'indicative', session: 'opening', entitlement: 'internal' },
      versions: { code: 'fixture', model: 'fixture', policy: 'fixture' }, inputHashes: [],
      payload: { underlying: { ...security, observation: underlying }, contracts: items, rejected: [], prefilter: { manifestHash: 'a'.repeat(64) } },
      missing: [{ path: 'payload.contracts[0].analytics.marketAt', reason: 'provider_analytics_time_unknown' }, { path: 'payload.contracts[1].analytics.marketAt', reason: 'provider_analytics_time_unknown' }],
    })
  }
  const initialChain = chainRecord(contracts.map((contract) => ({ ...contract, quote: { ...contract.quote, bid: 4.9, ask: 5.1, marketAt: '2026-09-22T13:31:15.000Z' } })), '2026-09-22T13:31:20.000Z')
  const finalChain = chainRecord(contracts, availableAt)
  const evaluated = contracts.map((contract) => scoreOpeningContract({ security, direction: contract.type, contract, underlying, feature, tradingDate, fullScenarios: true }))
  const ranking = rankOptionsScores(evaluated.map((entry) => entry.score))
  const observations = new Map(contracts.map((contract) => [contract.contractId, { contract, underlying, revalidation: { status: 'confirmed', chainRecordId: finalChain.recordId } }]))
  const built = createOpeningAuditRecords({ scanId, tradingDate, availableAt, ranking, scenarios: evaluated.map((entry) => entry.scenario), observations, chainRecordIds: [initialChain.recordId, finalChain.recordId] })
  const records = [initialChain, finalChain, ...Object.values(built)]
  const manifest = { manifestId: 'f'.repeat(64), scanId, availableAt, publication: built.publicationRecord.payload,
    records: records.map((record) => ({ id: record.recordId, type: record.recordType })) }
  return { manifest, records, contracts, finalChain, readRecord: async (_archive, type, id) => records.find((record) => record.recordType === type && record.recordId === id) || null }
}
