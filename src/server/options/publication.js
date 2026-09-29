import { digest } from '../research/archive.js'
import { createOptionsAuditRecord } from './audit.js'
import { OPTIONS_CALENDAR_2026, marketDay, optionsLocalParts, zonedMarketInstant } from './calendar.js'
import { OPTIONS_PRICING_MODEL_VERSION } from './pricing.js'
import { evaluateOpeningContractGates } from './chainGates.js'
import {
  buildContractScenarioSet, OPTIONS_SCENARIO_POLICY_VERSION, OPTIONS_SCENARIO_RANKING_PROFILE,
} from './scenarios.js'
import {
  createOptionsScoreAuditRecord, diagnoseOptionsScorePolicy, rankOptionsScores, scoreOptionsContract,
} from './scoring.js'
import { createOutcomeCaptureAuditRecord, createOutcomeCapturePlan } from './observations.js'

export const OPTIONS_PUBLICATION_POLICY_VERSION = 'options-morning-publication-v2'
export const OPTIONS_PUBLICATION_POLICY = Object.freeze({
  version: OPTIONS_PUBLICATION_POLICY_VERSION,
  observationMode: 'theoretical',
  maxQuoteAgeMs: 30000,
  maxUnderlyingAgeMs: 10000,
  emptyValidityMs: 5 * 60 * 1000,
  maxRevalidationPasses: 2,
  materialChange: Object.freeze({ midPct: 2, spreadPoints: 2, underlyingPct: 0.5 }),
  fallbackRiskFreeRate: 0.04,
})

function round(value, digits = 4) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits))
}

function findNulls(value, path = 'payload', found = []) {
  if (value === null) { found.push({ path, reason: 'not_observed_at_publication' }); return found }
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) findNulls(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, found)
  return found
}

function quoteMid(quote) {
  return Number.isFinite(quote?.bid) && Number.isFinite(quote?.ask) && quote.bid > 0 && quote.ask >= quote.bid ? (quote.bid + quote.ask) / 2 : null
}

function relativeChange(before, after) {
  return before > 0 && Number.isFinite(after) ? Math.abs(((after - before) / before) * 100) : null
}

function spreadPct(quote) {
  const mid = quoteMid(quote)
  return mid ? ((quote.ask - quote.bid) / mid) * 100 : null
}

export function compareRevalidatedQuote(before, after, beforeUnderlying, afterUnderlying, policy = OPTIONS_PUBLICATION_POLICY) {
  const midChangePct = relativeChange(quoteMid(before?.quote), quoteMid(after?.quote))
  const spreadChangePoints = spreadPct(before?.quote) == null || spreadPct(after?.quote) == null
    ? null : Math.abs(spreadPct(after.quote) - spreadPct(before.quote))
  const underlyingChangePct = relativeChange(quoteMid(beforeUnderlying?.quote), quoteMid(afterUnderlying?.quote))
  const reasons = []
  if (midChangePct == null || spreadChangePoints == null || underlyingChangePct == null) reasons.push('comparison_input_missing')
  if (midChangePct != null && midChangePct >= policy.materialChange.midPct) reasons.push('mid_changed')
  if (spreadChangePoints != null && spreadChangePoints >= policy.materialChange.spreadPoints) reasons.push('spread_changed')
  if (underlyingChangePct != null && underlyingChangePct >= policy.materialChange.underlyingPct) reasons.push('underlying_changed')
  return {
    material: reasons.length > 0,
    reasons,
    midChangePct: round(midChangePct),
    spreadChangePoints: round(spreadChangePoints),
    underlyingChangePct: round(underlyingChangePct),
  }
}

function riskFreeRate(feature, policy, asOf, tradingDate) {
  const observed = (feature?.pricingInputs?.rates || [])
    .filter((item) => Number.isFinite(item.ratePct) && item.asOfDate <= tradingDate
      && (!item.availableAt || Date.parse(item.availableAt) <= Date.parse(asOf)))
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate)
      || (a.availableAt || '').localeCompare(b.availableAt || '')
      || String(a.eventId || a.revisionId).localeCompare(String(b.eventId || b.revisionId))).at(-1)
  return observed
    ? { value: observed.ratePct / 100, source: `feature:${observed.eventId || observed.revisionId}`, fallback: false }
    : { value: policy.fallbackRiskFreeRate, source: `${policy.version}:fallback-risk-free-rate`, fallback: true }
}

function blockedScenario(contract, error) {
  return {
    policyVersion: OPTIONS_SCENARIO_POLICY_VERSION,
    modelVersion: OPTIONS_PRICING_MODEL_VERSION,
    status: 'blocked', publishable: false,
    blockers: [{ code: 'scenario_input_invalid', detail: error?.code || 'scenario_build_failed' }],
    contract: {
      contractId: contract.contractId, osiSymbol: contract.osiSymbol, type: contract.type,
      strikePrice: contract.strikePrice, expirationDate: contract.expirationDate,
    },
    horizons: [], scenarios: [], timeOnlyDecay: [], premiumTargets: [],
  }
}

export function scoreOpeningContract({
  security, direction, contract, underlying, feature, tradingDate,
  policy = OPTIONS_PUBLICATION_POLICY, fullScenarios = false,
} = {}) {
  const underlyingPrice = quoteMid(underlying?.quote)
  const asOf = [contract?.quote?.marketAt, underlying?.quote?.marketAt].filter(Boolean).sort().at(-1)
  const rate = riskFreeRate(feature, policy, asOf, tradingDate)
  // Also protect direct callers of publication; a preflattened chain is not
  // proof that the current quote passed the hard gates.
  const gate = evaluateOpeningContractGates({ ...contract,
    openInterest: { value: contract.openInterest, asOfDate: contract.openInterestDate },
    previousDailyBar: { volume: contract.previousVolume },
  }, { tradingDate, regularOpenAt: zonedMarketInstant(tradingDate, OPTIONS_CALENDAR_2026.regular.open, OPTIONS_CALENDAR_2026.timeZone), underlying })
  let scenarioSet
  try {
    scenarioSet = buildContractScenarioSet({
      contract, underlyingPrice, asOf, tradingDate, riskFreeRate: rate.value,
      dividends: feature?.events?.dividends || [],
      providerImpliedVolatility: contract.analytics?.impliedVolatility ?? null,
      assumptionSources: {
        riskFreeRate: rate.source,
        dividends: feature?.events?.dividends?.length ? feature.recordId : 'none_observed_at_freeze',
        providerAnalytics: contract.rawReferenceHash || 'not_supplied',
      },
      ...(fullScenarios ? {} : OPTIONS_SCENARIO_RANKING_PROFILE),
    })
  } catch (error) {
    scenarioSet = blockedScenario(contract, error)
  }
  const scenarioEvidenceId = digest(scenarioSet)
  const score = scoreOptionsContract({
    security, direction, contract, features: feature, scenarioSet, tradingDate, scenarioEvidenceId, gate,
  })
  return {
    score,
    scenario: {
      securityId: security.securityId, ticker: security.ticker, direction,
      contractId: contract.contractId, purpose: fullScenarios ? 'selected_full_matrix' : 'ranking',
      evidenceId: scenarioEvidenceId, rateAssumption: rate, scenarioSet,
    },
  }
}

export function scoreOpeningChains({ entries = [], featuresBySecurity = new Map(), tradingDate, policy = OPTIONS_PUBLICATION_POLICY } = {}) {
  const scores = []
  const scenarios = []
  for (const entry of entries) {
    const feature = featuresBySecurity.get(entry.security.securityId)
    if (!feature) continue
    for (const contract of entry.chain.contracts) {
      const evaluated = scoreOpeningContract({
        security: entry.security, direction: entry.direction, contract,
        underlying: entry.underlying, feature, tradingDate, policy,
      })
      scores.push(evaluated.score)
      scenarios.push(evaluated.scenario)
    }
  }
  const ranking = rankOptionsScores(scores)
  return { scores, scenarios, ranking, diagnostics: diagnoseOptionsScorePolicy(scores) }
}

export function createOptionsScenarioAuditRecord({ scanId, availableAt, scenarios, inputHashes = [] } = {}) {
  const payload = { scenarios }
  return createOptionsAuditRecord({
    type: 'scenario', scanId, availableAt,
    source: { provider: 'wallai', feed: 'american-option-scenarios', session: 'opening', entitlement: 'internal' },
    versions: { code: 'options-publication-scenarios-v1', model: OPTIONS_PRICING_MODEL_VERSION, policy: OPTIONS_SCENARIO_POLICY_VERSION },
    inputHashes, payload, missing: findNulls(payload),
  })
}

export function createOptionsDecisionAuditRecord({ scanId, availableAt, ranking, inputHashes = [] } = {}) {
  const payload = {
    candidates: ranking.displayed.map((entry) => ({
      rank: entry.rank, securityId: entry.securityId, ticker: entry.ticker, direction: entry.direction,
      contractId: entry.contract.contractId, score: entry.score,
    })),
    rejected: [
      ...ranking.ineligible.map((entry) => ({ contractId: entry.contract.contractId, reasons: entry.blockers })),
      ...ranking.suppressed.map((entry) => ({ contractId: entry.contract.contractId, reasons: [{ code: entry.display.reason }] })),
    ],
  }
  return createOptionsAuditRecord({
    type: 'decision', scanId, availableAt,
    source: { provider: 'wallai', feed: 'opening-publication-decision', session: 'opening', entitlement: 'internal' },
    versions: { code: 'options-publication-decision-v1', model: OPTIONS_PRICING_MODEL_VERSION, policy: OPTIONS_PUBLICATION_POLICY_VERSION },
    inputHashes, payload, missing: findNulls(payload),
  })
}

function validityFor(ranking, observations, availableAt, policy) {
  if (!ranking.displayed.length) return new Date(Date.parse(availableAt) + policy.emptyValidityMs).toISOString()
  const limits = []
  for (const selected of ranking.displayed) {
    const observed = observations.get(selected.contract.contractId)
    if (observed?.contract?.quote?.marketAt) limits.push(Date.parse(observed.contract.quote.marketAt) + policy.maxQuoteAgeMs)
    if (observed?.underlying?.quote?.marketAt) limits.push(Date.parse(observed.underlying.quote.marketAt) + policy.maxUnderlyingAgeMs)
  }
  return limits.length ? new Date(Math.min(...limits)).toISOString() : availableAt
}

export function createOptionsPublicationAuditRecord({
  scanId, tradingDate, availableAt, ranking, observations = new Map(), completeness = 'complete',
  lineage, revision = 1, policy = OPTIONS_PUBLICATION_POLICY,
} = {}) {
  const result = ranking.displayed.length ? 'candidates' : 'empty'
  const state = completeness !== 'complete' ? 'partial' : result === 'empty' ? 'empty' : policy.observationMode
  const selected = ranking.displayed.map((entry) => {
    const observed = observations.get(entry.contract.contractId) || {}
    const quote = observed.contract?.quote || null
    return {
      rank: entry.rank, securityId: entry.securityId, ticker: entry.ticker, direction: entry.direction,
      contractId: entry.contract.contractId, score: entry.score,
      observedMid: quoteMid(quote), spreadPct: spreadPct(quote),
      quoteMarketAt: quote?.marketAt || null,
      underlyingMarketAt: observed.underlying?.quote?.marketAt || null,
      revalidation: observed.revalidation || null,
    }
  })
  const payload = {
    stage: 'opening', status: 'published', publicationVersion: policy.version,
    tradingDate, revision, state, observationMode: policy.observationMode, completeness, result,
    availableAt, validUntil: validityFor(ranking, observations, availableAt, policy),
    selected, lineage,
  }
  return createOptionsAuditRecord({
    type: 'scan', scanId, availableAt,
    source: { provider: 'wallai', feed: 'morning-options-publication', session: 'opening', entitlement: 'owner-only' },
    versions: { code: 'options-publication-v1', model: OPTIONS_PRICING_MODEL_VERSION, policy: policy.version },
    inputHashes: [...new Set(Object.values(lineage || {}).flat().filter((value) => /^[a-f0-9]{64}$/.test(value)))],
    payload, missing: findNulls(payload),
  })
}

export function createOpeningAuditRecords({
  scanId, tradingDate, availableAt, ranking, scenarios, chainRecordIds = [], premarketRecordIds = [],
  observations = new Map(), completeness = 'complete', securities = new Map(),
} = {}) {
  const scenarioRecord = createOptionsScenarioAuditRecord({ scanId, availableAt, scenarios, inputHashes: [...premarketRecordIds, ...chainRecordIds] })
  const scoreRecord = createOptionsScoreAuditRecord({
    scanId, ranking, availableAt, modelVersion: OPTIONS_PRICING_MODEL_VERSION,
    inputHashes: [...premarketRecordIds, ...chainRecordIds, scenarioRecord.recordId],
    diagnostics: diagnoseOptionsScorePolicy(ranking.ranked),
  })
  const decisionRecord = createOptionsDecisionAuditRecord({
    scanId, availableAt, ranking, inputHashes: [scenarioRecord.recordId, scoreRecord.recordId],
  })
  const lineage = {
    premarketRecordIds, chainRecordIds, scenarioRecordId: scenarioRecord.recordId,
    scoreRecordId: scoreRecord.recordId, decisionRecordId: decisionRecord.recordId,
  }
  const publicationRecord = createOptionsPublicationAuditRecord({
    scanId, tradingDate, availableAt, ranking, observations, completeness, lineage,
  })
  const outcomePlans = ranking.displayed.map((entry) => {
    const observed = observations.get(entry.contract.contractId)
    // Chain contracts carry no identity of their own; the resolved security
    // does. Without it every plan was dropped and no pick was ever observed.
    const security = securities.get(entry.securityId)
    const contract = { ...(observed?.contract || entry.contract),
      ...(security && { securityId: security.securityId, issuerId: security.issuerId }) }
    if (!contract.securityId || !contract.issuerId) {
      console.error(`[options] no outcome plan for ${contract.contractId}: security identity unavailable`)
      return null
    }
    return createOutcomeCapturePlan({
      scanId, tradingDate,
      entryAt: observed?.contract?.quote?.marketAt || availableAt,
      contract,
    })
  }).filter(Boolean)
  const outcomeRecord = createOutcomeCaptureAuditRecord({
    scanId, availableAt, plans: outcomePlans,
    inputHashes: [decisionRecord.recordId, publicationRecord.recordId],
  })
  return { scenarioRecord, scoreRecord, decisionRecord, publicationRecord, outcomeRecord }
}

export function optionsPublicationSummary(manifest, at = Date.now(), { calendar = OPTIONS_CALENDAR_2026 } = {}) {
  const checkedAt = new Date(at).toISOString()
  const local = optionsLocalParts(checkedAt)
  const day = marketDay(local.date, calendar)
  const publication = manifest?.publication
  if (!publication || publication.tradingDate !== local.date) {
    return {
      state: day.known && !day.open ? 'closed' : 'unavailable', checkedAt,
      tradingDate: local.date, reason: publication ? 'no_scan_for_current_session' : 'no_published_scan',
      referenceId: manifest?.manifestId || null,
    }
  }
  const stale = publication.validUntil && Date.parse(checkedAt) > Date.parse(publication.validUntil)
  return {
    ...publication,
    state: stale ? 'stale' : publication.state,
    checkedAt,
    referenceId: manifest.manifestId,
  }
}

export function publicationProjection(record) {
  const payload = record?.payload
  if (record?.recordType !== 'scan' || typeof payload?.publicationVersion !== 'string') return null
  return {
    publicationRecordId: record.recordId,
    tradingDate: payload.tradingDate,
    revision: payload.revision,
    state: payload.state,
    observationMode: payload.observationMode,
    completeness: payload.completeness,
    result: payload.result,
    availableAt: payload.availableAt,
    validUntil: payload.validUntil,
    selected: payload.selected,
  }
}
