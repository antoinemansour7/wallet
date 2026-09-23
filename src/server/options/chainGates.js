import { OPTIONS_CALENDAR_2026, optionsLocalParts, zonedMarketInstant } from './calendar.js'

export const OPTIONS_CHAIN_GATE_POLICY_VERSION = 'options-opening-chain-gates-v2'
export const OPTIONS_CHAIN_DTE_RANGE = Object.freeze({ min: 7, max: 60 })
export const OPTIONS_CHAIN_PRIMARY_DTE_RANGE = Object.freeze({ min: 14, max: 45 })
export const OPTIONS_CHAIN_DELTA_RANGE = Object.freeze({ min: 0.15, max: 0.60 })
export const OPTIONS_CHAIN_PRIMARY_DELTA_RANGE = Object.freeze({ min: 0.25, max: 0.50 })
export const OPTIONS_CHAIN_LIQUIDITY_POLICY = Object.freeze({
  minOpenInterest: 100,
  minMid: 0.50,
  maxSpreadPct: 0.10,
  minSize: 1,
  minTodayVolume: 5,
  minPriorVolume: 100,
  maxQuoteAgeMs: 30000,
  maxUnderlyingAgeMs: 10000,
  maxSkewMs: 10000,
})

function calendarDays(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000)
}

function within(value, range) {
  return value != null && value >= range.min && value <= range.max
}

export function optionsContractCohort(dte, absDelta) {
  return within(dte, OPTIONS_CHAIN_PRIMARY_DTE_RANGE) && within(absDelta, OPTIONS_CHAIN_PRIMARY_DELTA_RANGE) ? 'primary' : 'edge'
}

// First failing gate wins, in the order the epic's hard gates are proposed
// (quote validity -> freshness -> price/spread -> liquidity). The delta window
// is enforced after local calibration in scoring, not on provider analytics.
// A contract failing only "quote after regular open" is 'pending', not
// 'rejected' -- the caller may retry it before the stage deadline.
export function evaluateOpeningContractGates(contract, { tradingDate, regularOpenAt, underlying, policy = OPTIONS_CHAIN_LIQUIDITY_POLICY } = {}) {
  const reject = (reason) => ({ status: 'rejected', reason, cohort: null, dte: null, absDelta: null, analyticsAgeUnknown: null })
  const quote = contract.quote
  if (!quote) return reject('quote_unavailable')
  if (!Number.isFinite(quote.bid) || !(quote.bid > 0)) return reject('zero_bid')
  if (!Number.isFinite(quote.ask) || !(quote.ask > quote.bid)) return reject('locked_or_crossed_quote')
  if (![quote.bidSize, quote.askSize].every((size) => Number.isFinite(size) && size >= policy.minSize)) return reject('insufficient_quote_size')
  if (!Number.isFinite(Date.parse(quote.marketAt)) || !Number.isFinite(Date.parse(regularOpenAt))) return reject('invalid_quote_timestamp')
  if (optionsLocalParts(quote.marketAt).date !== tradingDate) return reject('quote_session_mismatch')
  if (contract.fetchedAt && !Number.isFinite(Date.parse(contract.fetchedAt))) return reject('invalid_acquisition_timestamp')
  if (contract.fetchedAt && Date.parse(quote.marketAt) > Date.parse(contract.fetchedAt)) return reject('future_contract_quote')
  if (!['call', 'put'].includes(contract.type) || !Number.isFinite(contract.strikePrice) || contract.strikePrice <= 0) return reject('invalid_contract')

  // Checked before freshness/skew: a quote timestamped before the regular
  // open is expected to look "stale" by the time this stage runs (09:31+)
  // -- that is the retryable "series not yet open" case, not a hard reject.
  if (Date.parse(quote.marketAt) < Date.parse(regularOpenAt)) {
    return { status: 'pending', reason: 'series_not_yet_open', cohort: null, dte: null, absDelta: null, analyticsAgeUnknown: null }
  }

  if (!Number.isFinite(quote.ageMs) || quote.ageMs < 0 || !(quote.ageMs <= policy.maxQuoteAgeMs)) return reject('stale_contract_quote')
  const underlyingQuote = underlying?.quote
  if (!underlyingQuote || !Number.isFinite(underlyingQuote.ageMs) || underlyingQuote.ageMs < 0
    || !(underlyingQuote.ageMs <= policy.maxUnderlyingAgeMs)) return reject('stale_underlying_quote')
  if (!Number.isFinite(underlyingQuote.bid) || !Number.isFinite(underlyingQuote.ask)
    || underlyingQuote.bid <= 0 || underlyingQuote.ask < underlyingQuote.bid) return reject('invalid_underlying_quote')
  if (Date.parse(underlyingQuote.marketAt) < Date.parse(regularOpenAt)) return reject('underlying_not_regular_session')
  if (underlying.fetchedAt && Date.parse(underlyingQuote.marketAt) > Date.parse(underlying.fetchedAt)) return reject('future_underlying_quote')
  // The stock can age while the option chain is fetched. Recheck at the latest
  // acquisition timestamp when both observations carry acquisition provenance.
  if (contract.fetchedAt && underlying.fetchedAt) {
    const acquiredAt = Math.max(Date.parse(contract.fetchedAt), Date.parse(underlying.fetchedAt))
    if (!Number.isFinite(acquiredAt) || acquiredAt - Date.parse(quote.marketAt) > policy.maxQuoteAgeMs) return reject('stale_contract_quote')
    if (acquiredAt - Date.parse(underlyingQuote.marketAt) > policy.maxUnderlyingAgeMs) return reject('stale_underlying_quote')
  }
  const skewMs = Math.abs(Date.parse(quote.marketAt) - Date.parse(underlyingQuote.marketAt))
  if (!(skewMs <= policy.maxSkewMs)) return reject('quote_skew_exceeded')

  const mid = (quote.bid + quote.ask) / 2
  if (!(mid >= policy.minMid)) return reject('premium_below_minimum')
  const spreadPct = (quote.ask - quote.bid) / mid
  if (!(spreadPct <= policy.maxSpreadPct)) return reject('spread_above_maximum')

  const dte = calendarDays(tradingDate, contract.expirationDate)
  if (!within(dte, OPTIONS_CHAIN_DTE_RANGE)) return reject('dte_outside_window')

  if (contract.openInterest?.value == null) return reject('open_interest_unavailable')
  if (!Number.isFinite(contract.openInterest.value) || !(contract.openInterest.value >= policy.minOpenInterest)) return reject('insufficient_open_interest')
  if (contract.openInterest.asOfDate > tradingDate) return reject('future_open_interest')

  const todayVolume = contract.volume?.value ?? null
  const priorVolume = contract.previousDailyBar?.volume ?? null
  if (contract.volume?.sessionDate && contract.volume.sessionDate !== tradingDate) return reject('volume_session_mismatch')
  if (contract.previousDailyBar?.sessionDate >= tradingDate) return reject('prior_volume_session_mismatch')
  const volumeOk = (Number.isFinite(todayVolume) && todayVolume >= policy.minTodayVolume)
    || (Number.isFinite(priorVolume) && priorVolume >= policy.minPriorVolume)
  if (!volumeOk) return reject('insufficient_volume')

  // Provider Greeks are undated and cannot decide eligibility. The same delta
  // window is enforced after calibration, against the synchronized quote.
  const delta = contract.analytics?.greeks?.delta
  const absDelta = Number.isFinite(delta) ? Math.abs(delta) : null

  return {
    status: 'accepted',
    reason: null,
    cohort: optionsContractCohort(dte, absDelta), // provisional; scoring replaces it
    dte,
    absDelta: absDelta == null ? null : Number(absDelta.toFixed(4)),
    analyticsAgeUnknown: contract.analytics?.age === 'unknown',
    // Carried forward for operational diagnostics (#215): quote/underlying
    // synchronization quality across the whole accepted set, not just the
    // pass/fail line at maxSkewMs.
    skewMs,
  }
}

function flattenContract(contract, evaluation) {
  return {
    rawId: contract.rawId,
    contractId: contract.contractId,
    osiSymbol: contract.osiSymbol,
    type: contract.type,
    strikePrice: contract.strikePrice,
    expirationDate: contract.expirationDate,
    dte: evaluation.dte,
    cohort: evaluation.cohort,
    absDelta: evaluation.absDelta,
    analyticsAgeUnknown: evaluation.analyticsAgeUnknown,
    openInterest: contract.openInterest?.value ?? null,
    openInterestDate: contract.openInterest?.asOfDate ?? null,
    quote: contract.quote,
    trade: contract.trade,
    volume: contract.volume,
    // Carried forward because the volume gate can be cleared on prior-session
    // volume alone, and scoring (#211) charges a penalty for exactly that.
    previousVolume: contract.previousDailyBar?.volume ?? null,
    // Carried forward for operational diagnostics (#215): lets a reader see
    // the quote/underlying skew distribution across an accepted set, not just
    // whether any single contract crossed the gate threshold.
    skewMs: evaluation.skewMs ?? null,
    analytics: contract.analytics,
    fetchedAt: contract.fetchedAt,
    rawReferenceHash: contract.rawReferenceHash,
  }
}

export function buildOptionsChain({
  security, direction, tradingDate, optionChainObservation, calendar = OPTIONS_CALENDAR_2026, policy = OPTIONS_CHAIN_LIQUIDITY_POLICY,
} = {}) {
  if (!security?.securityId || !security?.issuerId || !security?.ticker) throw new Error('Chain gating requires a resolved security identity')
  if (!optionChainObservation) throw new Error('Chain gating requires an option chain observation')
  const regularOpenAt = zonedMarketInstant(tradingDate, calendar.regular.open, calendar.timeZone)
  const underlying = optionChainObservation.underlying

  const accepted = [], rejected = [], pending = []
  for (const contract of optionChainObservation.contracts) {
    if (contract.type !== direction) {
      rejected.push({ rawId: contract.rawId, contractId: contract.contractId, reason: 'contract_direction_mismatch' })
      continue
    }
    const evaluation = evaluateOpeningContractGates(contract, { tradingDate, regularOpenAt, underlying, policy })
    if (evaluation.status === 'accepted') accepted.push(flattenContract(contract, evaluation))
    else if (evaluation.status === 'pending') pending.push(contract)
    else rejected.push({ rawId: contract.rawId, contractId: contract.contractId, osiSymbol: contract.osiSymbol, reason: evaluation.reason })
  }
  for (const entry of optionChainObservation.rejected || []) {
    rejected.push({ rawId: entry.rawId ?? `enumeration:${entry.symbol}`, contractId: entry.symbol ?? 'unknown', reason: entry.reasons?.[0] || entry.reason || 'contract_enumeration_rejected' })
  }

  return {
    underlying: { securityId: security.securityId, issuerId: security.issuerId, ticker: security.ticker, direction, regularOpenAt },
    contracts: accepted,
    rejected,
    pending,
  }
}
