// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  OptionsPricingError, OPTIONS_IV_SOLVER, assessPricingConvergence, blackScholes,
  calibrateImpliedVolatility, optionsPricingTolerance, priceOption, priceWithGreeks, solveSpotForValue,
} from './pricing.js'

// Generated offline by QuantLib's finite-difference and closed-form engines
// (scripts/options-pricing-oracle.py). Nothing in pricing.js was fitted to these
// numbers; they are the independent check that the lattice is right.
const oracle = JSON.parse(readFileSync(new URL('./fixtures/pricing/oracle.json', import.meta.url)))

// Price tolerance is the epic's proposed release tolerance, max($0.02, 1%).
// The Greek tolerances are this repository's, set roughly 2-5x above the largest
// deviation actually measured against the oracle, so a real regression trips
// them but lattice noise does not.
const GREEK_TOLERANCE = Object.freeze({ delta: 0.005, gamma: 0.015, vega: 0.005, theta: 0.005, rho: 0.005 })

function inputsFor(testCase, overrides = {}) {
  const inputs = testCase.inputs
  return {
    type: inputs.type,
    exercise: inputs.exercise,
    spot: inputs.spot,
    strike: inputs.strike,
    timeYears: inputs.daysToExpiry / 365,
    volatility: inputs.volatility,
    riskFreeRate: inputs.riskFreeRate,
    dividendYield: inputs.dividendYield,
    dividends: inputs.dividends.map((dividend) => ({ timeYears: dividend.daysFromNow / 365, amount: dividend.amount })),
    steps: 512,
    ...overrides,
  }
}

describe('pricing against the independent QuantLib oracle', () => {
  it('ships a converged oracle fixture, so a failure below means the lattice is wrong and not the expectation', () => {
    expect(oracle.oracle.library).toBe('QuantLib')
    expect(oracle.cases.length).toBeGreaterThanOrEqual(20)
    for (const testCase of oracle.cases) {
      expect(testCase.oracleConvergenceDelta, `${testCase.id} oracle convergence`).toBeLessThan(0.001)
    }
  })

  for (const testCase of oracle.cases) {
    it(`prices ${testCase.id} within max($0.02, 1%) of the oracle`, () => {
      const price = priceOption(inputsFor(testCase))
      expect(Math.abs(price - testCase.expected.price)).toBeLessThanOrEqual(optionsPricingTolerance(testCase.expected.price))
    })
  }

  for (const testCase of oracle.cases) {
    it(`matches the oracle's Greeks for ${testCase.id}`, () => {
      const greeks = priceWithGreeks(inputsFor(testCase))
      for (const [greek, tolerance] of Object.entries(GREEK_TOLERANCE)) {
        expect(Math.abs(greeks[greek] - testCase.expected[greek]), `${greek}`).toBeLessThanOrEqual(tolerance)
      }
    })
  }

  it('still clears the tolerance at a quarter of the default step count', () => {
    for (const testCase of oracle.cases) {
      const price = priceOption(inputsFor(testCase, { steps: 128 }))
      expect(Math.abs(price - testCase.expected.price), testCase.id).toBeLessThanOrEqual(optionsPricingTolerance(testCase.expected.price))
    }
  })
})

describe("the epic's illustrative case", () => {
  // Epic #201 section 4: S=$180, K=$200 call, 30 calendar days, r=4% continuously
  // compounded, no dividends, IV ~59.7554% gives ~$5.50. Every input is supplied
  // explicitly here because that is the whole point of the acceptance criterion.
  const illustration = {
    type: 'call', exercise: 'european', strike: 200, riskFreeRate: 0.04, dividendYield: 0, dividends: [],
  }

  it('reproduces $5.50 at entry', () => {
    const price = priceOption({ ...illustration, spot: 180, timeYears: 30 / 365, volatility: 0.597554 })
    expect(price).toBeCloseTo(5.50, 2)
  })

  it('reproduces the +3 calendar day scenarios, including the relative IV shocks', () => {
    const at = (spot, volatility) => priceOption({ ...illustration, spot, timeYears: 27 / 365, volatility })
    expect(at(189, 0.597554)).toBeCloseTo(8.05, 2)
    // Relative, not absolute: 59.7554% x 0.9 is 53.78%, and pricing 49.76% here
    // would overstate the crush by four volatility points.
    expect(at(189, 0.597554 * 0.9)).toBeCloseTo(6.87, 2)
    expect(at(189, 0.597554 * 1.1)).toBeCloseTo(9.24, 2)
    expect(at(180, 0.597554)).toBeCloseTo(4.94, 2)
  })

  it('shows a gain while the call is still far below its strike', () => {
    const entry = priceOption({ ...illustration, spot: 180, timeYears: 30 / 365, volatility: 0.597554 })
    const later = priceOption({ ...illustration, spot: 189, timeYears: 27 / 365, volatility: 0.597554 })
    expect(later).toBeGreaterThan(entry)
    expect(189).toBeLessThan(200)
  })
})

describe('exercise style and dividends', () => {
  const base = { spot: 100, strike: 105, timeYears: 40 / 365, volatility: 0.35, riskFreeRate: 0.05, steps: 512 }

  it('preserves the early-exercise floor for calls at negative rates', () => {
    const inputs = { ...base, type: 'call', spot: 120, strike: 100, volatility: 0.1, riskFreeRate: -0.1 }
    expect(priceOption(inputs)).toBeGreaterThanOrEqual(20)
    expect(priceOption({ ...inputs, exercise: 'european' })).toBeLessThan(20)
  })

  it('retains dividends that fall inside the first or last half lattice step', () => {
    const inputs = { ...base, type: 'call', strike: 100 }
    const immediate = priceOption({ ...inputs, dividends: [{ timeYears: 1e-8, amount: 2 }] })
    expect(immediate).toBeCloseTo(priceOption({ ...inputs, spot: 98 }), 2)
    const nearExpiry = priceOption({ ...inputs, dividends: [{ timeYears: inputs.timeYears - 1e-8, amount: 2 }], exercise: 'european' })
    expect(nearExpiry).toBeLessThan(priceOption({ ...inputs, exercise: 'european' }) - 0.5)
    const itm = { ...inputs, spot: 120, dividends: [{ timeYears: 1e-8, amount: 8 }] }
    expect(priceOption(itm)).toBe(20)
  })

  it('floors the ex-dividend stock at zero and preserves the put upper bound', () => {
    const inputs = { ...base, type: 'put', spot: 1, strike: 2, dividends: [{ timeYears: 10 / 365, amount: 3 }] }
    const price = priceOption(inputs)
    expect(price).toBeLessThanOrEqual(2)
    expect(price).toBeGreaterThan(1.9)
    expect(calibrateImpliedVolatility({ ...inputs, targetPrice: price }).reason).not.toBe('price_below_no_arbitrage_lower_bound')
  })

  it('does not fold the ex-dividend jump into a one-day theta difference', () => {
    const priced = priceWithGreeks({ ...base, type: 'call', strike: 100, dividends: [{ timeYears: 0.1 / 365, amount: 2 }] })
    expect(priced.theta).toBeLessThan(0)
    expect(Math.abs(priced.theta)).toBeLessThan(0.2)
  })

  it('values an American call with no dividend exactly as its European twin', () => {
    const american = priceOption({ ...base, type: 'call', exercise: 'american' })
    const european = priceOption({ ...base, type: 'call', exercise: 'european' })
    expect(american).toBeCloseTo(european, 10)
  })

  it('values an American put above its European twin, because early exercise is worth something', () => {
    const american = priceOption({ ...base, type: 'put', exercise: 'american' })
    const european = priceOption({ ...base, type: 'put', exercise: 'european' })
    expect(american).toBeGreaterThan(european)
  })

  it('lifts an American call above its European twin once a dividend goes ex before expiry', () => {
    const dividends = [{ timeYears: 25 / 365, amount: 4 }]
    const withDividend = { ...base, spot: 100, strike: 90, volatility: 0.20, riskFreeRate: 0.03, timeYears: 30 / 365, dividends }
    const american = priceOption({ ...withDividend, type: 'call', exercise: 'american' })
    const european = priceOption({ ...withDividend, type: 'call', exercise: 'european' })
    expect(american).toBeGreaterThan(european)
  })

  it('lowers a call and lifts a put as a discrete dividend grows', () => {
    const at = (amount, type) => priceOption({ ...base, type, exercise: 'american', dividends: [{ timeYears: 20 / 365, amount }] })
    expect(at(3, 'call')).toBeLessThan(at(0, 'call'))
    expect(at(3, 'put')).toBeGreaterThan(at(0, 'put'))
  })

  it('ignores dividends that go ex at or after expiry, and ones already paid', () => {
    const plain = priceOption({ ...base, type: 'put', exercise: 'american' })
    expect(priceOption({ ...base, type: 'put', exercise: 'american', dividends: [{ timeYears: 41 / 365, amount: 5 }] })).toBeCloseTo(plain, 10)
    expect(priceOption({ ...base, type: 'put', exercise: 'american', dividends: [{ timeYears: 0, amount: 5 }] })).toBeCloseTo(plain, 10)
  })

  it('treats a borrow assumption as carry: it lowers a call and lifts a put', () => {
    const at = (dividendYield, type) => priceOption({ ...base, type, exercise: 'american', dividendYield })
    expect(at(0.06, 'call')).toBeLessThan(at(0, 'call'))
    expect(at(0.06, 'put')).toBeGreaterThan(at(0, 'put'))
  })
})

describe('boundaries and bounds', () => {
  it('rejects nonfinite or coerced numeric inputs', () => {
    const inputs = { type: 'call', spot: 100, strike: 100, timeYears: 0.1, volatility: 0.3, riskFreeRate: 0.04 }
    for (const field of ['spot', 'strike', 'volatility']) {
      for (const value of [Infinity, NaN, '100']) expect(() => priceOption({ ...inputs, [field]: value })).toThrow(OptionsPricingError)
    }
  })

  it('resolves lattice gamma across neighboring strikes without ATM spikes', () => {
    for (const volatility of [0.02, 0.35]) for (const strike of [98, 99, 100, 101, 102]) {
      const inputs = { type: 'put', spot: 100, strike, timeYears: 30 / 365, volatility, riskFreeRate: 0, steps: 256 }
      // At zero rates/no dividends the American put equals its European twin.
      const expected = blackScholes(inputs).gamma
      expect(Math.abs(priceWithGreeks(inputs).gamma - expected)).toBeLessThan(Math.max(0.0001, expected * 0.02))
    }
  })
  it('returns intrinsic value at zero time to expiry', () => {
    expect(priceOption({ type: 'call', spot: 110, strike: 100, timeYears: 0, volatility: 0.3, riskFreeRate: 0.05 })).toBe(10)
    expect(priceOption({ type: 'put', spot: 110, strike: 100, timeYears: 0, volatility: 0.3, riskFreeRate: 0.05 })).toBe(0)
  })

  it('prices a deep in-the-money American put at exactly its intrinsic value', () => {
    const price = priceOption({ type: 'put', exercise: 'american', spot: 40, strike: 100, timeYears: 20 / 365, volatility: 0.30, riskFreeRate: 0.05, steps: 512 })
    expect(price).toBeCloseTo(60, 6)
  })

  it('never prices an American option below its intrinsic value', () => {
    for (const spot of [60, 80, 95, 100, 105, 140]) {
      const put = priceOption({ type: 'put', exercise: 'american', spot, strike: 100, timeYears: 15 / 365, volatility: 0.2, riskFreeRate: 0.06, steps: 256 })
      expect(put, `put at ${spot}`).toBeGreaterThanOrEqual(Math.max(100 - spot, 0) - 1e-9)
    }
  })

  it('keeps a call below the spot and a put below the strike', () => {
    const shared = { spot: 100, strike: 100, timeYears: 1, volatility: 2.5, riskFreeRate: 0.05, exercise: 'american', steps: 256 }
    expect(priceOption({ ...shared, type: 'call' })).toBeLessThan(100)
    expect(priceOption({ ...shared, type: 'put' })).toBeLessThan(100)
  })

  it('increases monotonically with volatility and with time', () => {
    const at = (volatility, timeYears) => priceOption({ type: 'put', exercise: 'american', spot: 100, strike: 100, timeYears, volatility, riskFreeRate: 0.04, steps: 256 })
    expect(at(0.4, 30 / 365)).toBeGreaterThan(at(0.2, 30 / 365))
    expect(at(0.3, 60 / 365)).toBeGreaterThan(at(0.3, 30 / 365))
  })

  it('rejects inputs that cannot describe an option', () => {
    const base = { type: 'call', spot: 100, strike: 100, timeYears: 0.1, volatility: 0.3, riskFreeRate: 0.04 }
    expect(() => priceOption({ ...base, type: 'straddle' })).toThrow(OptionsPricingError)
    expect(() => priceOption({ ...base, spot: 0 })).toThrow(/spot/)
    expect(() => priceOption({ ...base, volatility: 0 })).toThrow(/volatility/)
    expect(() => priceOption({ ...base, timeYears: -1 })).toThrow(/timeYears/)
    expect(() => priceOption({ ...base, dividends: [{ timeYears: 0.05 }] })).toThrow(/dividend/)
  })

  it('refuses to price on a lattice too coarse to carry the drift, rather than returning a number', () => {
    // A tiny volatility against a large rate pushes the risk-neutral probability
    // outside (0,1): the lattice is unusable and says so.
    expect(() => priceOption({
      type: 'put', exercise: 'american', spot: 100, strike: 100, timeYears: 1,
      volatility: 0.02, riskFreeRate: 0.9, steps: 8,
    })).toThrow(/probability/)
  })
})

describe('Black-Scholes reference', () => {
  it('satisfies put-call parity', () => {
    const shared = { spot: 100, strike: 105, timeYears: 0.25, volatility: 0.3, riskFreeRate: 0.05, dividendYield: 0.02 }
    const call = blackScholes({ ...shared, type: 'call' }).price
    const put = blackScholes({ ...shared, type: 'put' }).price
    const parity = shared.spot * Math.exp(-shared.dividendYield * shared.timeYears) - shared.strike * Math.exp(-shared.riskFreeRate * shared.timeYears)
    expect(call - put).toBeCloseTo(parity, 10)
  })

  it('reports vega per volatility point and theta per calendar day', () => {
    const shared = { type: 'call', spot: 100, strike: 100, timeYears: 30 / 365, volatility: 0.30, riskFreeRate: 0.05 }
    const { price, vega, theta } = blackScholes(shared)
    const onePointHigher = blackScholes({ ...shared, volatility: 0.31 }).price
    expect(vega).toBeCloseTo(onePointHigher - price, 3)
    const oneDayLater = blackScholes({ ...shared, timeYears: 29 / 365 }).price
    expect(theta).toBeCloseTo(oneDayLater - price, 2)
  })
})

describe('calibrateImpliedVolatility', () => {
  const contract = {
    type: 'put', exercise: 'american', spot: 100, strike: 100,
    timeYears: 30 / 365, riskFreeRate: 0.04, steps: 256,
  }

  it('rejects non-identifiable IV at the exercise floor', () => {
    expect(calibrateImpliedVolatility({ ...contract, spot: 40, targetPrice: 60 }))
      .toMatchObject({ status: 'failed', reason: 'iv_not_identifiable_at_price_floor', impliedVolatility: null })
  })

  it('recovers the volatility that produced a price, and reports its residual', () => {
    const price = priceOption({ ...contract, volatility: 0.42 })
    const result = calibrateImpliedVolatility({ targetPrice: price, ...contract })
    expect(result.status).toBe('calibrated')
    expect(result.impliedVolatility).toBeCloseTo(0.42, 4)
    expect(result.residual).toBeLessThan(OPTIONS_IV_SOLVER.residualTolerance)
    expect(result.bracket).toEqual({ min: OPTIONS_IV_SOLVER.minVolatility, max: OPTIONS_IV_SOLVER.maxVolatility })
  })

  it('fails rather than clamping when the quote breaks the no-arbitrage bounds', () => {
    const belowIntrinsic = calibrateImpliedVolatility({ targetPrice: 1, ...contract, spot: 80 })
    expect(belowIntrinsic).toMatchObject({ status: 'failed', reason: 'price_below_no_arbitrage_lower_bound', impliedVolatility: null })
    const aboveStrike = calibrateImpliedVolatility({ targetPrice: 150, ...contract })
    expect(aboveStrike).toMatchObject({ status: 'failed', reason: 'price_above_no_arbitrage_upper_bound' })
  })

  it('fails when the quote needs a volatility outside the declared bracket', () => {
    const tooCheap = calibrateImpliedVolatility({ targetPrice: 0.0001, ...contract })
    expect(tooCheap).toMatchObject({ status: 'failed', reason: 'price_below_minimum_volatility' })
  })

  it('fails on a contract with no time left rather than fitting noise', () => {
    expect(calibrateImpliedVolatility({ targetPrice: 5, ...contract, timeYears: 0 }))
      .toMatchObject({ status: 'failed', reason: 'no_time_to_expiry' })
  })
})

describe('assessPricingConvergence', () => {
  it('passes at the default step count', () => {
    const result = assessPricingConvergence({
      type: 'put', exercise: 'american', spot: 100, strike: 100, timeYears: 45 / 365,
      volatility: 0.35, riskFreeRate: 0.05, steps: 256,
    })
    expect(result.converged).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.delta).toBeLessThanOrEqual(result.tolerance)
  })

  it('fails, with a reason, when halving the steps moves the price past the tolerance', () => {
    // A large early dividend against a coarse lattice: at 16 steps each step is
    // nearly two days, so the ex-date lands on a materially different node than
    // it does at 8, and the early-exercise decision moves with it. 29 cents of
    // disagreement on an 8-dollar option is exactly what must not reach a reader
    // as a confident theoretical value.
    const result = assessPricingConvergence({
      type: 'call', exercise: 'american', spot: 100, strike: 92, timeYears: 30 / 365,
      volatility: 0.40, riskFreeRate: 0.05,
      dividends: [{ timeYears: 8 / 365, amount: 5 }],
      steps: 16,
    })
    expect(result.converged).toBe(false)
    expect(result.reason).toBe('price_not_converged_across_step_counts')
    expect(result.delta).toBeGreaterThan(result.tolerance)
  })

  it('converges on the same contract once the lattice is fine enough', () => {
    const result = assessPricingConvergence({
      type: 'call', exercise: 'american', spot: 100, strike: 92, timeYears: 30 / 365,
      volatility: 0.40, riskFreeRate: 0.05,
      dividends: [{ timeYears: 8 / 365, amount: 5 }],
      steps: 256,
    })
    expect(result.converged).toBe(true)
  })
})

describe('solveSpotForValue', () => {
  const call = {
    type: 'call', exercise: 'american', spot: 100, strike: 105,
    timeYears: 20 / 365, volatility: 0.4, riskFreeRate: 0.04, steps: 256,
  }

  it('finds the underlying price that produces a target premium', () => {
    const target = priceOption({ ...call, spot: 108 })
    const solution = solveSpotForValue({ targetValue: target, ...call })
    expect(solution.solved).toBe(true)
    expect(solution.spot).toBeCloseTo(108, 2)
    expect(solution.movePct).toBeCloseTo(8, 2)
  })

  it('solves downward for a put, where value rises as the stock falls', () => {
    const put = { ...call, type: 'put', strike: 95 }
    const target = priceOption({ ...put, spot: 92 })
    const solution = solveSpotForValue({ targetValue: target, ...put })
    expect(solution.solved).toBe(true)
    expect(solution.spot).toBeCloseTo(92, 2)
    expect(solution.movePct).toBeLessThan(0)
  })

  it('reports no solution instead of returning the edge of the search', () => {
    const solution = solveSpotForValue({ targetValue: 500, ...call })
    expect(solution).toMatchObject({ solved: false, reason: 'no_solution_within_search_bound', spot: null, movePct: null })
    expect(solution.bestMovePct).toBeCloseTo(60, 6)
  })

  it('reports when the target is already met everywhere in the search range', () => {
    // Deep in the money: even a 60% collapse in the underlying leaves this call
    // worth more than the target, so there is no "required move" to report.
    // A genuine premium target (entry mid x 1.25) can never land here, since the
    // entry price itself sits inside the bracket and is below the target by
    // construction -- this guards a caller that asks for something else.
    const solution = solveSpotForValue({ targetValue: 1, ...call, strike: 10 })
    expect(solution).toMatchObject({ solved: false, reason: 'target_met_across_entire_search_bound' })
  })
})
