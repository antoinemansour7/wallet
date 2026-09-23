import { OPTIONS_CALENDAR_2026, zonedMarketInstant } from './calendar.js'

export const OPTIONS_CHAIN_GATE_POLICY_VERSION = 'options-opening-chain-gates-v1'
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

function cohortFor(dte, absDelta) {
  return within(dte, OPTIONS_CHAIN_PRIMARY_DTE_RANGE) && within(absDelta, OPTIONS_CHAIN_PRIMARY_DELTA_RANGE) ? 'primary' : 'edge'
}

// First failing gate wins, in the order the epic's hard gates are proposed
// (quote validity -> freshness -> price/spread -> liquidity -> delta window).
// A contract failing only "quote after regular open" is 'pending', not
// 'rejected' -- the caller may retry it before the stage deadline.
export function evaluateOpeningContractGates(contract, { tradingDate, regularOpenAt, underlying, policy = OPTIONS_CHAIN_LIQUIDITY_POLICY } = {}) {
  const reject = (reason) => ({ status: 'rejected', reason, cohort: null, dte: null, absDelta: null, analyticsAgeUnknown: null })
  const quote = contract.quote
  if (!quote) return reject('quote_unavailable')
  if (!(quote.bid > 0)) return reject('zero_bid')
  if (!(quote.ask > quote.bid)) return reject('locked_or_crossed_quote')
  if (!(quote.bidSize >= policy.minSize) || !(quote.askSize >= policy.minSize)) return reject('insufficient_quote_size')

  // Checked before freshness/skew: a quote timestamped before the regular
  // open is expected to look "stale" by the time this stage runs (09:31+)
  // -- that is the retryable "series not yet open" case, not a hard reject.
  if (Date.parse(quote.marketAt) < Date.parse(regularOpenAt)) {
    return { status: 'pending', reason: 'series_not_yet_open', cohort: null, dte: null, absDelta: null, analyticsAgeUnknown: null }
  }

  if (!(quote.ageMs <= policy.maxQuoteAgeMs)) return reject('stale_contract_quote')
  const underlyingQuote = underlying?.quote
  if (!underlyingQuote || !(underlyingQuote.ageMs <= policy.maxUnderlyingAgeMs)) return reject('stale_underlying_quote')
  const skewMs = Math.abs(Date.parse(quote.marketAt) - Date.parse(underlyingQuote.marketAt))
  if (!(skewMs <= policy.maxSkewMs)) return reject('quote_skew_exceeded')

  const mid = (quote.bid + quote.ask) / 2
  if (!(mid >= policy.minMid)) return reject('premium_below_minimum')
  const spreadPct = (quote.ask - quote.bid) / mid
  if (!(spreadPct <= policy.maxSpreadPct)) return reject('spread_above_maximum')

  const dte = calendarDays(tradingDate, contract.expirationDate)
  if (!within(dte, OPTIONS_CHAIN_DTE_RANGE)) return reject('dte_outside_window')

  if (contract.openInterest?.value == null) return reject('open_interest_unavailable')
  if (!(contract.openInterest.value >= policy.minOpenInterest)) return reject('insufficient_open_interest')

  const todayVolume = contract.volume?.value ?? null
  const priorVolume = contract.previousDailyBar?.volume ?? null
  const volumeOk = (todayVolume != null && todayVolume >= policy.minTodayVolume)
    || (priorVolume != null && priorVolume >= policy.minPriorVolume)
  if (!volumeOk) return reject('insufficient_volume')

  const delta = contract.analytics?.greeks?.delta
  if (delta == null) return reject('missing_analytics')
  const absDelta = Math.abs(delta)
  if (!within(absDelta, OPTIONS_CHAIN_DELTA_RANGE)) return reject('delta_outside_window')

  return {
    status: 'accepted',
    reason: null,
    cohort: cohortFor(dte, absDelta),
    dte,
    absDelta: Number(absDelta.toFixed(4)),
    analyticsAgeUnknown: contract.analytics?.age === 'unknown',
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
