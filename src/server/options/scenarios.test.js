// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  OPTIONS_PREMIUM_TARGETS_PCT, OPTIONS_SCENARIO_COST_ASSUMPTIONS, OPTIONS_SCENARIO_HORIZONS,
  OPTIONS_SCENARIO_IV_MULTIPLIERS, OPTIONS_SCENARIO_MOVES_PCT, OPTIONS_SCENARIO_PRIMARY_HORIZON,
  OPTIONS_SCENARIO_RANKING_PROFILE, buildChainScenarioSets, buildContractScenarioSet, resolveScenarioHorizons,
} from './scenarios.js'

const TRADING_DATE = '2026-09-22' // a Tuesday
const AS_OF = '2026-09-22T14:00:00.000Z' // 10:00 ET, inside the regular session

function callContract(overrides = {}) {
  return {
    contractId: 'osi:EX261022C00200000',
    osiSymbol: 'EX261022C00200000',
    type: 'call',
    strikePrice: 200,
    expirationDate: '2026-10-22',
    quote: { bid: 5.45, ask: 5.55, marketAt: AS_OF },
    ...overrides,
  }
}

function build(overrides = {}) {
  return buildContractScenarioSet({
    contract: callContract(),
    underlyingPrice: 180,
    asOf: AS_OF,
    tradingDate: TRADING_DATE,
    riskFreeRate: 0.04,
    ...overrides,
  })
}

describe('resolveScenarioHorizons', () => {
  const expirationDate = '2026-12-18'

  it('counts trading sessions, not calendar days', () => {
    const { horizons } = resolveScenarioHorizons({ asOf: AS_OF, tradingDate: TRADING_DATE, expirationDate })
    const byId = Object.fromEntries(horizons.map((horizon) => [horizon.id, horizon]))
    expect(byId.same_day_close.exitDate).toBe('2026-09-22')
    expect(byId['1_session'].exitDate).toBe('2026-09-23')
    expect(byId['3_sessions'].exitDate).toBe('2026-09-25')
    // Five sessions from a Tuesday lands on the following Tuesday: seven
    // calendar days, not five. Modelling this as "+5 days" under-decays the
    // contract by a whole weekend.
    expect(byId['5_sessions'].exitDate).toBe('2026-09-29')
    expect(byId['5_sessions'].calendarElapsedDays).toBe(7.25)
    expect(byId['5_sessions'].spansNonTradingDays).toBe(true)
    expect(byId['10_sessions'].exitDate).toBe('2026-10-06')
    expect(byId['10_sessions'].calendarElapsedDays).toBe(14.25)
  })

  it('steps over a holiday and lands on the right session', () => {
    // Thanksgiving 2026 falls on Thursday 26 November, and the 27th is an early
    // close. Three sessions from Tuesday the 24th is Monday the 30th.
    // 15:00Z is 10:00 ET here: November is EST, an hour further from UTC than
    // the September cases above.
    const { horizons } = resolveScenarioHorizons({
      asOf: '2026-11-24T15:00:00.000Z', tradingDate: '2026-11-24', expirationDate,
    })
    const byId = Object.fromEntries(horizons.map((horizon) => [horizon.id, horizon]))
    expect(byId['1_session'].exitDate).toBe('2026-11-25')
    expect(byId['3_sessions'].exitDate).toBe('2026-11-30')
    expect(byId['3_sessions'].calendarElapsedDays).toBeCloseTo(6.25, 2)
  })

  it('uses an early close as the exit instant on a half day', () => {
    const { horizons } = resolveScenarioHorizons({
      asOf: '2026-11-25T14:00:00.000Z', tradingDate: '2026-11-25', expirationDate,
    })
    // Next session after 25 November is the 27th, which closes at 13:00 ET.
    const next = horizons.find((horizon) => horizon.id === '1_session')
    expect(next.exitDate).toBe('2026-11-27')
    expect(next.exitAt).toBe('2026-11-27T18:00:00.000Z')
  })

  it('excludes horizons that land past the last trading session', () => {
    const { horizons } = resolveScenarioHorizons({ asOf: AS_OF, tradingDate: TRADING_DATE, expirationDate: '2026-09-25' })
    const byId = Object.fromEntries(horizons.map((horizon) => [horizon.id, horizon]))
    expect(byId['3_sessions'].status).toBe('available')
    expect(byId['3_sessions'].atExpiry).toBe(true)
    expect(byId['5_sessions']).toMatchObject({ status: 'excluded', reason: 'horizon_beyond_expiry' })
    expect(byId['10_sessions']).toMatchObject({ status: 'excluded', reason: 'horizon_beyond_expiry' })
  })

  it('backs an expiration that is not a session up to the session before it', () => {
    // 25 December 2026 is a holiday; the 24th is an early close.
    const resolved = resolveScenarioHorizons({ asOf: AS_OF, tradingDate: TRADING_DATE, expirationDate: '2026-12-25' })
    expect(resolved.lastTradeDate).toBe('2026-12-24')
    expect(resolved.expirationAdjusted).toBe(true)
    expect(resolved.lastTradeAt).toBe('2026-12-24T18:00:00.000Z')
  })

  it('resolves the same exit dates however the horizons are ordered', () => {
    const reversed = [...OPTIONS_SCENARIO_HORIZONS].reverse()
    const ordered = resolveScenarioHorizons({ asOf: AS_OF, tradingDate: TRADING_DATE, expirationDate })
    const shuffled = resolveScenarioHorizons({ asOf: AS_OF, tradingDate: TRADING_DATE, expirationDate, horizons: reversed })
    for (const horizon of ordered.horizons) {
      expect(shuffled.horizons.find((other) => other.id === horizon.id).exitDate).toBe(horizon.exitDate)
    }
  })

  it('refuses to build horizons from a day the market is closed', () => {
    expect(() => resolveScenarioHorizons({ asOf: '2026-09-26T14:00:00.000Z', tradingDate: '2026-09-26', expirationDate }))
      .toThrow(/trading session/)
  })
})

describe('the scenario matrix', () => {
  const set = build()

  it('publishes the full move x horizon x relative-IV grid', () => {
    expect(set.status).toBe('ok')
    expect(set.publishable).toBe(true)
    expect(set.scenarios).toHaveLength(
      OPTIONS_SCENARIO_MOVES_PCT.length * OPTIONS_SCENARIO_IV_MULTIPLIERS.length * OPTIONS_SCENARIO_HORIZONS.length,
    )
  })

  it('applies IV shocks relatively and shows both ends explicitly', () => {
    const entryIv = set.calibration.impliedVolatility
    const shocked = set.scenarios.filter((scenario) => scenario.ivMultiplier === 0.9)
    for (const scenario of shocked) {
      expect(scenario.startingImpliedVolatility).toBeCloseTo(entryIv, 6)
      // A 0.90 multiplier on ~59.5% is ~53.6%, not 49.5%.
      expect(scenario.endingImpliedVolatility).toBeCloseTo(entryIv * 0.9, 6)
      expect(scenario.endingImpliedVolatility).toBeGreaterThan(entryIv - 0.10)
    }
  })

  it('carries every field a reader needs to judge the row', () => {
    const row = set.scenarios[0]
    expect(Object.keys(row)).toEqual(expect.arrayContaining([
      'underlyingPrice', 'movePct', 'remainingCalendarDays', 'startingImpliedVolatility', 'endingImpliedVolatility',
      'theoreticalValue', 'midReturnPct', 'modeledBid', 'askEntryModeledBidReturnPct', 'entryCostPerContract',
      'greeks', 'moneyness', 'isOutOfTheMoney', 'intrinsicValue', 'extrinsicValue', 'gainWhileOutOfTheMoney',
    ]))
  })

  it('always shows the adverse and IV-crush cases beside the favourable ones', () => {
    const primary = set.scenarios.filter((scenario) => scenario.horizonId === OPTIONS_SCENARIO_PRIMARY_HORIZON)
    expect(primary.some((scenario) => scenario.movePct < 0 && scenario.midReturnPct < 0)).toBe(true)
    expect(primary.some((scenario) => scenario.movePct === 0 && scenario.midReturnPct < 0)).toBe(true)
    expect(primary.some((scenario) => scenario.ivMultiplier === 0.9)).toBe(true)
    expect(set.summary.worstMidReturnPct).toBeLessThan(0)
    expect(set.summary.bestMidReturnPct).toBeGreaterThan(0)
  })

  it('reprices delta and gamma at every move instead of freezing the entry Greeks', () => {
    const primary = set.scenarios
      .filter((scenario) => scenario.horizonId === OPTIONS_SCENARIO_PRIMARY_HORIZON && scenario.ivMultiplier === 1)
      .sort((a, b) => a.movePct - b.movePct)
    const deltas = primary.map((scenario) => scenario.greeks.delta)
    expect(new Set(deltas).size).toBe(deltas.length)
    // Delta rises with the underlying for a call, and every value differs from
    // the entry delta a frozen-Greek projection would have reused.
    for (let index = 1; index < deltas.length; index += 1) expect(deltas[index]).toBeGreaterThan(deltas[index - 1])
    expect(deltas.every((delta) => delta !== set.entry.greeks.delta)).toBe(true)
  })

  it('prices a large move by repricing, not by extrapolating the entry delta', () => {
    const up = set.scenarios.find((scenario) => scenario.horizonId === OPTIONS_SCENARIO_PRIMARY_HORIZON
      && scenario.movePct === 8 && scenario.ivMultiplier === 1)
    const frozenGreekEstimate = set.entry.theoreticalValue + set.entry.greeks.delta * (up.underlyingPrice - 180)
    // Gamma is worth real money over an 8% move: the repriced value is well
    // above the linear projection, which is why the epic forbids the shortcut.
    expect(up.theoreticalValue).toBeGreaterThan(frozenGreekEstimate + 0.25)
  })

  it('flags out-of-the-money correctly for a call and for a put', () => {
    const callRow = set.scenarios.find((scenario) => scenario.movePct === 8 && scenario.horizonId === OPTIONS_SCENARIO_PRIMARY_HORIZON && scenario.ivMultiplier === 1)
    expect(callRow.underlyingPrice).toBeLessThan(200)
    expect(callRow.isOutOfTheMoney).toBe(true)
    expect(callRow.moneyness).toBe('otm')

    const putSet = build({ contract: callContract({ type: 'put', strikePrice: 170, quote: { bid: 4.45, ask: 4.55 } }) })
    const putRow = putSet.scenarios.find((scenario) => scenario.movePct === -8 && scenario.horizonId === OPTIONS_SCENARIO_PRIMARY_HORIZON && scenario.ivMultiplier === 1)
    // 165.60 is BELOW the 170 strike, so this put is in the money -- the
    // opposite of the call at the same downward move.
    expect(putRow.underlyingPrice).toBeLessThan(170)
    expect(putRow.isOutOfTheMoney).toBe(false)
    expect(putRow.moneyness).toBe('itm')
    expect(putSet.scenarios.find((scenario) => scenario.movePct === 8 && scenario.horizonId === OPTIONS_SCENARIO_PRIMARY_HORIZON && scenario.ivMultiplier === 1).isOutOfTheMoney).toBe(true)
  })

  it('claims a gain while out of the money only when the premium rose AND the strike is still out of reach', () => {
    for (const scenario of set.scenarios) {
      expect(scenario.gainWhileOutOfTheMoney).toBe(scenario.askEntryModeledBidReturnPct > 0 && scenario.isOutOfTheMoney)
      expect(scenario.midGainWhileOutOfTheMoney).toBe(scenario.midReturnPct > 0 && scenario.isOutOfTheMoney)
    }
    const gainers = set.scenarios.filter((scenario) => scenario.gainWhileOutOfTheMoney)
    expect(gainers.length).toBeGreaterThan(0)
    for (const scenario of gainers) expect(scenario.underlyingPrice).toBeLessThan(200)
  })

  it('reports a round-trip return that is worse than the frictionless mid return', () => {
    const winner = set.scenarios.find((scenario) => scenario.midReturnPct > 20)
    expect(winner.askEntryModeledBidReturnPct).toBeLessThan(winner.midReturnPct)
    expect(winner.modeledBid).toBeLessThan(winner.theoreticalValue)
    const fees = OPTIONS_SCENARIO_COST_ASSUMPTIONS.commissionPerContract + OPTIONS_SCENARIO_COST_ASSUMPTIONS.regulatoryFeesPerContract
    expect(winner.entryCostPerContract).toBeCloseTo(set.entry.ask * 100 + fees, 4)
  })

  it('floors the modelled exit bid at zero rather than paying a reader to lose', () => {
    const wipeout = build({ contract: callContract({ expirationDate: '2026-09-25', quote: { bid: 0.10, ask: 0.20 } }) })
    for (const scenario of wipeout.scenarios) expect(scenario.modeledBid).toBeGreaterThanOrEqual(0)
  })
})

describe('time-only decay attribution', () => {
  const set = build()

  it('measures decay by full repricing at unchanged stock and IV, and says so', () => {
    for (const decay of set.timeOnlyDecay) {
      expect(decay.method).toBe('full-repricing-at-unchanged-stock-and-iv')
      expect(decay.thetaAppliedToReturns).toBe(false)
      expect(decay.decayPerShare).toBeLessThan(0)
    }
  })

  it('agrees exactly with the matrix cell at the same state, so the two can never disagree', () => {
    for (const decay of set.timeOnlyDecay) {
      const cell = set.scenarios.find((scenario) => scenario.horizonId === decay.horizonId
        && scenario.movePct === 0 && scenario.ivMultiplier === 1)
      expect(decay.theoreticalValue).toBe(cell.theoreticalValue)
      expect(decay.decayPerShare).toBeCloseTo(cell.theoreticalValue - set.entry.theoreticalValue, 6)
    }
  })

  it('accelerates with the holding period rather than scaling linearly with theta', () => {
    const byId = Object.fromEntries(set.timeOnlyDecay.map((decay) => [decay.horizonId, decay]))
    expect(Math.abs(byId['10_sessions'].decayPerShare)).toBeGreaterThan(Math.abs(byId['3_sessions'].decayPerShare))

    const straightLine = (decay) => Math.abs(decay.entryThetaPerCalendarDay * decay.calendarElapsedDays)
    // Over a few hours, entry theta is a fair approximation of the decay...
    const sameDay = byId.same_day_close
    expect(Math.abs(sameDay.decayPerShare)).toBeCloseTo(straightLine(sameDay), 2)
    // ...but theta is an instantaneous rate that accelerates as expiry nears, so
    // over a fortnight the real repriced decay runs well AHEAD of it. Projecting
    // entry theta x days would understate this loss by about 20 cents a share.
    const fortnight = byId['10_sessions']
    expect(Math.abs(fortnight.decayPerShare)).toBeGreaterThan(straightLine(fortnight) * 1.05)
  })
})

describe('premium-target inversion', () => {
  const set = build()

  it('solves the required move for every target, horizon and IV case', () => {
    expect(set.premiumTargets).toHaveLength(
      OPTIONS_PREMIUM_TARGETS_PCT.length * OPTIONS_SCENARIO_HORIZONS.length * OPTIONS_SCENARIO_IV_MULTIPLIERS.length,
    )
    const solved = set.premiumTargets.filter((target) => target.solved)
    expect(solved.length).toBeGreaterThan(0)
    for (const target of solved) {
      expect(target.requiredUnderlyingPrice).toBeGreaterThan(0)
      expect(target.impliedMoveBudgetPct).toBeGreaterThan(0)
    }
  })

  it('requires a bigger move for a bigger target, and a bigger one again when IV is crushed', () => {
    const at = (targetPct, ivMultiplier) => set.premiumTargets.find((target) => target.targetPct === targetPct
      && target.ivMultiplier === ivMultiplier && target.horizonId === OPTIONS_SCENARIO_PRIMARY_HORIZON)
    expect(at(50, 1).requiredMovePct).toBeGreaterThan(at(25, 1).requiredMovePct)
    expect(at(100, 1).requiredMovePct).toBeGreaterThan(at(50, 1).requiredMovePct)
    // Losing volatility means the stock has to do the work instead.
    expect(at(25, 0.9).requiredMovePct).toBeGreaterThan(at(25, 1).requiredMovePct)
    expect(at(25, 1.1).requiredMovePct).toBeLessThan(at(25, 1).requiredMovePct)
  })

  it('actually reaches the target at the move it reports', () => {
    const target = set.premiumTargets.find((entry) => entry.targetPct === 50
      && entry.ivMultiplier === 1 && entry.horizonId === OPTIONS_SCENARIO_PRIMARY_HORIZON)
    const verification = build({
      moves: [target.requiredMovePct], ivMultipliers: [1],
      horizons: OPTIONS_SCENARIO_HORIZONS.filter((horizon) => horizon.id === OPTIONS_SCENARIO_PRIMARY_HORIZON),
    })
    expect(verification.scenarios[0].theoreticalValue).toBeCloseTo(target.targetValuePerShare, 2)
    expect(verification.scenarios[0].askEntryModeledBidReturnPct).toBeCloseTo(50, 1)
  })

  it('prices the required move against the horizon implied move budget', () => {
    const target = set.premiumTargets.find((entry) => entry.targetPct === 100
      && entry.ivMultiplier === 1 && entry.horizonId === OPTIONS_SCENARIO_PRIMARY_HORIZON)
    expect(target.requiredMoveInImpliedMoves).toBeCloseTo(target.requiredMovePct / target.impliedMoveBudgetPct, 3)
    expect(target.requiredMoveInImpliedMoves).toBeGreaterThan(1)
  })

  it('reports no plausible solution rather than inventing one', () => {
    // Deep out of the money with two sessions left: no move inside the search
    // bound doubles this premium.
    const hopeless = build({
      contract: callContract({ strikePrice: 400, expirationDate: '2026-09-25', quote: { bid: 0.05, ask: 0.10 } }),
    })
    const impossible = hopeless.premiumTargets.filter((target) => !target.solved)
    expect(impossible.length).toBeGreaterThan(0)
    for (const target of impossible) {
      expect(target.reason).toBe('no_solution_within_search_bound')
      expect(target.requiredMovePct).toBeNull()
      expect(target.requiredUnderlyingPrice).toBeNull()
    }
    expect(hopeless.summary.unsolvedPremiumTargets).toBe(impossible.length)
  })

  it('inverts an at-expiry horizon on intrinsic value instead of running the model', () => {
    const expiring = build({ contract: callContract({ expirationDate: '2026-09-25' }) })
    const atExpiry = expiring.premiumTargets.filter((target) => target.horizonId === OPTIONS_SCENARIO_PRIMARY_HORIZON)
    for (const target of atExpiry) expect(target.basis).toBe('intrinsic-value-at-expiry')
    const solved = atExpiry.find((target) => target.solved)
    if (solved) expect(solved.requiredUnderlyingPrice).toBeCloseTo(200 + solved.targetValuePerShare, 4)
  })
})

describe('calibration and its failure modes', () => {
  it('blocks a primary IV-shock state that fails convergence even when entry passes', () => {
    const mid = 5.819334794988491
    const scenario = build({ underlyingPrice: 100,
      contract: callContract({ strikePrice: 95, quote: { bid: mid * 0.99, ask: mid * 1.01 } }),
      dividends: [{ exDate: '2026-09-28', amount: 3 }], steps: 32,
      ...OPTIONS_SCENARIO_RANKING_PROFILE,
    })
    expect(scenario.convergence.converged).toBe(true)
    expect(scenario.publishable).toBe(false)
    expect(scenario.blockers[0].code).toBe('primary_valuation_not_converged')
    expect(scenario.valuationChecks.find((check) => check.id === 'primary_iv_down').converged).toBe(false)
  })

  it('rejects malformed scenario inputs and unknown cash dividend amounts', () => {
    expect(() => build({ asOf: 'not-an-instant' })).toThrow(/valuation instant/)
    expect(() => build({ asOf: '2026-09-23T14:00:00Z' })).toThrow(/trading date/)
    expect(() => build({ dividends: [{ exDate: '2026-10-05', amount: null }] })).toThrow(/Dividend amount/)
    expect(() => build({ costs: { ...OPTIONS_SCENARIO_COST_ASSUMPTIONS, commissionPerContract: -1 } })).toThrow(/costs/)
    expect(() => build({ ivMultipliers: [Infinity] })).toThrow(/grid/)
  })
  it('calibrates to the synchronized midpoint and keeps the provider IV beside it', () => {
    const set = build({ providerImpliedVolatility: 0.62, assumptionSources: { providerAnalytics: 'alpaca' } })
    expect(set.calibration.status).toBe('calibrated')
    expect(set.calibration.calibratedToMid).toBe(5.5)
    expect(set.entry.theoreticalValue).toBeCloseTo(5.5, 3)
    // The provider's own number is recorded, never merged into ours.
    expect(set.calibration.provider).toEqual({ impliedVolatility: 0.62, source: 'alpaca' })
    expect(set.calibration.differenceVsProvider).toBeCloseTo(set.calibration.impliedVolatility - 0.62, 6)
  })

  it('blocks publication, with a reason, when the quote cannot be calibrated', () => {
    // A quote below intrinsic value: no volatility reproduces it.
    const set = build({ contract: callContract({ strikePrice: 100, quote: { bid: 5.45, ask: 5.55 } }) })
    expect(set.status).toBe('blocked')
    expect(set.publishable).toBe(false)
    expect(set.blockers).toEqual([{ code: 'calibration_failed', detail: 'price_below_no_arbitrage_lower_bound' }])
    expect(set.scenarios).toEqual([])
    expect(set.premiumTargets).toEqual([])
    expect(set.timeOnlyDecay).toEqual([])
  })

  it('blocks publication when the model has not converged', () => {
    // An in-the-money call over a $5 ex-dividend, priced on a 10-step lattice:
    // each step is three days, so the ex-date and the early-exercise decision
    // that hangs on it move materially when the step count is halved.
    const set = build({
      contract: callContract({ strikePrice: 160, quote: { bid: 22.0, ask: 22.4 } }),
      dividends: [{ exDate: '2026-09-30', amount: 5 }],
      steps: 10,
    })
    expect(set.publishable).toBe(false)
    expect(set.blockers[0].code).toBe('model_not_converged')
    expect(set.scenarios).toEqual([])
    // The failed check itself is retained, so the block is auditable rather
    // than just an empty result.
    expect(set.convergence.converged).toBe(false)
    expect(set.convergence.delta).toBeGreaterThan(set.convergence.tolerance)
  })

  it('blocks a contract whose last trade has already passed', () => {
    const set = build({ contract: callContract({ expirationDate: '2026-09-21' }) })
    expect(set.publishable).toBe(false)
    expect(set.blockers[0].code).toBe('contract_at_or_past_last_trade')
  })

  it('still records the contract, policy and assumptions on a blocked set', () => {
    const set = build({ contract: callContract({ strikePrice: 100, quote: { bid: 5.45, ask: 5.55 } }) })
    expect(set.contract.contractId).toBe('osi:EX261022C00200000')
    expect(set.policyVersion).toBeTruthy()
    expect(set.modelVersion).toBeTruthy()
    expect(set.assumptions.riskFreeRate).toBe(0.04)
  })

  it('refuses to build anything from a one-sided or crossed quote', () => {
    expect(() => build({ contract: callContract({ quote: { bid: 0, ask: 5.55 } }) })).toThrow(/two-sided quote/)
    expect(() => build({ contract: callContract({ quote: { bid: 5.6, ask: 5.55 } }) })).toThrow(/two-sided quote/)
  })
})

describe('assumptions and units', () => {
  it('keeps the borrow assumption visible instead of folding it into the dividend yield', () => {
    const set = build({ dividendYield: 0.01, borrowRate: 0.05 })
    expect(set.assumptions.continuousDividendYield).toBe(0.01)
    expect(set.assumptions.borrowRate).toBe(0.05)
    expect(set.assumptions.dividendYield).toBeCloseTo(0.06, 10)
  })

  it('records the IV shock convention and the cost model it priced with', () => {
    const set = build()
    expect(set.assumptions.ivShockConvention).toBe('relative-multiplier')
    expect(set.assumptions.costs.exitSpreadModel).toBe('entry-relative-spread')
    expect(set.assumptions.costs.contractMultiplier).toBe(100)
  })

  it('reports premium per share and cash per contract, and never mixes them', () => {
    const set = build()
    expect(set.entry.theoreticalValue).toBeCloseTo(5.5, 2)
    // 100 shares of premium plus a commission and fees on the way in, and the
    // same again on the way out for what is actually at risk.
    expect(set.entry.entryCostPerContract).toBeCloseTo(5.55 * 100 + 0.70, 4)
    expect(set.entry.premiumAtRiskPerContract).toBeCloseTo(5.55 * 100 + 1.40, 4)
  })

  it('carries a discrete dividend into the valuation', () => {
    const withDividend = build({
      contract: callContract({ strikePrice: 175, quote: { bid: 9.5, ask: 9.7 } }),
      dividends: [{ exDate: '2026-10-05', amount: 2 }],
    })
    const without = build({ contract: callContract({ strikePrice: 175, quote: { bid: 9.5, ask: 9.7 } }) })
    expect(withDividend.publishable).toBe(true)
    // Same quote, so both calibrate to the same price -- the dividend has to
    // show up as a higher fitted volatility instead.
    expect(withDividend.calibration.impliedVolatility).toBeGreaterThan(without.calibration.impliedVolatility)
  })
})

describe('buildChainScenarioSets', () => {
  it('separates publishable contracts from blocked ones without dropping either', () => {
    const result = buildChainScenarioSets({
      contracts: [
        callContract(),
        callContract({ contractId: 'osi:BAD', strikePrice: 100, quote: { bid: 5.45, ask: 5.55 } }),
      ],
      underlyingPrice: 180,
      asOf: AS_OF,
      tradingDate: TRADING_DATE,
      riskFreeRate: 0.04,
      ...OPTIONS_SCENARIO_RANKING_PROFILE,
    })
    expect(result.metrics).toMatchObject({
      contractCount: 2, publishableCount: 1, blockedCount: 1, blockerCodes: ['calibration_failed'],
    })
    expect(result.scenarioSets).toHaveLength(2)
    expect(result.publishable).toHaveLength(1)
    expect(result.blocked[0].contract.contractId).toBe('osi:BAD')
  })

  it('reduces to the primary horizon and the scoring target under the ranking profile', () => {
    const set = build(OPTIONS_SCENARIO_RANKING_PROFILE)
    expect(set.summary.availableHorizons).toEqual([OPTIONS_SCENARIO_PRIMARY_HORIZON])
    expect(set.scenarios).toHaveLength(OPTIONS_SCENARIO_MOVES_PCT.length * OPTIONS_SCENARIO_IV_MULTIPLIERS.length)
    expect(new Set(set.premiumTargets.map((target) => target.targetPct))).toEqual(new Set([25]))
  })
})
