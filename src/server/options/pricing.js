// American-option valuation for the options scanner (epic #201, story #210).
//
// Method: a Cox-Ross-Rubinstein binomial lattice with early exercise and
// Vellekoop-Nieuwenhuis discrete-dividend handling, plus a closed-form
// Black-Scholes-Merton reference used both as the documented no-dividend
// benchmark and as an exact fast path where American equals European.
//
// Nothing here is calibrated to, or shares code with, the expectations it is
// tested against: `fixtures/pricing/oracle.json` is generated offline by
// QuantLib's finite-difference engine (scripts/options-pricing-oracle.py), the
// benchmark the epic names. Two unrelated numerical methods agreeing to a cent
// is the only evidence that either is right.
//
// Conventions, identical to the oracle fixture's:
//   time           Actual/365 fixed year fractions.
//   riskFreeRate   continuously compounded.
//   dividendYield  continuous carry: continuous dividend yield PLUS the borrow
//                  assumption. A hard-to-borrow name lowers the forward exactly
//                  as a dividend yield does, so it is carried in the same term
//                  and recorded as its own documented assumption by the caller.
//   dividends      discrete cash amounts at explicit ex-dividend year fractions.
//   price/greeks   PER SHARE. A standard contract is 100 shares; the multiplier
//                  is applied by the caller, never here.
//   delta          dV/dS per $1 of underlying.
//   gamma          d2V/dS2.
//   vega           per 1.00 volatility POINT (a 0.01 change in sigma).
//   theta          per CALENDAR day (weekends and holidays decay too).
//   rho            per 1.00 percentage point of rate (a 0.01 change in r).

export const OPTIONS_PRICING_MODEL_VERSION = 'options-american-crr-vellekoop-v2'

// The epic's proposed release tolerance: max($0.02, 1% of the oracle value).
// Stated here because the tests, the convergence check and any future
// release note all have to mean the same thing by "close enough".
export const OPTIONS_PRICING_TOLERANCE = Object.freeze({ absolute: 0.02, relative: 0.01 })

export const OPTIONS_PRICING_DEFAULT_STEPS = 512

// Solver bounds. A calibrated IV outside these is not a volatility, it is a bad
// quote or a bad model, and is reported as a calibration failure rather than
// clamped into range.
export const OPTIONS_IV_SOLVER = Object.freeze({
  minVolatility: 0.01,
  maxVolatility: 5.0,
  maxIterations: 100,
  // A mid quote is a penny-grid number; matching it to a tenth of a cent is
  // already well inside the noise of the input it is fitted to.
  residualTolerance: 0.001,
})

export function optionsPricingTolerance(value) {
  return Math.max(OPTIONS_PRICING_TOLERANCE.absolute, Math.abs(value) * OPTIONS_PRICING_TOLERANCE.relative)
}

export class OptionsPricingError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OptionsPricingError'
    this.code = code
  }
}

const DAYS_PER_YEAR = 365
const VEGA_BUMP = 0.005
const RATE_BUMP = 0.0005

// Hart's double-precision rational approximation of the standard normal CDF
// (|error| < 1e-15). A low-accuracy CDF would eat the whole $0.02 tolerance
// before the lattice ever ran.
function normalCdf(x) {
  const z = Math.abs(x)
  if (z > 37) return x > 0 ? 1 : 0
  const e = Math.exp(-z * z / 2)
  let c
  if (z < 7.07106781186547) {
    let b = 3.52624965998911e-2 * z + 0.700383064443688
    b = b * z + 6.37396220353165
    b = b * z + 33.912866078383
    b = b * z + 112.079291497871
    b = b * z + 221.213596169931
    b = b * z + 220.206867912376
    let q = 8.83883476483184e-2 * z + 1.75566716318264
    q = q * z + 16.064177579207
    q = q * z + 86.7807322029461
    q = q * z + 296.564248779674
    q = q * z + 637.333633378831
    q = q * z + 793.826512519948
    q = q * z + 440.413735824752
    c = e * b / q
  } else {
    let b = z + 0.65
    b = z + 4 / b
    b = z + 3 / b
    b = z + 2 / b
    b = z + 1 / b
    c = e / (b * 2.506628274631)
  }
  return x > 0 ? 1 - c : c
}

function normalPdf(x) {
  return Math.exp(-x * x / 2) / 2.5066282746310002
}

function intrinsicValue(type, spot, strike) {
  return type === 'call' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0)
}

function normalizeInputs(inputs) {
  const {
    type, exercise = 'american', spot, strike, timeYears, volatility,
    riskFreeRate, dividendYield = 0, dividends = [], steps = OPTIONS_PRICING_DEFAULT_STEPS,
  } = inputs || {}
  if (type !== 'call' && type !== 'put') throw new OptionsPricingError('invalid_option_type', 'type must be call or put')
  if (exercise !== 'american' && exercise !== 'european') throw new OptionsPricingError('invalid_exercise_style', 'exercise must be american or european')
  if (!Number.isFinite(spot) || !(spot > 0)) throw new OptionsPricingError('invalid_spot', 'spot must be a finite positive number')
  if (!Number.isFinite(strike) || !(strike > 0)) throw new OptionsPricingError('invalid_strike', 'strike must be a finite positive number')
  if (!Number.isFinite(timeYears) || timeYears < 0) throw new OptionsPricingError('invalid_time', 'timeYears must be zero or a positive number')
  if (!Number.isFinite(volatility) || !(volatility > 0)) throw new OptionsPricingError('invalid_volatility', 'volatility must be a finite positive number')
  if (!Number.isFinite(riskFreeRate)) throw new OptionsPricingError('invalid_rate', 'riskFreeRate must be a finite number')
  if (!Number.isFinite(dividendYield)) throw new OptionsPricingError('invalid_dividend_yield', 'dividendYield must be a finite number')
  if (!Number.isInteger(steps) || steps < 8) throw new OptionsPricingError('invalid_steps', 'steps must be an integer of at least 8')
  for (const dividend of dividends) {
    if (!Number.isFinite(dividend?.timeYears) || dividend.timeYears < 0) throw new OptionsPricingError('invalid_dividend', 'each dividend needs a non-negative timeYears')
    if (!Number.isFinite(dividend?.amount) || dividend.amount < 0) throw new OptionsPricingError('invalid_dividend', 'each dividend needs a non-negative amount')
  }
  return { type, exercise, spot, strike, timeYears, volatility, riskFreeRate, dividendYield, dividends, steps }
}

// Only dividends that go ex strictly inside the option's life move its value:
// one at t=0 has already happened, one at or after expiry never reaches the
// holder of the option.
function liveDividends(dividends, timeYears) {
  return dividends.filter((dividend) => dividend.timeYears > 0 && dividend.timeYears < timeYears && dividend.amount > 0)
}

export function blackScholes({ type, spot, strike, timeYears, volatility, riskFreeRate, dividendYield = 0 } = {}) {
  const inputs = normalizeInputs({ type, exercise: 'european', spot, strike, timeYears, volatility, riskFreeRate, dividendYield })
  if (inputs.timeYears === 0) {
    const price = intrinsicValue(inputs.type, inputs.spot, inputs.strike)
    const inTheMoney = price > 0
    return {
      price,
      delta: inTheMoney ? (inputs.type === 'call' ? 1 : -1) : 0,
      gamma: 0, vega: 0, theta: 0, rho: 0,
    }
  }
  const { spot: s, strike: k, timeYears: t, volatility: sigma, riskFreeRate: r, dividendYield: q } = inputs
  const sqrtT = Math.sqrt(t)
  const carry = Math.exp(-q * t)
  const discount = Math.exp(-r * t)
  const d1 = (Math.log(s / k) + (r - q + sigma * sigma / 2) * t) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  const sign = inputs.type === 'call' ? 1 : -1
  const nd1 = normalCdf(sign * d1)
  const nd2 = normalCdf(sign * d2)
  const price = sign * (s * carry * nd1 - k * discount * nd2)
  const theta = (
    -(s * carry * normalPdf(d1) * sigma) / (2 * sqrtT)
    + sign * q * s * carry * nd1
    - sign * r * k * discount * nd2
  ) / DAYS_PER_YEAR
  return {
    price,
    delta: sign * carry * nd1,
    gamma: (carry * normalPdf(d1)) / (s * sigma * sqrtT),
    vega: (s * carry * normalPdf(d1) * sqrtT) / 100,
    theta,
    rho: (sign * k * t * discount * nd2) / 100,
  }
}

// An American call is worth exactly its European twin when holding it costs
// nothing: with no discrete dividend and no positive carry there is never a
// moment where giving up the remaining time value pays. Taking the closed form
// there is not an approximation, and it is what keeps the scenario matrix cheap
// for the non-dividend-paying majority of the watchlist.
function europeanEquivalent(inputs) {
  return inputs.type === 'call'
    && inputs.riskFreeRate >= 0
    && inputs.dividendYield <= 0
    && liveDividends(inputs.dividends, inputs.timeYears).length === 0
}

// Value of the option at step j read at an arbitrary price, by linear
// interpolation between the two bracketing lattice nodes. Linear rather than
// clamped extrapolation outside the lattice span matters for an ex-dividend
// date very close to valuation, where the lattice is still narrower than the
// dividend itself and the value function is locally linear anyway.
function valueAtPrice(values, step, spot, logU, price) {
  // Cash dividends cannot make the ex-dividend stock negative. Clamp the
  // interpolation coordinate as well as its logarithm (a negative weight
  // previously let a large cash flow push a put above its strike).
  price = Math.max(price, 0)
  const position = (Math.log(Math.max(price, 1e-12) / spot) / logU + step) / 2
  let lower = Math.floor(position)
  if (lower < 0) lower = 0
  if (lower > step - 1) lower = step - 1
  const low = spot * Math.exp(logU * (2 * lower - step))
  const high = spot * Math.exp(logU * (2 * (lower + 1) - step))
  const weight = (price - low) / (high - low)
  return Math.max(0, values[lower] + weight * (values[lower + 1] - values[lower]))
}

function binomialPrice(inputs) {
  const { type, exercise, spot, strike, timeYears, volatility, riskFreeRate, dividendYield, steps } = inputs
  const dividends = liveDividends(inputs.dividends, timeYears)
  const dt = timeYears / steps
  // A cash flow rounded to the root used to vanish. At sub-half-step dates,
  // take the immediate-dividend limit and retain the cum-dividend exercise
  // decision. This also avoids extrapolating a large drop off a two-node tree.
  const immediate = dividends.filter((dividend) => dividend.timeYears < dt / 2)
  if (immediate.length) {
    const cash = immediate.reduce((sum, dividend) => sum + dividend.amount, 0)
    const continuation = binomialPrice({ ...inputs, spot: Math.max(spot - cash, 1e-12),
      dividends: dividends.filter((dividend) => !immediate.includes(dividend)) })
    return exercise === 'american' ? Math.max(intrinsicValue(type, spot, strike), continuation) : continuation
  }
  const logU = volatility * Math.sqrt(dt)
  const u = Math.exp(logU)
  const down = 1 / u
  const p = (Math.exp((riskFreeRate - dividendYield) * dt) - down) / (u - down)
  if (!(p > 0 && p < 1)) {
    // Happens when the per-step drift outruns the per-step move, i.e. the
    // lattice is too coarse for these inputs. Refusing is right: a lattice with
    // a negative probability produces a confident, arbitrage-violating number.
    throw new OptionsPricingError('lattice_probability_out_of_bounds', `Risk-neutral probability ${p.toFixed(6)} is outside (0,1); increase steps`)
  }
  const discount = Math.exp(-riskFreeRate * dt)

  const drops = new Float64Array(steps + 1)
  for (const dividend of dividends) {
    const step = Math.max(1, Math.min(steps - 1, Math.round(dividend.timeYears / dt)))
    drops[step] += dividend.amount
  }

  const values = new Float64Array(steps + 1)
  const shifted = new Float64Array(steps + 1)
  for (let k = 0; k <= steps; k += 1) values[k] = intrinsicValue(type, spot * Math.exp(logU * (2 * k - steps)), strike)

  for (let j = steps - 1; j >= 0; j -= 1) {
    for (let k = 0; k <= j; k += 1) values[k] = discount * (p * values[k + 1] + (1 - p) * values[k])

    // Vellekoop-Nieuwenhuis: the lattice diffuses a dividend-free process, and
    // the drop is applied to the value FUNCTION instead of to the nodes, which
    // keeps the lattice recombining. Value just before the ex-date, as seen at
    // the cum-dividend price S, is the post-drop value read at S - D.
    if (drops[j] > 0) {
      // Exercise is also available immediately AFTER the drop (particularly
      // valuable for puts), before mapping the value back to the cum price.
      if (exercise === 'american') {
        for (let k = 0; k <= j; k += 1) {
          values[k] = Math.max(values[k], intrinsicValue(type, spot * Math.exp(logU * (2 * k - j)), strike))
        }
      }
      for (let k = 0; k <= j; k += 1) shifted[k] = valueAtPrice(values, j, spot, logU, spot * Math.exp(logU * (2 * k - j)) - drops[j])
      values.set(shifted.subarray(0, j + 1))
    }

    // Early exercise is decided on the cum-dividend price: that is precisely
    // the case where exercising a call just before an ex-date beats holding it.
    if (exercise === 'american') {
      for (let k = 0; k <= j; k += 1) {
        const intrinsic = intrinsicValue(type, spot * Math.exp(logU * (2 * k - j)), strike)
        if (intrinsic > values[k]) values[k] = intrinsic
      }
    }
  }
  return values[0]
}

// A CRR lattice's error oscillates with step parity as the strike moves between
// nodes. Averaging n and n+1 cancels the leading oscillatory term. Measured on
// the oracle cases, this barely improves raw accuracy -- the dominant error is
// the dividend interpolation, not the oscillation -- but it cuts the wobble
// across neighbouring step counts by roughly 100x (0.0073 -> 0.00007 on a
// 45-day ATM American put) and halves the noise in a second difference over
// spot. That smoothness is what the scenario matrix and the premium-target
// bisection actually depend on: a price that jitters between adjacent cells
// produces a non-monotone premium curve and a solver that lands anywhere.
function latticePrice(inputs) {
  return (binomialPrice(inputs) + binomialPrice({ ...inputs, steps: inputs.steps + 1 })) / 2
}

export function priceOption(rawInputs) {
  const inputs = normalizeInputs(rawInputs)
  if (inputs.timeYears === 0) return intrinsicValue(inputs.type, inputs.spot, inputs.strike)
  if (inputs.exercise === 'european' && liveDividends(inputs.dividends, inputs.timeYears).length === 0) {
    return blackScholes(inputs).price
  }
  if (inputs.exercise === 'american' && europeanEquivalent(inputs)) return blackScholes(inputs).price
  return latticePrice(inputs)
}

// Spatial/volatility/rate Greeks reprice the same model at bumped inputs;
// local theta follows its continuation PDE (zero inside immediate exercise).
// That is the point -- the Greeks reported next to a scenario have to be the
// derivatives of the number actually shown, including across the early-exercise
// boundary where a closed form has none.
// `includeRho` is off in the scenario matrix: rho costs two more full lattice
// solves per cell and is the one Greek a days-to-weeks premium scenario never
// turns on. Nothing else about the calculation changes.
export function priceWithGreeks(rawInputs, { includeRho = true } = {}) {
  const inputs = normalizeInputs(rawInputs)
  if (inputs.exercise === 'american' && europeanEquivalent(inputs)) return blackScholes(inputs)
  if (inputs.exercise === 'european' && liveDividends(inputs.dividends, inputs.timeYears).length === 0) return blackScholes(inputs)

  const price = priceOption(inputs)
  if (inputs.timeYears === 0) {
    const inTheMoney = price > 0
    return { price, delta: inTheMoney ? (inputs.type === 'call' ? 1 : -1) : 0, gamma: 0, vega: 0, theta: 0, rho: 0 }
  }

  // Span a lattice cell: a smaller bump differentiates the piecewise-linear
  // interpolation kink instead of the option, producing strike-dependent gamma
  // spikes. Use relative units so splitting a stock cannot change the Greeks.
  const logU = inputs.volatility * Math.sqrt(inputs.timeYears / inputs.steps)
  const bump = inputs.spot * Math.min(0.25, 2 * Math.sinh(logU))
  const up = priceOption({ ...inputs, spot: inputs.spot + bump })
  const downPrice = priceOption({ ...inputs, spot: Math.max(inputs.spot - bump, 1e-8) })

  const delta = (up - downPrice) / (2 * bump)
  const gamma = (up - 2 * price + downPrice) / (bump * bump)
  // Between cash-dividend jumps the continuation value satisfies the pricing
  // PDE. Moving the valuation date on a rounded dividend lattice differentiates
  // the changing grid as well as time, and can even cross the cash-flow jump.
  // Recover the local theta from the model's spatial derivatives instead.
  // Inside immediate exercise the fixed-spot value is intrinsic and theta is 0.
  const exercising = inputs.exercise === 'american'
    && price <= intrinsicValue(inputs.type, inputs.spot, inputs.strike) + 1e-10
  const theta = exercising ? 0 : (inputs.riskFreeRate * price
    - (inputs.riskFreeRate - inputs.dividendYield) * inputs.spot * delta
    - 0.5 * inputs.volatility ** 2 * inputs.spot ** 2 * gamma) / DAYS_PER_YEAR

  const volBump = Math.min(VEGA_BUMP, inputs.volatility / 2)
  const volUp = priceOption({ ...inputs, volatility: inputs.volatility + volBump })
  const volDown = priceOption({ ...inputs, volatility: inputs.volatility - volBump })
  const rho = includeRho
    ? (priceOption({ ...inputs, riskFreeRate: inputs.riskFreeRate + RATE_BUMP })
      - priceOption({ ...inputs, riskFreeRate: inputs.riskFreeRate - RATE_BUMP })) / (2 * RATE_BUMP) / 100
    : null

  return {
    price,
    delta,
    gamma,
    vega: (volUp - volDown) / (2 * volBump) / 100,
    theta,
    rho,
  }
}

// Halving the step count must not move the price by more than the release
// tolerance. A contract that fails this is not published: an unconverged model
// is indistinguishable from a wrong one once the number reaches a reader.
export function assessPricingConvergence(rawInputs) {
  const inputs = normalizeInputs(rawInputs)
  const fine = priceOption(inputs)
  const coarse = priceOption({ ...inputs, steps: Math.max(8, Math.floor(inputs.steps / 2)) })
  const delta = Math.abs(fine - coarse)
  const tolerance = optionsPricingTolerance(fine)
  return {
    converged: delta <= tolerance,
    price: fine,
    coarsePrice: coarse,
    delta,
    tolerance,
    steps: inputs.steps,
    reason: delta <= tolerance ? null : 'price_not_converged_across_step_counts',
  }
}

// No-arbitrage bounds on the observed price, checked before the solver runs.
// Outside them no volatility reproduces the quote and a root finder would just
// walk to a bracket edge and report a confident, meaningless number.
function priceBounds({ type, exercise, spot, strike, timeYears, riskFreeRate, dividendYield, dividends }) {
  const discount = Math.exp(-riskFreeRate * timeYears)
  const carry = Math.exp(-dividendYield * timeYears)
  const dividendPv = liveDividends(dividends, timeYears)
    .reduce((total, dividend) => total + dividend.amount * Math.exp(-riskFreeRate * dividend.timeYears)
      * Math.exp(-dividendYield * (timeYears - dividend.timeYears)), 0)
  if (type === 'call') {
    const european = Math.max(spot * carry - dividendPv - strike * discount, 0)
    return {
      lower: exercise === 'american' ? Math.max(european, intrinsicValue('call', spot, strike)) : european,
      upper: spot * Math.max(1, carry),
    }
  }
  // The stock is floored at zero after cash jumps. Cash dividends need not be
  // fully payable in every lattice state, so subtracting their full PV from
  // the stock forward is NOT a valid put lower bound. Ignoring them gives a
  // conservative bound; the model's minimum-volatility price tightens it next.
  const european = Math.max(strike * discount - spot * carry, 0)
  return {
    lower: exercise === 'american' ? Math.max(european, intrinsicValue('put', spot, strike)) : european,
    upper: exercise === 'american' ? strike * Math.max(1, discount) : strike * discount,
  }
}

// Calibrate sigma to one synchronized mid quote. Price is strictly increasing in
// sigma, so bisection on the declared bracket is unconditionally safe -- slower
// than Newton, but it cannot diverge on a near-zero vega wing, which is exactly
// where the scanner's OTM contracts live.
export function calibrateImpliedVolatility({ targetPrice, ...rawInputs } = {}) {
  const inputs = normalizeInputs({ ...rawInputs, volatility: OPTIONS_IV_SOLVER.minVolatility })
  const failure = (reason, extra = {}) => ({
    status: 'failed', reason, impliedVolatility: null, residual: null, iterations: 0,
    bracket: { min: OPTIONS_IV_SOLVER.minVolatility, max: OPTIONS_IV_SOLVER.maxVolatility }, ...extra,
  })
  if (!Number.isFinite(targetPrice) || !(targetPrice > 0)) return failure('target_price_not_positive')
  if (inputs.timeYears <= 0) return failure('no_time_to_expiry')

  const bounds = priceBounds(inputs)
  if (targetPrice < bounds.lower - OPTIONS_IV_SOLVER.residualTolerance) return failure('price_below_no_arbitrage_lower_bound', { bounds })
  if (targetPrice > bounds.upper) return failure('price_above_no_arbitrage_upper_bound', { bounds })

  const at = (volatility) => priceOption({ ...inputs, volatility })
  let low = OPTIONS_IV_SOLVER.minVolatility
  let high = OPTIONS_IV_SOLVER.maxVolatility
  const lowPrice = at(low)
  const highPrice = at(high)
  // At the exercise floor a whole interval of volatilities can reproduce the
  // quote. There is no identified IV or meaningful calibrated Greek to rank.
  if (Math.abs(targetPrice - lowPrice) <= OPTIONS_IV_SOLVER.residualTolerance) {
    return failure('iv_not_identifiable_at_price_floor', { bounds, floorPrice: lowPrice })
  }
  if (targetPrice < lowPrice) return failure('price_below_minimum_volatility', { bounds, floorPrice: lowPrice })
  if (targetPrice > highPrice) return failure('price_above_maximum_volatility', { bounds, ceilingPrice: highPrice })

  let iterations = 0
  let mid = (low + high) / 2
  let midPrice = at(mid)
  while (iterations < OPTIONS_IV_SOLVER.maxIterations && high - low > 1e-8) {
    if (midPrice < targetPrice) low = mid
    else high = mid
    mid = (low + high) / 2
    midPrice = at(mid)
    iterations += 1
  }

  const residual = Math.abs(midPrice - targetPrice)
  if (residual > OPTIONS_IV_SOLVER.residualTolerance) {
    return failure('residual_above_tolerance', { impliedVolatility: mid, residual, iterations, bounds })
  }
  return {
    status: 'calibrated',
    reason: null,
    impliedVolatility: mid,
    residual,
    iterations,
    bracket: { min: OPTIONS_IV_SOLVER.minVolatility, max: OPTIONS_IV_SOLVER.maxVolatility },
    calibratedTo: targetPrice,
    modelPrice: midPrice,
  }
}

// Invert the model for the underlying price that produces `targetValue`. Value
// is monotone in spot (up for calls, down for puts), so the answer is unique
// where one exists; where it does not, say so rather than reporting the edge of
// the search as if it were a solution.
export function solveSpotForValue({ targetValue, searchBound = 0.6, ...rawInputs } = {}) {
  const inputs = normalizeInputs(rawInputs)
  if (!Number.isFinite(targetValue) || !(targetValue > 0)) return { solved: false, reason: 'target_value_not_positive', spot: null, movePct: null }
  if (!(searchBound > 0 && searchBound < 1)) throw new OptionsPricingError('invalid_search_bound', 'searchBound must be a fraction between 0 and 1')

  const sign = inputs.type === 'call' ? 1 : -1
  const lowSpot = inputs.spot * (1 - searchBound)
  const highSpot = inputs.spot * (1 + searchBound)
  const at = (spot) => priceOption({ ...inputs, spot })
  const excess = (spot) => at(spot) - targetValue
  // `low` is the adverse edge of the search and `high` the favourable one, so
  // excess() runs from negative to positive between them for BOTH types. For a
  // put that means starting high and bisecting downward -- the orientation, not
  // the function, is what carries the sign.
  let low = sign > 0 ? lowSpot : highSpot
  let high = sign > 0 ? highSpot : lowSpot

  if (excess(high) < 0) {
    return {
      solved: false, reason: 'no_solution_within_search_bound', spot: null, movePct: null,
      searchBound, bestValue: at(high), bestMovePct: ((high - inputs.spot) / inputs.spot) * 100,
    }
  }
  if (excess(low) > 0) {
    // The target is already met at the adverse edge of the search: reporting a
    // "required move" here would be nonsense, the premium target is simply not
    // informative for this contract and scenario.
    return {
      solved: false, reason: 'target_met_across_entire_search_bound', spot: null, movePct: null,
      searchBound, bestValue: at(low), bestMovePct: ((low - inputs.spot) / inputs.spot) * 100,
    }
  }

  // 1e-6 of spot resolves the reported move to its last published decimal
  // (0.0001%); chasing further just buys more lattice solves per cell.
  for (let iteration = 0; iteration < 40 && Math.abs(high - low) > inputs.spot * 1e-6; iteration += 1) {
    const mid = (low + high) / 2
    if (excess(mid) < 0) low = mid
    else high = mid
  }
  const spot = (low + high) / 2
  return {
    solved: true, reason: null, spot,
    movePct: ((spot - inputs.spot) / inputs.spot) * 100,
    value: at(spot),
    searchBound,
  }
}
