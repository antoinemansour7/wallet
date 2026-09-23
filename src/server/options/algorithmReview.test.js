// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { priceOption } from './pricing.js'
import { scoreOpeningContract } from './publication.js'
import { buildContractScenarioSet, OPTIONS_SCENARIO_RANKING_PROFILE, resolveScenarioHorizons } from './scenarios.js'

const points = (result, name) => result.score.components.find((item) => item.component === name).points
const set = (result) => result.scenario.scenarioSet
const target = (result) => set(result).premiumTargets.find((item) => item.ivMultiplier === 1)
// Every midpoint comes from a specified IV, then the production pipeline must
// recover it. Provider delta is deliberately wrong so it cannot anchor results.
function evaluate({
  type = 'call', spot = 100, strike = 103, expirationDate = '2026-10-16',
  iv = 0.35, spread = 0.02, openInterest = 2000, volume = 100, scale = 1, providerDelta = 0.99,
} = {}) {
  const tradingDate = '2026-09-22', asOf = '2026-09-22T14:00:00.000Z'
  const lastTradeAt = resolveScenarioHorizons({ asOf, tradingDate, expirationDate }).lastTradeAt
  const timeYears = (Date.parse(lastTradeAt) - Date.parse(asOf)) / (365 * 86400000)
  const mid = priceOption({ type, spot: spot * scale, strike: strike * scale, timeYears, volatility: iv, riskFreeRate: 0, steps: 256 })
  const security = { securityId: 'sec:EX', issuerId: 'iss:EX', ticker: 'EX' }
  const sign = type === 'call' ? 1 : -1
  const feature = {
    recordId: 'a'.repeat(64),
    technicals: { laggedThrough: '2026-09-21', realizedVolatility20dPct: 35, distanceFromSma20Pct: 4 * sign },
    regime: { score: type === 'call' ? 8 : 2 },
    directional: { [type]: { relativeStrength20dPct: 8, return5dPct: 3 } },
    events: { earnings: [], dividends: [], catalysts: [] },
    coverage: { earnings: { status: 'complete' }, catalysts: { status: 'complete' } },
    pricingInputs: { rates: [{ eventId: 'zero', asOfDate: '2026-09-21', ratePct: 0 }] },
  }
  const contract = {
    type, contractId: `${type}:${strike}:${expirationDate}`, osiSymbol: 'EX',
    strikePrice: strike * scale, expirationDate,
    dte: Math.round((Date.parse(expirationDate) - Date.parse(tradingDate)) / 86400000),
    openInterest, openInterestDate: '2026-09-21', volume: { value: volume, sessionDate: tradingDate }, previousVolume: 500,
    quote: { bid: mid * (1 - spread / 2), ask: mid * (1 + spread / 2), bidSize: 20, askSize: 20, marketAt: asOf, ageMs: 1000 },
    analytics: { greeks: { delta: providerDelta } }, fetchedAt: '2026-09-22T14:00:01.000Z',
  }
  return scoreOpeningContract({ security, direction: type, contract,
    underlying: { quote: { bid: spot * scale, ask: spot * scale, marketAt: asOf, ageMs: 1000 } }, feature, tradingDate })
}

describe('production ranking on model-consistent synthetic contracts', () => {
  it('prefers the tighter spread at an identical mid/IV and demands a smaller net-target move', () => {
    const tight = evaluate({ spread: 0.02 })
    const wide = evaluate({ spread: 0.09 })
    expect(tight.score.status).toBe('scored')
    expect(wide.score.status).toBe('scored')
    expect(set(tight).calibration.impliedVolatility).toBeCloseTo(set(wide).calibration.impliedVolatility, 8)
    expect(tight.score.score).toBeGreaterThan(wide.score.score)
    expect(target(tight).requiredMovePct).toBeLessThan(target(wide).requiredMovePct)
  })

  it('prefers greater observed liquidity with price and all model inputs held fixed', () => {
    const liquid = evaluate()
    const thin = evaluate({ openInterest: 100, volume: 0 })
    expect(thin.score.status).toBe('scored')
    expect(liquid.score.score).toBeGreaterThan(thin.score.score)
    expect(set(liquid).entry.impliedVolatility).toBe(set(thin).entry.impliedVolatility)
  })

  it('ranks successively more expensive IV lower without letting IV fund its own required move', () => {
    const cases = [0.25, 0.35, 0.5, 0.7].map((iv) => evaluate({ iv }))
    for (let index = 1; index < cases.length; index += 1) {
      expect(cases[index].score.status).toBe('scored')
      expect(cases[index].score.score).toBeLessThan(cases[index - 1].score.score)
      expect(target(cases[index]).requiredMovePct).toBeGreaterThan(target(cases[index - 1]).requiredMovePct)
    }
  })

  it('keeps useful OTM convexity without rewarding a far-wing lottery or deep ITM delta', () => {
    const close = evaluate({ strike: 103 })
    const farther = evaluate({ strike: 107 })
    expect(points(farther, 'convexity')).toBeGreaterThan(points(close, 'convexity'))
    expect(close.score.score).toBeGreaterThan(farther.score.score)
    for (const strike of [120, 85]) {
      const extreme = evaluate({ strike })
      expect(extreme.score.status).toBe('ineligible')
      expect(extreme.score.blockers).toContainEqual(expect.objectContaining({ code: 'calibrated_delta_outside_window' }))
    }
    expect(set(close).scenarios.some((row) => row.gainWhileOutOfTheMoney && row.askEntryModeledBidReturnPct >= 25)).toBe(true)
  })

  it('reprices the same strike at different DTEs and penalizes its larger short-expiry carry loss', () => {
    const short = evaluate({ expirationDate: '2026-09-29' })
    const medium = evaluate()
    const longer = evaluate({ expirationDate: '2026-11-06' })
    expect(set(short).timeOnlyDecay[0].decayPctOfEntryPremium).toBeLessThan(-40)
    expect(short.score.score).toBeLessThan(medium.score.score)
    expect(points(longer, 'thetaEfficiency')).toBeGreaterThan(points(medium, 'thetaEfficiency'))
    // Longer life buys carry relief but requires a larger move to lift the
    // larger premium. DTE has no universally monotone total-score ordering.
    expect(target(longer).requiredMovePct).toBeGreaterThan(target(medium).requiredMovePct)
  })

  it('uses local Greeks when provider delta is missing, stale, or contradictory', () => {
    const cases = [null, -0.9, 0.01, 0.4].map((providerDelta) => evaluate({ providerDelta }))
    expect(cases.every((item) => item.score.status === 'scored')).toBe(true)
    expect(new Set(cases.map((item) => item.score.score)).size).toBe(1)
    expect(cases.every((item) => item.score.cohort === 'primary')).toBe(true)
  })

  it('keeps economically equivalent zero-carry call/put setups close, with correctly signed targets', () => {
    const call = evaluate()
    const put = evaluate({ type: 'put', spot: 103, strike: 100 })
    expect(put.score.status).toBe('scored')
    expect(set(put).entry.mid).toBeCloseTo(set(call).entry.mid, 2)
    expect(Math.abs(call.score.score - put.score.score)).toBeLessThan(0.5)
    expect(target(call).requiredMovePct).toBeGreaterThan(0)
    expect(target(put).requiredMovePct).toBeLessThan(0)
  })

  it('preserves dimensionless components across a fourfold stock/strike/premium rescaling', () => {
    const original = evaluate()
    const scaled = evaluate({ scale: 4 })
    for (const name of ['deltaExposure', 'convexity', 'thetaEfficiency', 'ivVega', 'liquidity']) {
      expect(points(scaled, name)).toBeCloseTo(points(original, name), 3)
    }
    // The fixed $0.70 fee per side is a real exception to scale invariance.
    expect(target(scaled).requiredMovePct).toBeLessThan(target(original).requiredMovePct)
  })

  it.each(['call', 'put'])('reaches each %s net premium target under unchanged IV and IV crush', (type) => {
    const original = evaluate(type === 'call' ? {} : { type, spot: 103, strike: 100 })
    const scenario = set(original)
    for (const multiplier of [1, 0.9]) {
      const solved = scenario.premiumTargets.find((item) => item.ivMultiplier === multiplier)
      const verified = buildContractScenarioSet({ contract: { ...scenario.contract, quote: scenario.entry },
        underlyingPrice: scenario.entry.underlyingPrice, asOf: scenario.asOf, tradingDate: scenario.tradingDate,
        riskFreeRate: 0, ...OPTIONS_SCENARIO_RANKING_PROFILE, moves: [solved.requiredMovePct], ivMultipliers: [multiplier] })
      expect(verified.scenarios[0].askEntryModeledBidReturnPct).toBeCloseTo(25, 1)
    }
  })
})
