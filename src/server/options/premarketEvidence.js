import { createOptionsFeatureSnapshot, createOptionsFeatureAuditRecord } from './features.js'
import { createOptionsAuditRecord } from './audit.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'
import { createAlpacaOptionsAdapter } from './alpaca.js'
import { createSecClient } from '../research/secDisclosures.js'
import { loadSecurityMaster } from '../research/securityMaster.js'
import { getMarketRegime } from '../marketRegime.js'
import { buildOptionsShortlist } from './shortlist.js'
import { gatherOptionsSecEvidence } from './secCatalystEvidence.js'

const BENCHMARK_SECURITY = Object.freeze({ securityId: 'benchmark:SPY', issuerId: 'benchmark:SPY', ticker: 'SPY' })
const ALPACA_UNDERLYING_URL = 'https://data.alpaca.markets/v2/stocks/snapshots'
const BAR_LOOKBACK_DAYS = 45
// evaluateNonEventHorizon (features.js) counts calendar days, not trading
// sessions, so this must be wider than shortlist.js's local HOLDING_DAYS=3
// (the labeled session horizon) to actually cover it — 3 trading sessions
// can span up to 5 calendar days across a weekend or a holiday.
// Erring narrow would let a real event inside the true holding window slip
// past the non-event exclusion gate; erring wide only costs an occasional
// extra exclusion, which is the safe direction for a risk gate.
const NON_EVENT_HOLDING_DAYS = 5
const DAY = 86400000

function mapUnderlyingInput(observation) {
  return {
    securityId: observation.securityId,
    price: null,
    quote: observation.quote ? { bid: observation.quote.bid, ask: observation.quote.ask } : null,
    trade: observation.trade ? { price: observation.trade.price } : null,
    marketAt: observation.quote?.marketAt || observation.trade?.marketAt || null,
    availableAt: observation.fetchedAt,
    source: { provider: 'alpaca', licenseId: 'alpaca-basic-indicative', url: ALPACA_UNDERLYING_URL },
    pricingReady: observation.pricingReady === true,
  }
}

// features.js's relevant() matches an observation to a security by
// securityId (falling back to issuerId, then ticker) — a single
// unmatched-to-anyone regime item silently matches no security at all.
// The regime is one macro reading applying identically to every security,
// so it must be fanned out with each security's own securityId attached.
function mapRegimeInput(regime, securities, now) {
  if (!regime) return []
  return securities.map((security) => ({
    eventId: `market-regime:${regime.asOf}:${security.securityId}`,
    securityId: security.securityId,
    score: regime.score, label: regime.label, availableAt: now(),
    source: { provider: 'wallai', licenseId: 'derived-licensed-inputs', url: 'internal://wallai/market-regime' },
  }))
}

// Same pattern as scheduler.js's own findNulls: createOptionsAuditRecord
// requires every null in the payload to have a matching missing-path entry.
function findNulls(value, path = 'payload', found = []) {
  if (value === null) { found.push({ path, reason: 'not_observed_at_freeze' }); return found }
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) findNulls(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, found)
  return found
}

function logFailure(stage, error) {
  console.error(JSON.stringify({ service: 'options-premarket', stage, message: String(error?.message || error) }))
}

// Two independent Alpaca calls: a failure in one (e.g. a bars-endpoint rate
// limit) must not discard the other's already-fetched, still-usable result.
async function gatherAlpaca(alpaca, securities, tradingDate, deadlineAt) {
  let underlyings = [], underlyingAvailable = false
  try {
    const result = await alpaca.underlyingSnapshots(securities, { deadline: deadlineAt })
    underlyings = result.observations.map(mapUnderlyingInput)
    underlyingAvailable = true
  } catch (error) { logFailure('underlying', error) }

  let bars = [], barsAvailable = false
  try {
    const start = new Date(Date.parse(`${tradingDate}T00:00:00Z`) - BAR_LOOKBACK_DAYS * DAY).toISOString().slice(0, 10)
    const result = await alpaca.stockBars([...securities, BENCHMARK_SECURITY], { start, end: tradingDate, deadline: deadlineAt })
    bars = result.observations
    barsAvailable = true
  } catch (error) { logFailure('bars', error) }

  return { underlyings, bars, underlyingAvailable, barsAvailable }
}

export async function runOptionsPremarketStage({
  window, deadlineAt, checkpoint, saveCheckpoint, archive,
  watchlist = OPTIONS_WATCHLIST_SNAPSHOT,
  createAlpaca = createAlpacaOptionsAdapter,
  fetchRegime = getMarketRegime,
  createSec = createSecClient,
  loadMaster = loadSecurityMaster,
  buildShortlist = buildOptionsShortlist,
  gatherSec = gatherOptionsSecEvidence,
  now = () => new Date().toISOString(),
} = {}) {
  const freezeAt = window.deadlineAt
  const tradingDate = window.tradingDate
  const securities = watchlist.securities

  let alpaca = null, alpacaAvailable = true
  try { alpaca = createAlpaca() } catch (error) { alpacaAvailable = false; logFailure('alpaca-construct', error) }
  const { underlyings, bars, underlyingAvailable, barsAvailable } = alpaca
    ? await gatherAlpaca(alpaca, securities, tradingDate, deadlineAt)
    : { underlyings: [], bars: [], underlyingAvailable: false, barsAvailable: false }

  let regime = null
  try { regime = await fetchRegime() } catch (error) { logFailure('regime', error) }

  let secItems = [], catalystItems = [], secCompleted = checkpoint?.secCompleted || [], secCoverage = {}
  try {
    const master = await loadMaster(archive)
    const client = createSec({ deadline: Date.parse(deadlineAt) })
    const secResult = await gatherSec({ securityMaster: master, securities, freezeAt, completed: secCompleted, client, deadline: Date.parse(deadlineAt) })
    secItems = secResult.secItems
    catalystItems = secResult.catalystItems
    secCompleted = secResult.completed
    secCoverage = secResult.coverage || {}
    await saveCheckpoint({ secCompleted })
  } catch (error) { logFailure('sec', error) }

  // Same coverage determination applies to both feeds: a successful (or
  // failed, or unresolved) EDGAR check for an issuer says as much about
  // "any 8-K filed" (catalysts) as it does about "any filing at all" (sec).
  const coverageOverride = Object.fromEntries(Object.entries(secCoverage).map(([securityId, status]) => [securityId, { sec: status, catalysts: status }]))

  const inputs = { underlyings, bars, regime: mapRegimeInput(regime, securities, now), sec: secItems, catalysts: catalystItems, news: [], analyst: [], earnings: [], dividends: [], rates: [] }
  const snapshot = createOptionsFeatureSnapshot({ securities, freezeAt, tradingDate, inputs, coverage: coverageOverride, benchmarkSecurityId: BENCHMARK_SECURITY.securityId, nonEventHoldingDays: NON_EVENT_HOLDING_DAYS, mode: 'live' })
  const scanId = `${tradingDate}:premarket:${window.policyVersion}`
  const evidenceRecord = createOptionsFeatureAuditRecord({ snapshot, scanId })
  const shortlist = buildShortlist({ snapshot, watchlist })

  const decisionPayload = { candidates: shortlist.candidates, rejected: shortlist.rejected }
  const decisionRecord = createOptionsAuditRecord({
    type: 'decision', scanId, availableAt: freezeAt,
    source: { provider: 'wallai', feed: 'premarket-shortlist', session: 'premarket', entitlement: 'internal' },
    versions: { code: 'options-shortlist-v1', model: 'deterministic-no-model', policy: shortlist.policyVersion },
    inputHashes: [snapshot.snapshotId], payload: decisionPayload, missing: findNulls(decisionPayload),
  })
  const scorePayload = { scores: shortlist.scores }
  const scoreRecord = createOptionsAuditRecord({
    type: 'score', scanId, availableAt: freezeAt,
    source: { provider: 'wallai', feed: 'premarket-shortlist', session: 'premarket', entitlement: 'internal' },
    versions: { code: 'options-shortlist-v1', model: 'deterministic-no-model', policy: shortlist.policyVersion },
    inputHashes: [snapshot.snapshotId], payload: scorePayload, missing: findNulls(scorePayload),
  })

  return {
    status: 'complete',
    records: [evidenceRecord, decisionRecord, scoreRecord],
    metrics: {
      shortlistId: shortlist.shortlistId, candidateCount: shortlist.candidates.length, rejectedCount: shortlist.rejected.length,
      alpacaAvailable, underlyingAvailable, barsAvailable, regimeAvailable: regime != null, secCompletedCount: secCompleted.length,
      decisionRecordId: decisionRecord.recordId, scoreRecordId: scoreRecord.recordId, evidenceRecordId: evidenceRecord.recordId,
    },
  }
}
