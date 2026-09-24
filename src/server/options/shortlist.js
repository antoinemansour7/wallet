import { digest } from '../research/archive.js'
import { resolveOptionsHoldingExit } from './scenarios.js'
import { horizonEvents } from './scoring.js'

export const OPTIONS_SHORTLIST_POLICY_VERSION = 'options-premarket-shortlist-v3'
export const OPTIONS_SHORTLIST_MAX_CANDIDATES = 15
const HOLDING_DAYS = 3 // fixed primary horizon (epic #201 section 10)

function round(value, digits = 3) {
  return value == null ? null : Number(value.toFixed(digits))
}

// Clipped linear ramp: 0 points at or below `zero`, `max` points at or above
// `full`, linear between. Matches the epic's "clipped linear ramps" v0 policy.
function ramp(value, { zero, full, max }) {
  if (!Number.isFinite(value)) return 0
  if (value <= zero) return 0
  if (value >= full) return max
  return round(((value - zero) / (full - zero)) * max)
}

function underlyingSetupScore(record, direction) {
  const signed = record.directional[direction]
  const relStrengthPoints = ramp(signed.relativeStrength20dPct, { zero: 0, full: 10, max: 10 })
  const regimeScore = record.regime?.score ?? null
  // A constructive tape (score high) supports calls; a defensive/stand-down
  // tape (score low) supports puts. Symmetric, versioned v0 policy.
  const regimeAgreement = regimeScore == null ? 0
    : direction === 'call' ? ramp(regimeScore, { zero: 4, full: 8, max: 5 })
    : ramp(10 - regimeScore, { zero: 4, full: 8, max: 5 })
  return {
    component: 'underlyingSetup', max: 15, points: round(relStrengthPoints + regimeAgreement),
    evidence: [
      { feature: 'relativeStrength20dPct', raw: signed.relativeStrength20dPct, points: relStrengthPoints },
      { feature: 'regimeScore', raw: regimeScore, points: regimeAgreement },
    ],
  }
}

function technicalConfirmationScore(record, direction) {
  const signed = record.directional[direction]
  const trendPoints = ramp(signed.return5dPct, { zero: 0, full: 5, max: 5 })
  const distance = record.technicals.distanceFromSma20Pct
  const signedDistance = distance == null ? null : direction === 'call' ? distance : -distance
  const breakoutPoints = ramp(signedDistance, { zero: 0, full: 5, max: 5 })
  return {
    component: 'technicalConfirmation', max: 10, points: round(trendPoints + breakoutPoints),
    evidence: [
      { feature: 'return5dPct', raw: signed.return5dPct, points: trendPoints },
      { feature: 'distanceFromSma20Pct', raw: signedDistance, points: breakoutPoints },
    ],
  }
}

// #206's evaluateNonEventHorizon only ever confirms "no event" (eligible) or
// "unknown coverage" (unknown) in the current live setup — neither earns
// points under the epic's own "no event = 0" rule. A known event excludes
// the security entirely, one level up in buildOptionsShortlist. max is 0,
// not the epic's nominal 10, because no input today can make this
// component score above zero — a candidate's max should reflect what's
// actually reachable, not a ceiling nothing can reach.
function catalystQualityScore(record, horizonCoverage) {
  const state = horizonCoverage ?? record.nonEventHorizon.state
  return { component: 'catalystQuality', max: 0, points: 0, coverage: state, evidence: [{ feature: 'nonEventHorizon.state', raw: state, points: 0 }] }
}

export function scoreOptionsDirection(record, direction, { horizonCoverage = null } = {}) {
  if (!['call', 'put'].includes(direction)) throw new Error('direction must be call or put')
  const components = [underlyingSetupScore(record, direction), technicalConfirmationScore(record, direction), catalystQualityScore(record, horizonCoverage)]
  return { securityId: record.security.securityId, ticker: record.security.ticker, direction,
    max: components.reduce((sum, c) => sum + c.max, 0), total: round(components.reduce((sum, c) => sum + c.points, 0)), components }
}

export function buildOptionsShortlist({ snapshot, watchlist, maxCandidates = OPTIONS_SHORTLIST_MAX_CANDIDATES, policyVersion = OPTIONS_SHORTLIST_POLICY_VERSION } = {}) {
  if (snapshot?.schemaVersion !== 'options-feature-snapshot-v1' || !snapshot.snapshotId) throw new Error('Shortlist requires a completed feature snapshot')
  if (!Array.isArray(watchlist?.securities) || !watchlist.securities.length) throw new Error('Shortlist requires a watchlist snapshot')
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) throw new Error('maxCandidates must be a positive integer')

  const bySecurityId = new Map(snapshot.securities.map((record) => [record.security.securityId, record]))
  const holdingExit = resolveOptionsHoldingExit(snapshot.tradingDate, HOLDING_DAYS)
  if (!holdingExit) throw new Error('Shortlist holding horizon is outside the exchange calendar')
  const scored = []
  const rejected = []

  for (const security of watchlist.securities) {
    const record = bySecurityId.get(security.securityId)
    if (!record) { rejected.push({ securityId: security.securityId, ticker: security.ticker, status: 'missing', reason: 'not_in_feature_snapshot' }); continue }
    if (!Number.isFinite(record.underlying.premarketPrice) || record.underlying.premarketPrice <= 0) { rejected.push({ securityId: security.securityId, ticker: security.ticker, status: 'unavailable', reason: 'no_premarket_price' }); continue }
    // The feature snapshot's legacy five-CALENDAR-day flag is not the
    // three-SESSION holding period. Use the same dated-event rule as scoring.
    const eventRecord = record.events ? record : { ...record, events: { catalysts: (record.nonEventHorizon.reasons || [])
      .filter((item) => item.date).map((item) => ({ ...item, eventDate: item.date })) } }
    const events = horizonEvents({ features: eventRecord, exitDate: holdingExit.exitDate, expirationDate: holdingExit.exitDate, tradingDate: snapshot.tradingDate })
    if (events.inHorizon.length) {
      rejected.push({ securityId: security.securityId, ticker: security.ticker, status: 'rejected', reason: 'known_event_in_holding_window', events: events.inHorizon })
      continue
    }
    const horizonCoverage = ['earnings', 'catalysts'].every((feed) => record.coverage?.[feed]?.status === 'complete') ? 'eligible' : 'unknown'
    const call = scoreOptionsDirection(record, 'call', { horizonCoverage })
    const put = scoreOptionsDirection(record, 'put', { horizonCoverage })
    if (call.total === 0 && put.total === 0) {
      rejected.push({ securityId: security.securityId, ticker: security.ticker, status: 'rejected', reason: 'no_directional_setup' })
      continue
    }
    if (call.total === put.total) {
      rejected.push({ securityId: security.securityId, ticker: security.ticker, status: 'rejected', reason: 'directional_setup_tie' })
      continue
    }
    const [best, other] = call.total >= put.total ? [call, put] : [put, call]
    scored.push({ security, record, best, other, horizonCoverage })
  }

  scored.sort((a, b) => b.best.total - a.best.total || a.security.ticker.localeCompare(b.security.ticker))
  const shortlisted = scored.slice(0, maxCandidates)
  for (const entry of scored.slice(maxCandidates)) {
    rejected.push({ securityId: entry.security.securityId, ticker: entry.security.ticker, status: 'rejected', reason: 'not_top_n', direction: entry.best.direction, score: entry.best.total })
  }

  const candidates = shortlisted.map(({ security, record, best, horizonCoverage }) => ({
    securityId: security.securityId, ticker: security.ticker, direction: best.direction,
    score: best.total, maxScore: best.max, catalystCoverage: horizonCoverage,
    holdingHorizonSessions: HOLDING_DAYS, holdingExitAt: holdingExit.exitAt, featureVersion: record.featureVersion, featureRecordId: record.recordId,
    earnings: record.events?.earnings || [],
  }))
  const scores = scored.map(({ security, best, other }) => ({ securityId: security.securityId, ticker: security.ticker, scores: [best, other] }))

  const base = { schemaVersion: 'options-shortlist-v1', policyVersion, tradingDate: snapshot.tradingDate, freezeAt: snapshot.freezeAt,
    featureSnapshotId: snapshot.snapshotId, maxCandidates, candidates, rejected, scores }
  return { ...base, shortlistId: digest(base) }
}
