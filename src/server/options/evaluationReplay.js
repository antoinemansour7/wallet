import { digest } from '../research/archive.js'
import { OPTIONS_CALENDAR_2026, marketDay } from './calendar.js'
import { createOptionsFeatureSnapshot, OPTIONS_FEATURE_VERSION, OPTIONS_FEATURE_SOURCE_POLICY } from './features.js'
import { buildOptionsShortlist, OPTIONS_SHORTLIST_POLICY_VERSION } from './shortlist.js'
import { buildOptionsChain, OPTIONS_CHAIN_GATE_POLICY_VERSION } from './chainGates.js'
import { scoreOpeningChains, OPTIONS_PUBLICATION_POLICY_VERSION } from './publication.js'
import { OPTIONS_SCORE_POLICY_VERSION } from './scoring.js'
import { OPTIONS_SCENARIO_POLICY_VERSION } from './scenarios.js'
import { OPTIONS_PRICING_MODEL_VERSION } from './pricing.js'

export const OPTIONS_REPLAY_VERSIONS = Object.freeze({
  features: OPTIONS_FEATURE_VERSION, sources: OPTIONS_FEATURE_SOURCE_POLICY.version,
  shortlist: OPTIONS_SHORTLIST_POLICY_VERSION, gates: OPTIONS_CHAIN_GATE_POLICY_VERSION,
  publication: OPTIONS_PUBLICATION_POLICY_VERSION, score: OPTIONS_SCORE_POLICY_VERSION,
  scenarios: OPTIONS_SCENARIO_POLICY_VERSION, pricing: OPTIONS_PRICING_MODEL_VERSION,
  calendar: OPTIONS_CALENDAR_2026.version,
})

export function timestamp(value) {
  const result = typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(result)) throw new Error('A valid explicit timestamp is required')
  return result
}

const visible = (value, cutoff) => value && Number.isFinite(Date.parse(value.availableAt))
  && Date.parse(value.availableAt) <= cutoff
  && (!value.publicAt || timestamp(value.publicAt) <= cutoff)
  && (!value.marketAt || timestamp(value.marketAt) <= cutoff)

function frozenReference(value, cutoff, name) {
  if (!value?.version || !visible(value, cutoff)) throw new Error(`${name} version unavailable at freeze`)
}

function coverageAt(coverage, cutoff) {
  return Object.fromEntries(Object.entries(coverage || {}).map(([key, value]) => [key,
    value.status ? (visible({ ...value, availableAt: value.asOf }, cutoff) ? value : { status: 'unknown' })
      : coverageAt(value, cutoff),
  ]))
}

// Provider snapshot acquisition time does not establish historical availability.
// Each opening field needs its own historical availableAt; unknown fields are
// removed, and a complete-day bar cannot masquerade as accumulated opening volume.
function openingField(value, cutoff) {
  return visible(value, cutoff) ? structuredClone(value) : null
}

export function replayOptionsScan(scan) {
  const early = timestamp(scan.premarketAt), opening = timestamp(scan.openingAt)
  if (opening <= early || scan.openingAt.slice(0, 10) !== scan.tradingDate
    || scan.premarketAt.slice(0, 10) !== scan.tradingDate) throw new Error('Invalid stage cutoffs')
  if (!marketDay(scan.tradingDate).open) throw new Error('Replay requires an open session')
  for (const name of ['watchlist', 'identity', 'events', 'feed', 'calendar']) frozenReference(scan.references?.[name], early, name)
  if (digest(scan.references.calendar) !== digest(OPTIONS_CALENDAR_2026)) throw new Error('Unsupported calendar revision')
  if (digest(scan.versions) !== digest(OPTIONS_REPLAY_VERSIONS)) throw new Error('Unsupported replay policy versions')
  const securities = scan.references.watchlist.securities
  if (!securities?.length || securities.some((s) => !scan.references.identity.securities?.some((i) =>
    i.securityId === s.securityId && i.issuerId === s.issuerId && i.ticker === s.ticker))) throw new Error('Watchlist identity mismatch')
  const inputs = Object.fromEntries(Object.entries(scan.featureInputs || {}).map(([feed, items]) =>
    [feed, items.filter((item) => visible(item, early))]))
  const snapshot = createOptionsFeatureSnapshot({ securities, tradingDate: scan.tradingDate, freezeAt: scan.premarketAt,
    inputs, coverage: coverageAt(scan.coverage, early), mode: 'replay' })
  const shortlist = buildOptionsShortlist({ snapshot, watchlist: scan.references.watchlist })
  const entries = [], exclusions = [], selected = new Set()
  for (const candidate of shortlist.candidates) {
    const security = securities.find((item) => item.securityId === candidate.securityId)
    const observations = (scan.chains || []).filter((item) => item.securityId === security.securityId && visible(item, opening))
    if (observations.length > 1) throw new Error('Ambiguous opening chain snapshot')
    const observation = observations[0]
    if (!observation) { exclusions.push({ securityId: security.securityId, reason: 'missing_opening_chain' }); continue }
    const underlyingQuote = openingField(observation.underlying?.quote, opening)
    if (underlyingQuote) underlyingQuote.ageMs = opening - timestamp(underlyingQuote.marketAt)
    const underlying = { quote: underlyingQuote }
    const contracts = []
    for (const source of observation.contracts || []) {
      if (selected.has(source.contractId)) throw new Error('Duplicate contract identity')
      selected.add(source.contractId)
      if (!visible(source, opening) || source.securityId !== security.securityId || source.issuerId !== security.issuerId
        || !source.validFrom || timestamp(source.validFrom) > opening
        || (source.validThrough && timestamp(source.validThrough) < opening)
        || source.status !== 'active' || source.deliverable?.adjusted !== false || source.deliverable?.multiplier !== 100) {
        exclusions.push({ contractId: source.contractId, reason: 'historical_identity_or_deliverable_unavailable' }); continue
      }
      if (source.type !== candidate.direction) continue
      const contract = { ...source }
      for (const key of ['quote', 'analytics', 'openInterest', 'volume', 'previousDailyBar', 'trade']) contract[key] = openingField(source[key], opening)
      if (contract.quote) contract.quote.ageMs = opening - timestamp(contract.quote.marketAt)
      if (contract.volume && (contract.volume.semantics !== 'cumulative_at_cutoff'
        || contract.volume.sessionDate !== scan.tradingDate || !contract.volume.marketAt)) contract.volume = null
      if (contract.previousDailyBar && !(contract.previousDailyBar.sessionDate < scan.tradingDate)) contract.previousDailyBar = null
      if (contract.openInterest && !(contract.openInterest.asOfDate < scan.tradingDate)) contract.openInterest = null
      contracts.push(contract)
    }
    const chain = buildOptionsChain({ security, direction: candidate.direction, tradingDate: scan.tradingDate,
      optionChainObservation: { contracts, underlying } })
    exclusions.push(...chain.rejected, ...chain.pending.map((c) => ({ contractId: c.contractId, reason: 'pending_at_freeze' })))
    entries.push({ security, direction: candidate.direction, underlying, chain })
  }
  const featuresBySecurity = new Map(snapshot.securities.map((item) => [item.security.securityId, item]))
  const evaluated = scoreOpeningChains({ entries, featuresBySecurity, tradingDate: scan.tradingDate })
  return { scanId: scan.scanId, tradingDate: scan.tradingDate, snapshot, shortlist, entries, exclusions,
    ranking: evaluated.ranking, versions: scan.versions,
    referenceHashes: Object.fromEntries(Object.entries(scan.references).map(([key, value]) => [key, digest(value)])) }
}
