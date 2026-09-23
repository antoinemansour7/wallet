// Premium scenarios and premium-target analysis (epic #201 section 11, story #210).
//
// Answers the question the scanner exists for: what happens to this contract's
// PREMIUM over an explicit holding period, including the cases where the stock
// moves the wrong way, the IV collapses, or nothing happens at all. Every number
// here is a full repricing of the model in src/server/options/pricing.js at an
// explicit (stock, time, IV) state. Nothing is extrapolated from a frozen Greek,
// and theta is never subtracted on top of a repriced value -- the decay IS the
// repricing difference, and double-counting it would overstate every loss.
//
// A scenario is not a forecast, a probability, or an expectation. The matrix is
// deliberately symmetric: the adverse and IV-crush cases are produced by the
// same code path as the favourable ones and cannot be dropped by a caller that
// only wants the good news.

import {
  OPTIONS_CALENDAR_2026, marketDay, optionsLocalParts, regularSessionClose, zonedMarketInstant,
} from './calendar.js'
import {
  OPTIONS_PRICING_MODEL_VERSION, assessPricingConvergence, calibrateImpliedVolatility,
  priceWithGreeks, solveSpotForValue,
} from './pricing.js'

export const OPTIONS_SCENARIO_POLICY_VERSION = 'options-scenario-matrix-v2'

// Symmetric signed percentage moves in the UNDERLYING; both sides include 2% and 3%.
export const OPTIONS_SCENARIO_MOVES_PCT = Object.freeze([-8, -5, -3, -2, 0, 2, 3, 5, 8])

// RELATIVE IV shocks. 0.90 on a 60% IV is 54%, not 50%. Both the starting and
// the ending IV are carried on every scenario row so the distinction is visible
// rather than merely documented.
export const OPTIONS_SCENARIO_IV_MULTIPLIERS = Object.freeze([0.90, 1.00, 1.10])

// Trading sessions held, never calendar-day offsets. `sessions: 0` is today's
// close; the rest are the closes of the next N sessions.
export const OPTIONS_SCENARIO_HORIZONS = Object.freeze([
  Object.freeze({ id: 'same_day_close', sessions: 0 }),
  Object.freeze({ id: '1_session', sessions: 1 }),
  Object.freeze({ id: '3_sessions', sessions: 3 }),
  Object.freeze({ id: '5_sessions', sessions: 5 }),
  Object.freeze({ id: '10_sessions', sessions: 10 }),
])

// Fixed primary horizon for score comparability (epic section 10). Everything
// else is an additional research scenario, never the headline.
export const OPTIONS_SCENARIO_PRIMARY_HORIZON = '3_sessions'

export const OPTIONS_PREMIUM_TARGETS_PCT = Object.freeze([25, 50, 100])

// Ranking uses the primary horizon and +25% net target. The full matrix keeps
// all five horizons for displayed contracts; both profiles share the same
// primary-horizon calculations and return exactly the same score.
export const OPTIONS_SCENARIO_RANKING_PROFILE = Object.freeze({
  horizons: Object.freeze(OPTIONS_SCENARIO_HORIZONS.filter((horizon) => horizon.id === OPTIONS_SCENARIO_PRIMARY_HORIZON)),
  targets: Object.freeze([25]),
})

export const OPTIONS_SCENARIO_COST_ASSUMPTIONS = Object.freeze({
  version: 'options-scenario-costs-v1',
  contractMultiplier: 100,
  commissionPerContract: 0.65,
  regulatoryFeesPerContract: 0.05,
  entryFill: 'ask',
  exitFill: 'modeled-bid',
  // The exit spread is modelled as the entry spread PERCENTAGE applied to the
  // scenario's theoretical value, not as a frozen dollar spread: a fixed dollar
  // spread on a premium that has halved implies a spread percentage no market
  // maker quotes, and on a deep loss it drives the modelled bid negative.
  exitSpreadModel: 'entry-relative-spread',
})

// The move search for premium-target inversion. Past this, "the stock would have
// to move 60%" is not a research finding, it is a no.
export const OPTIONS_SCENARIO_SEARCH_BOUND = 0.6

// Scenario repricing runs at half the pricer's own default step count: the
// oracle fixtures pass at 128 steps, so 256 keeps a full factor of two in hand
// while keeping a 135-cell matrix affordable inside the opening stage window.
// The convergence gate below runs at THIS step count, so what is checked is
// what is actually used.
export const OPTIONS_SCENARIO_STEPS = 256

const MS_PER_DAY = 86400000
const MS_PER_YEAR = 365 * MS_PER_DAY

function round(value, digits = 6) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits))
}

function addCalendarDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10)
}

function nextSessionDate(date, calendar) {
  let cursor = date
  for (let attempt = 0; attempt < 30; attempt += 1) {
    cursor = addCalendarDays(cursor, 1)
    const day = marketDay(cursor, calendar)
    if (!day.known) return null
    if (day.open) return cursor
  }
  return null
}

export function resolveOptionsHoldingExit(tradingDate, sessions = 3, calendar = OPTIONS_CALENDAR_2026) {
  let exitDate = tradingDate
  if (!marketDay(tradingDate, calendar).open) return null
  for (let count = 0; count < sessions; count += 1) {
    exitDate = nextSessionDate(exitDate, calendar)
    if (!exitDate) return null
  }
  return { exitDate, exitAt: regularSessionClose(exitDate, calendar) }
}

// US equity options stop trading at the close of their expiration date. When
// that date is not itself a session -- a holiday, or a legacy Saturday-dated
// series -- the last trade happens at the close of the session before it.
function lastTradingSession(expirationDate, calendar) {
  for (let back = 0; back < 10; back += 1) {
    const date = addCalendarDays(expirationDate, -back)
    const day = marketDay(date, calendar)
    if (!day.known) return null
    if (day.open) return { date, adjusted: back > 0 }
  }
  return null
}

function yearsBetween(fromInstant, toInstant) {
  return (Date.parse(toInstant) - Date.parse(fromInstant)) / MS_PER_YEAR
}

// Resolve each session horizon to a real exit instant on the exchange calendar.
// This is the whole point of the horizon machinery: three sessions from a Friday
// is the following Wednesday's close, five calendar days later, and over a
// holiday weekend it is more. Modelling it as "+3 days" silently under-decays
// every contract in the matrix.
export function resolveScenarioHorizons({
  asOf, tradingDate, expirationDate, calendar = OPTIONS_CALENDAR_2026, horizons = OPTIONS_SCENARIO_HORIZONS,
} = {}) {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error('Scenario horizons require a valid valuation instant')
  if (optionsLocalParts(asOf).date !== tradingDate) throw new Error('Valuation instant must fall on the trading date')
  if (horizons.some((horizon) => !Number.isInteger(horizon.sessions) || horizon.sessions < 0)) throw new Error('Scenario horizons require non-negative session counts')
  const today = marketDay(tradingDate, calendar)
  if (!today.known || !today.open) throw new Error(`Scenario horizons require a trading session: ${tradingDate} is ${today.reason}`)
  const lastSession = lastTradingSession(expirationDate, calendar)
  if (!lastSession) throw new Error(`Cannot resolve a last trading session for expiration ${expirationDate}`)
  const lastTradeAt = regularSessionClose(lastSession.date, calendar)

  // Walk the calendar once to the furthest horizon and index the result by
  // session count, so horizons resolve correctly whatever order they arrive in.
  const sessionDates = [tradingDate]
  const furthest = Math.max(0, ...horizons.map((horizon) => horizon.sessions))
  for (let session = 1; session <= furthest; session += 1) {
    const next = nextSessionDate(sessionDates[session - 1], calendar)
    if (!next) break
    sessionDates.push(next)
  }

  const resolved = []
  for (const horizon of horizons) {
    const cursor = sessionDates[horizon.sessions]
    if (!cursor) {
      resolved.push({ ...horizon, status: 'excluded', reason: 'exit_session_outside_calendar_range' })
      continue
    }
    const exitAt = regularSessionClose(cursor, calendar)
    const elapsedMs = Date.parse(exitAt) - Date.parse(asOf)
    const base = {
      ...horizon,
      exitDate: cursor,
      exitAt,
      lastTradeAt,
      expirationAdjusted: lastSession.adjusted,
      calendarElapsedDays: round(elapsedMs / MS_PER_DAY, 4),
      // A three-session hold that spans a weekend is five calendar days of
      // decay. Surfacing both numbers is what stops a reader from reading
      // "3 sessions" as "3 days".
      calendarElapsedSessions: horizon.sessions,
      spansNonTradingDays: elapsedMs / MS_PER_DAY > horizon.sessions + 1,
    }
    if (elapsedMs < 0) { resolved.push({ ...base, status: 'excluded', reason: 'exit_before_valuation_time' }); continue }
    if (Date.parse(exitAt) > Date.parse(lastTradeAt)) { resolved.push({ ...base, status: 'excluded', reason: 'horizon_beyond_expiry' }); continue }
    const remainingYears = yearsBetween(exitAt, lastTradeAt)
    resolved.push({
      ...base,
      status: 'available',
      reason: null,
      remainingYears: round(remainingYears, 8),
      remainingCalendarDays: round(remainingYears * 365, 4),
      atExpiry: remainingYears <= 0,
    })
  }
  return { lastTradeAt, lastTradeDate: lastSession.date, expirationAdjusted: lastSession.adjusted, horizons: resolved }
}

// Dividends are dated in the calendar; the model wants year fractions from the
// valuation instant. Anything already ex by then is gone from the option's life.
function dividendsFrom(instant, dividends, calendar) {
  return dividends
    .map((dividend) => {
      if (!Number.isFinite(dividend.amount) || dividend.amount < 0) throw new Error('Dividend amount is unavailable or invalid')
      return {
        exDate: dividend.exDate,
        amount: dividend.amount,
        // Dividends go ex at the opening bell of the ex-date.
        timeYears: yearsBetween(instant, zonedMarketInstant(dividend.exDate, calendar.regular.open, calendar.timeZone)),
      }
    })
    .filter((dividend) => dividend.timeYears > 0 && dividend.amount > 0)
}

function moneyness(type, underlyingPrice, strike) {
  if (underlyingPrice === strike) return 'atm'
  if (type === 'call') return underlyingPrice > strike ? 'itm' : 'otm'
  return underlyingPrice < strike ? 'itm' : 'otm'
}

function intrinsic(type, underlyingPrice, strike) {
  return type === 'call' ? Math.max(underlyingPrice - strike, 0) : Math.max(strike - underlyingPrice, 0)
}

// Round-trip economics for one contract at the declared cost assumptions.
// Entry is at the ask and exit at a modelled bid, because that is what a real
// round trip costs; the frictionless mid-to-mid return is reported alongside it,
// never instead of it.
function tradeEconomics({ entryAsk, theoreticalValue, spreadFraction, costs }) {
  const multiplier = costs.contractMultiplier
  const perContractFees = costs.commissionPerContract + costs.regulatoryFeesPerContract
  const entryCost = entryAsk * multiplier + perContractFees
  const modeledBid = Math.max(theoreticalValue * (1 - spreadFraction / 2), 0)
  const exitProceeds = modeledBid * multiplier - perContractFees
  return {
    modeledBid: round(modeledBid, 4),
    entryCostPerContract: round(entryCost, 4),
    exitProceedsPerContract: round(exitProceeds, 4),
    askEntryModeledBidReturnPct: round(((exitProceeds - entryCost) / entryCost) * 100, 4),
  }
}

function scenarioRow({
  horizon, movePct, ivMultiplier, contract, entry, assumptions, steps,
}) {
  const underlyingPrice = entry.underlyingPrice * (1 + movePct / 100)
  const volatility = entry.impliedVolatility * ivMultiplier
  // Same for all 27 cells of a horizon, so it is resolved once per horizon.
  const dividends = horizon.dividends
  const priced = horizon.remainingYears <= 0
    ? { price: intrinsic(contract.type, underlyingPrice, contract.strikePrice),
      delta: intrinsic(contract.type, underlyingPrice, contract.strikePrice) > 0 ? (contract.type === 'call' ? 1 : -1) : 0,
      gamma: 0, vega: 0, theta: 0 }
    : priceWithGreeks({
      type: contract.type, exercise: 'american', spot: underlyingPrice, strike: contract.strikePrice,
      timeYears: horizon.remainingYears, volatility, riskFreeRate: assumptions.riskFreeRate,
      dividendYield: assumptions.dividendYield, dividends, steps,
    }, { includeRho: false })
  const state = moneyness(contract.type, underlyingPrice, contract.strikePrice)
  const economics = tradeEconomics({
    entryAsk: entry.ask, theoreticalValue: priced.price, spreadFraction: entry.spreadFraction, costs: assumptions.costs,
  })
  const midReturnPct = ((priced.price - entry.mid) / entry.mid) * 100
  return {
    horizonId: horizon.id,
    sessions: horizon.sessions,
    exitAt: horizon.exitAt,
    calendarElapsedDays: horizon.calendarElapsedDays,
    remainingCalendarDays: horizon.remainingCalendarDays,
    remainingYears: horizon.remainingYears,
    movePct,
    underlyingPrice: round(underlyingPrice, 4),
    ivMultiplier,
    startingImpliedVolatility: round(entry.impliedVolatility, 6),
    endingImpliedVolatility: round(volatility, 6),
    theoreticalValue: round(priced.price, 4),
    midReturnPct: round(midReturnPct, 4),
    ...economics,
    // Repriced at this scenario's own state. A delta or gamma carried over from
    // entry would be wrong by construction at a +8% move.
    greeks: {
      delta: round(priced.delta, 6), gamma: round(priced.gamma, 6),
      vega: round(priced.vega, 6), theta: round(priced.theta, 6),
    },
    moneyness: state,
    isOutOfTheMoney: state === 'otm',
    intrinsicValue: round(intrinsic(contract.type, underlyingPrice, contract.strikePrice), 4),
    extrinsicValue: round(priced.price - intrinsic(contract.type, underlyingPrice, contract.strikePrice), 4),
    // The epic's headline claim, and the only place it may be made: a modelled
    // gain that is still short of the strike. Both halves must hold.
    midGainWhileOutOfTheMoney: midReturnPct > 0 && state === 'otm',
    gainWhileOutOfTheMoney: economics.askEntryModeledBidReturnPct > 0 && state === 'otm',
  }
}

// Time-only decay: reprice with the stock and the IV held exactly where they
// started, and take the difference. Reported separately from theta, which is a
// point-in-time rate and is NOT applied to any return in this module.
//
// Takes the matrix's own unchanged-stock cell rather than recomputing it, so the
// decay figure and the 0%-move row of the published matrix cannot drift apart.
function timeOnlyDecay({ horizon, unchangedRow: row, entry }) {
  return {
    horizonId: horizon.id,
    sessions: horizon.sessions,
    calendarElapsedDays: horizon.calendarElapsedDays,
    remainingCalendarDays: horizon.remainingCalendarDays,
    theoreticalValue: row.theoreticalValue,
    decayPerShare: round(row.theoreticalValue - entry.theoreticalValue, 4),
    decayPctOfEntryPremium: round(((row.theoreticalValue - entry.theoreticalValue) / entry.mid) * 100, 4),
    entryThetaPerCalendarDay: round(entry.greeks.theta, 6),
    method: 'full-repricing-at-unchanged-stock-and-iv',
    thetaAppliedToReturns: false,
  }
}

// Invert the model: what does the stock have to do for the premium to reach
// +25%/+50%/+100%? Reported against the horizon's own implied move budget, so a
// "required move" that is three implied moves reads as the long shot it is.
function premiumTargetRow({ targetPct, horizon, ivMultiplier, contract, entry, assumptions, steps }) {
  const { contractMultiplier: multiplier, commissionPerContract, regulatoryFeesPerContract } = assumptions.costs
  const fees = commissionPerContract + regulatoryFeesPerContract
  // Solve the very same ask-entry / bid-exit economics shown in the matrix.
  // (V * bidFactor * multiplier - exitFee) / entryCost = 1 + target.
  const entryCost = entry.ask * multiplier + fees
  const targetValue = (entryCost * (1 + targetPct / 100) + fees) / (multiplier * (1 - entry.spreadFraction / 2))
  const volatility = entry.impliedVolatility * ivMultiplier
  const impliedMoveBudgetPct = entry.impliedVolatility * Math.sqrt(Math.max(horizon.calendarElapsedDays, 0) / 365) * 100
  const base = {
    targetPct,
    targetReturnBasis: 'ask-entry-modeled-bid-exit-after-fees',
    frictionlessTargetValuePerShare: round(entry.mid * (1 + targetPct / 100), 4),
    targetValuePerShare: round(targetValue, 4),
    horizonId: horizon.id,
    ivMultiplier,
    startingImpliedVolatility: round(entry.impliedVolatility, 6),
    endingImpliedVolatility: round(volatility, 6),
    impliedMoveBudgetPct: round(impliedMoveBudgetPct, 4),
    searchBoundPct: OPTIONS_SCENARIO_SEARCH_BOUND * 100,
  }
  if (horizon.remainingYears <= 0) {
    // At expiry the premium IS the intrinsic value; inverting it is a
    // one-line identity, not a model solve, and saying so is more honest
    // than reporting a bisection result.
    const required = contract.type === 'call' ? contract.strikePrice + targetValue : contract.strikePrice - targetValue
    const movePct = ((required - entry.underlyingPrice) / entry.underlyingPrice) * 100
    const withinBound = required > 0 && Math.abs(movePct) <= OPTIONS_SCENARIO_SEARCH_BOUND * 100
    return {
      ...base,
      solved: withinBound,
      reason: withinBound ? null : 'no_solution_within_search_bound',
      basis: 'intrinsic-value-at-expiry',
      requiredMovePct: withinBound ? round(movePct, 4) : null,
      requiredUnderlyingPrice: withinBound ? round(required, 4) : null,
      requiredMoveInImpliedMoves: withinBound && impliedMoveBudgetPct > 0 ? round(movePct / impliedMoveBudgetPct, 4) : null,
    }
  }
  const solution = solveSpotForValue({
    targetValue,
    searchBound: OPTIONS_SCENARIO_SEARCH_BOUND,
    type: contract.type, exercise: 'american', spot: entry.underlyingPrice, strike: contract.strikePrice,
    timeYears: horizon.remainingYears, volatility, riskFreeRate: assumptions.riskFreeRate,
    dividendYield: assumptions.dividendYield, dividends: horizon.dividends,
    steps,
  })
  return {
    ...base,
    solved: solution.solved,
    reason: solution.reason,
    basis: 'model-inversion',
    requiredMovePct: round(solution.movePct, 4),
    requiredUnderlyingPrice: round(solution.spot, 4),
    requiredMoveInImpliedMoves: solution.solved && impliedMoveBudgetPct > 0 ? round(solution.movePct / impliedMoveBudgetPct, 4) : null,
  }
}

function blocked(blockers, detail) {
  return {
    policyVersion: OPTIONS_SCENARIO_POLICY_VERSION,
    modelVersion: OPTIONS_PRICING_MODEL_VERSION,
    status: 'blocked',
    // The flag the ranking stage reads. A blocked set carries no scenarios at
    // all: a half-valued contract that still ranks is the failure mode this
    // exists to prevent.
    publishable: false,
    blockers,
    scenarios: [],
    timeOnlyDecay: [],
    premiumTargets: [],
    ...detail,
  }
}

export function buildContractScenarioSet({
  contract,
  underlyingPrice,
  asOf,
  tradingDate,
  riskFreeRate,
  dividendYield = 0,
  borrowRate = 0,
  dividends = [],
  providerImpliedVolatility = null,
  assumptionSources = {},
  calendar = OPTIONS_CALENDAR_2026,
  costs = OPTIONS_SCENARIO_COST_ASSUMPTIONS,
  moves = OPTIONS_SCENARIO_MOVES_PCT,
  ivMultipliers = OPTIONS_SCENARIO_IV_MULTIPLIERS,
  targets = OPTIONS_PREMIUM_TARGETS_PCT,
  horizons = OPTIONS_SCENARIO_HORIZONS,
  steps = OPTIONS_SCENARIO_STEPS,
} = {}) {
  if (contract?.type !== 'call' && contract?.type !== 'put') throw new Error('Scenario building requires a call or put contract')
  if (!Number.isFinite(contract.strikePrice) || !(contract.strikePrice > 0)) throw new Error('Scenario building requires a finite positive strike')
  if (!Number.isFinite(underlyingPrice) || !(underlyingPrice > 0)) throw new Error('Scenario building requires a finite positive underlying price')
  if (!Number.isFinite(riskFreeRate)) throw new Error('Scenario building requires a risk-free rate assumption')
  if (!Number.isFinite(dividendYield) || !Number.isFinite(borrowRate)) throw new Error('Scenario building requires finite carry assumptions')
  if (!(costs.contractMultiplier > 0) || !Number.isFinite(costs.contractMultiplier)
    || ![costs.commissionPerContract, costs.regulatoryFeesPerContract].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('Invalid scenario costs')
  if (!moves.every((value) => Number.isFinite(value) && value > -100)
    || !ivMultipliers.every((value) => Number.isFinite(value) && value > 0)
    || !targets.every((value) => Number.isFinite(value) && value > 0)) throw new Error('Invalid scenario grid')

  const bid = contract.quote?.bid
  const ask = contract.quote?.ask
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || !(bid > 0) || !(ask > bid)) throw new Error('Scenario building requires a two-sided quote')
  const mid = (bid + ask) / 2
  const spreadPct = (ask - bid) / mid

  const identity = {
    contractId: contract.contractId,
    osiSymbol: contract.osiSymbol,
    type: contract.type,
    strikePrice: contract.strikePrice,
    expirationDate: contract.expirationDate,
  }

  const timing = resolveScenarioHorizons({ asOf, tradingDate, expirationDate: contract.expirationDate, calendar, horizons })
  const entryRemainingYears = yearsBetween(asOf, timing.lastTradeAt)

  // Borrow is carried in the same continuous term as a dividend yield -- it
  // lowers the forward the same way -- but it stays visible as its own declared
  // assumption rather than being silently folded into "dividendYield".
  const carry = dividendYield + borrowRate
  const assumptions = {
    riskFreeRate,
    continuousDividendYield: dividendYield,
    borrowRate,
    dividendYield: carry,
    dividends,
    costs,
    moves,
    ivMultipliers,
    targets,
    pricingSteps: steps,
    ivShockConvention: 'relative-multiplier',
    sources: assumptionSources,
  }

  const context = {
    policyVersion: OPTIONS_SCENARIO_POLICY_VERSION,
    modelVersion: OPTIONS_PRICING_MODEL_VERSION,
    contract: identity,
    asOf,
    tradingDate,
    lastTradeAt: timing.lastTradeAt,
    expirationAdjusted: timing.expirationAdjusted,
    assumptions,
    horizons: timing.horizons,
  }

  if (!(entryRemainingYears > 0)) {
    return blocked([{ code: 'contract_at_or_past_last_trade', detail: timing.lastTradeAt }], context)
  }

  const entryDividends = dividendsFrom(asOf, dividends, calendar)
  const modelInputs = {
    type: contract.type, exercise: 'american', spot: underlyingPrice, strike: contract.strikePrice,
    timeYears: entryRemainingYears, riskFreeRate, dividendYield: carry, dividends: entryDividends, steps,
  }

  // Calibrate to the synchronized midpoint. The provider's own IV is recorded
  // beside it and never merged into it: they use different models, different
  // rate and dividend assumptions, and different quote timestamps, and a
  // disagreement between them is a signal worth keeping, not an error to hide.
  const calibration = calibrateImpliedVolatility({ targetPrice: mid, ...modelInputs })
  const calibrationRecord = {
    ...calibration,
    calibratedToMid: round(mid, 4),
    provider: {
      impliedVolatility: providerImpliedVolatility,
      source: assumptionSources.providerAnalytics || 'not_supplied',
    },
    differenceVsProvider: calibration.status === 'calibrated' && Number.isFinite(providerImpliedVolatility)
      ? round(calibration.impliedVolatility - providerImpliedVolatility, 6)
      : null,
  }
  if (calibration.status !== 'calibrated') {
    return blocked([{ code: 'calibration_failed', detail: calibration.reason }], { ...context, calibration: calibrationRecord })
  }

  const convergence = assessPricingConvergence({ ...modelInputs, volatility: calibration.impliedVolatility })
  if (!convergence.converged) {
    return blocked(
      [{ code: 'model_not_converged', detail: convergence.reason }],
      { ...context, calibration: calibrationRecord, convergence },
    )
  }

  const entryGreeks = priceWithGreeks({ ...modelInputs, volatility: calibration.impliedVolatility })
  const entryState = moneyness(contract.type, underlyingPrice, contract.strikePrice)
  const entry = {
    underlyingPrice,
    bid: round(bid, 4),
    ask: round(ask, 4),
    mid: round(mid, 4),
    spreadPct: round(spreadPct * 100, 4),
    impliedVolatility: calibration.impliedVolatility,
    remainingYears: round(entryRemainingYears, 8),
    remainingCalendarDays: round(entryRemainingYears * 365, 4),
    theoreticalValue: round(entryGreeks.price, 4),
    greeks: {
      delta: round(entryGreeks.delta, 6), gamma: round(entryGreeks.gamma, 6),
      vega: round(entryGreeks.vega, 6), theta: round(entryGreeks.theta, 6), rho: round(entryGreeks.rho, 6),
    },
    moneyness: entryState,
    isOutOfTheMoney: entryState === 'otm',
    entryCostPerContract: round(ask * costs.contractMultiplier + costs.commissionPerContract + costs.regulatoryFeesPerContract, 4),
    // What a reader can actually lose: the whole premium, plus the costs of
    // getting in and out.
    premiumAtRiskPerContract: round(ask * costs.contractMultiplier + (costs.commissionPerContract + costs.regulatoryFeesPerContract) * 2, 4),
  }

  // The internal shape scenarioRow needs; `impliedVolatility` here is the
  // calibrated anchor every relative IV shock is applied to.
  const pricingEntry = {
    underlyingPrice, ask, mid,
    // The raw fraction, deliberately named apart from the published
    // `entry.spreadPct`, which is the same quantity as a percentage.
    spreadFraction: spreadPct,
    impliedVolatility: calibration.impliedVolatility,
    theoreticalValue: entryGreeks.price,
    greeks: entryGreeks,
  }
  // Which dividends are still ahead depends only on the exit instant, so it is
  // resolved once per horizon instead of once per cell.
  const available = timing.horizons
    .filter((horizon) => horizon.status === 'available')
    .map((horizon) => ({ ...horizon, dividends: dividendsFrom(horizon.exitAt, dividends, calendar) }))

  const scenarios = []
  for (const horizon of available) {
    for (const movePct of moves) {
      for (const ivMultiplier of ivMultipliers) {
        scenarios.push(scenarioRow({ horizon, movePct, ivMultiplier, contract: identity, entry: pricingEntry, assumptions, steps }))
      }
    }
  }

  const decay = available.map((horizon) => {
    const unchangedRow = scenarios.find((scenario) => scenario.horizonId === horizon.id && scenario.movePct === 0 && scenario.ivMultiplier === 1)
      // Only reachable when a caller overrides `moves` or `ivMultipliers` away
      // from the policy defaults; the decay attribution is still owed.
      || scenarioRow({ horizon, movePct: 0, ivMultiplier: 1, contract: identity, entry: pricingEntry, assumptions, steps })
    return timeOnlyDecay({ horizon, unchangedRow, entry: pricingEntry })
  })

  const premiumTargets = []
  for (const targetPct of targets) {
    for (const horizon of available) {
      for (const ivMultiplier of ivMultipliers) {
        premiumTargets.push(premiumTargetRow({ targetPct, horizon, ivMultiplier, contract: identity, entry: pricingEntry, assumptions, steps }))
      }
    }
  }

  // Entry convergence alone does not validate the states that determine the
  // score: rolling toward a dividend or exercise boundary can change lattice
  // error. Check the two carry/IV anchors and the primary net-target solution.
  // The identical checks run in both the ranking and full-matrix profiles.
  const primary = available.find((horizon) => horizon.id === OPTIONS_SCENARIO_PRIMARY_HORIZON)
  const valuationChecks = []
  if (primary) {
    const primaryTarget = premiumTargets.find((target) => target.horizonId === primary.id && target.targetPct === 25 && target.ivMultiplier === 1)
    const states = [
      { id: 'primary_unchanged', spot: underlyingPrice, ivMultiplier: 1 },
      { id: 'primary_iv_down', spot: underlyingPrice, ivMultiplier: 0.9 },
      ...(primaryTarget?.solved ? [{ id: 'primary_net_target', spot: primaryTarget.requiredUnderlyingPrice, ivMultiplier: 1 }] : []),
    ]
    for (const state of states) {
      valuationChecks.push({ id: state.id, ...assessPricingConvergence({ ...modelInputs,
        spot: state.spot, timeYears: primary.remainingYears, dividends: primary.dividends,
        volatility: calibration.impliedVolatility * state.ivMultiplier }) })
    }
  }
  if (valuationChecks.some((check) => !check.converged)) {
    return blocked([{ code: 'primary_valuation_not_converged', detail: valuationChecks.filter((check) => !check.converged).map((check) => check.id).join(',') }],
      { ...context, calibration: calibrationRecord, convergence, valuationChecks })
  }

  const returns = scenarios.map((scenario) => scenario.midReturnPct)
  return {
    ...context,
    status: 'ok',
    publishable: true,
    blockers: [],
    calibration: calibrationRecord,
    convergence,
    valuationChecks,
    entry,
    scenarios,
    timeOnlyDecay: decay,
    premiumTargets,
    summary: {
      scenarioCount: scenarios.length,
      availableHorizons: available.map((horizon) => horizon.id),
      excludedHorizons: timing.horizons.filter((horizon) => horizon.status !== 'available').map((horizon) => ({ id: horizon.id, reason: horizon.reason })),
      primaryHorizonAvailable: available.some((horizon) => horizon.id === OPTIONS_SCENARIO_PRIMARY_HORIZON),
      bestMidReturnPct: returns.length ? round(Math.max(...returns), 4) : null,
      worstMidReturnPct: returns.length ? round(Math.min(...returns), 4) : null,
      worstTheoreticalValue: scenarios.length ? round(Math.min(...scenarios.map((scenario) => scenario.theoreticalValue)), 4) : null,
      gainWhileOutOfTheMoneyCount: scenarios.filter((scenario) => scenario.gainWhileOutOfTheMoney).length,
      unsolvedPremiumTargets: premiumTargets.filter((target) => !target.solved).length,
    },
  }
}

// Chain-level entry point. A contract whose model failed is kept, with its
// blockers, and excluded from `publishable` -- dropping it silently would make
// a calibration outage look like a thin chain.
export function buildChainScenarioSets({ contracts = [], ...shared } = {}) {
  const sets = contracts.map((contract) => buildContractScenarioSet({ ...shared, contract, underlyingPrice: shared.underlyingPrice }))
  const blockedSets = sets.filter((set) => !set.publishable)
  return {
    policyVersion: OPTIONS_SCENARIO_POLICY_VERSION,
    modelVersion: OPTIONS_PRICING_MODEL_VERSION,
    scenarioSets: sets,
    publishable: sets.filter((set) => set.publishable),
    blocked: blockedSets,
    metrics: {
      contractCount: sets.length,
      publishableCount: sets.length - blockedSets.length,
      blockedCount: blockedSets.length,
      blockerCodes: [...new Set(blockedSets.flatMap((set) => set.blockers.map((blocker) => blocker.code)))].sort(),
    },
  }
}
