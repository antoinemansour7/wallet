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
// Must match shortlist.js's HOLDING_DAYS — the epic's fixed 3-session
// primary horizon. Passed explicitly since createOptionsFeatureSnapshot
// otherwise defaults its exclusion window to 5 days, which would silently
// disagree with the 3-session label every shortlisted candidate carries.
const NON_EVENT_HOLDING_DAYS = 3
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

function mapRegimeInput(regime) {
  if (!regime) return []
  return [{ eventId: `market-regime:${regime.asOf}`, score: regime.score, label: regime.label, availableAt: new Date().toISOString(),
    source: { provider: 'wallai', licenseId: 'derived-licensed-inputs', url: 'internal://wallai/market-regime' } }]
}

// Same pattern as scheduler.js's own findNulls: createOptionsAuditRecord
// requires every null in the payload to have a matching missing-path entry.
function findNulls(value, path = 'payload', found = []) {
  if (value === null) { found.push({ path, reason: 'not_observed_at_freeze' }); return found }
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) findNulls(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, found)
  return found
}

async function gatherAlpaca(createAlpaca, securities, tradingDate, deadlineAt) {
  const alpaca = createAlpaca()
  const underlyingResult = await alpaca.underlyingSnapshots(securities, { deadline: deadlineAt })
  const start = new Date(Date.parse(`${tradingDate}T00:00:00Z`) - BAR_LOOKBACK_DAYS * DAY).toISOString().slice(0, 10)
  const barsResult = await alpaca.stockBars([...securities, BENCHMARK_SECURITY], { start, end: tradingDate, deadline: deadlineAt })
  return { underlyings: underlyingResult.observations.map(mapUnderlyingInput), bars: barsResult.observations }
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
} = {}) {
  const freezeAt = window.deadlineAt
  const tradingDate = window.tradingDate
  const securities = watchlist.securities

  let underlyings = [], bars = [], alpacaAvailable = true
  try {
    const gathered = await gatherAlpaca(createAlpaca, securities, tradingDate, deadlineAt)
    underlyings = gathered.underlyings
    bars = gathered.bars
  } catch { alpacaAvailable = false }

  let regime = null
  try { regime = await fetchRegime() } catch { /* stays unavailable */ }

  let secItems = [], catalystItems = [], secCompleted = checkpoint?.secCompleted || []
  try {
    const master = await loadMaster(archive)
    const client = createSec({ deadline: Date.parse(deadlineAt) })
    const secResult = await gatherSec({ securityMaster: master, securities, freezeAt, completed: secCompleted, client, deadline: Date.parse(deadlineAt) })
    secItems = secResult.secItems
    catalystItems = secResult.catalystItems
    secCompleted = secResult.completed
    await saveCheckpoint({ secCompleted })
  } catch { /* sec/catalysts stay empty; features.js will mark that coverage unavailable */ }

  const inputs = { underlyings, bars, regime: mapRegimeInput(regime), sec: secItems, catalysts: catalystItems, news: [], analyst: [], earnings: [], dividends: [], rates: [] }
  const snapshot = createOptionsFeatureSnapshot({ securities, freezeAt, tradingDate, inputs, benchmarkSecurityId: BENCHMARK_SECURITY.securityId, nonEventHoldingDays: NON_EVENT_HOLDING_DAYS, mode: 'live' })
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
      alpacaAvailable, regimeAvailable: regime != null, secCompletedCount: secCompleted.length,
      decisionRecordId: decisionRecord.recordId, scoreRecordId: scoreRecord.recordId, evidenceRecordId: evidenceRecord.recordId,
    },
  }
}
