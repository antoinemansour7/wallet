// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  comparableInstantFacts,
  computeFundamentalFeatures,
  describeChange,
  improvementPriority,
  summarizeImprovement,
} from './fundamentals.js'

const day = 86400000

/** A comparable quarterly fact of the shape comparableQuarterlyFacts emits. */
const fact = (concept, value, periodEnd, overrides = {}) => ({
  concept: `us-gaap:${concept}`,
  value,
  units: 'USD',
  periodEnd,
  periodStart: new Date(Date.parse(periodEnd) - 89 * day).toISOString().slice(0, 10),
  accession: `acc-${periodEnd}`,
  publicAt: `${periodEnd}T20:00:00.000Z`,
  derivation: 'reported_quarter',
  ...overrides,
})

// Four quarters: the current one, the year-ago comparable, and the two before
// that, which acceleration and the easy-comparison check both need.
const CURRENT = '2026-06-30'
const YEAR_AGO = '2025-06-30'
const PRIOR_Q = '2026-03-31'
const PRIOR_Q_YEAR_AGO = '2025-03-31'

function revenueSet({ current, yearAgo, priorQuarter, priorQuarterYearAgo }) {
  return [
    fact('Revenues', current, CURRENT),
    fact('Revenues', yearAgo, YEAR_AGO),
    fact('Revenues', priorQuarter, PRIOR_Q),
    fact('Revenues', priorQuarterYearAgo, PRIOR_Q_YEAR_AGO),
  ]
}

describe('computeFundamentalFeatures', () => {
  it('returns nothing rather than guessing when there is no comparable quarter', () => {
    const result = computeFundamentalFeatures({ quarterly: [fact('Revenues', 100, CURRENT)] })
    expect(result.features).toEqual([])
    expect(result.priorPeriodEnd).toBeNull()
  })

  it('measures revenue growth against the company\'s own year-ago quarter', () => {
    const result = computeFundamentalFeatures({
      quarterly: [fact('Revenues', 120, CURRENT), fact('Revenues', 100, YEAR_AGO)],
    })
    const growth = result.features.find((f) => f.name === 'revenueGrowth')
    expect(growth.value).toBeCloseTo(0.2, 6)
    expect(growth.direction).toBe('improved')
    // Inspectable: both sides cite the filing they came from.
    expect(growth.current.accession).toBe(`acc-${CURRENT}`)
    expect(growth.prior.periodEnd).toBe(YEAR_AGO)
  })

  it('reports acceleration only when the prior quarter has its own comparable', () => {
    // 20% this quarter vs 10% last quarter = accelerating.
    const result = computeFundamentalFeatures({
      quarterly: revenueSet({ current: 120, yearAgo: 100, priorQuarter: 110, priorQuarterYearAgo: 100 }),
    })
    const accel = result.features.find((f) => f.name === 'revenueGrowthAcceleration')
    expect(accel.currentGrowth).toBeCloseTo(0.2, 6)
    expect(accel.priorGrowth).toBeCloseTo(0.1, 6)
    expect(accel.direction).toBe('improved')

    // Drop the older pair and acceleration must disappear, not be inferred.
    const thin = computeFundamentalFeatures({
      quarterly: [fact('Revenues', 120, CURRENT), fact('Revenues', 100, YEAR_AGO)],
    })
    expect(thin.features.find((f) => f.name === 'revenueGrowthAcceleration')).toBeUndefined()
  })

  it('reports margin change in percentage points, not as a ratio of a ratio', () => {
    const result = computeFundamentalFeatures({
      quarterly: [
        fact('Revenues', 1000, CURRENT), fact('OperatingIncomeLoss', 150, CURRENT),
        fact('Revenues', 1000, YEAR_AGO), fact('OperatingIncomeLoss', 100, YEAR_AGO),
      ],
    })
    const margin = result.features.find((f) => f.name === 'operatingMarginChange')
    expect(margin.units).toBe('percentage_points')
    expect(margin.value).toBeCloseTo(0.05, 6) // 15% - 10%
    expect(margin.currentMargin).toBeCloseTo(0.15, 6)
  })

  it('treats fewer diluted shares as an improvement, and never differences a share count', () => {
    const result = computeFundamentalFeatures({
      quarterly: [
        fact('WeightedAverageNumberOfDilutedSharesOutstanding', 90, CURRENT, { units: 'shares' }),
        fact('WeightedAverageNumberOfDilutedSharesOutstanding', 100, YEAR_AGO, { units: 'shares' }),
      ],
    })
    const dilution = result.features.find((f) => f.name === 'dilutedShareGrowth')
    expect(dilution.value).toBeCloseTo(-0.1, 6)
    expect(dilution.direction).toBe('improved')
  })

  it('ignores a share count that was derived by differencing year-to-date values', () => {
    const result = computeFundamentalFeatures({
      quarterly: [
        fact('WeightedAverageNumberOfDilutedSharesOutstanding', 90, CURRENT, { units: 'shares', derivation: 'ytd_difference' }),
        fact('WeightedAverageNumberOfDilutedSharesOutstanding', 100, YEAR_AGO, { units: 'shares', derivation: 'ytd_difference' }),
      ],
    })
    expect(result.features.find((f) => f.name === 'dilutedShareGrowth')).toBeUndefined()
  })
})

describe('contamination is separated, not folded in', () => {
  it('flags business-combination activity as possibly inorganic growth', () => {
    const result = computeFundamentalFeatures({
      quarterly: [
        ...revenueSet({ current: 200, yearAgo: 100, priorQuarter: 100, priorQuarterYearAgo: 100 }),
        fact('PaymentsToAcquireBusinessesNetOfCashAcquired', 5000, CURRENT),
      ],
    })
    const flag = result.contamination.find((f) => f.kind === 'acquisition')
    expect(flag).toBeDefined()
    expect(flag.fact.accession).toBe(`acc-${CURRENT}`)
    // The growth feature still stands on its own; the flag sits beside it.
    expect(result.features.find((f) => f.name === 'revenueGrowth').value).toBeCloseTo(1, 6)
  })

  it('flags a one-off gain or impairment', () => {
    const result = computeFundamentalFeatures({
      quarterly: [
        fact('Revenues', 120, CURRENT), fact('Revenues', 100, YEAR_AGO),
        fact('GainLossOnSaleOfBusiness', 900, CURRENT),
      ],
    })
    expect(result.contamination.some((f) => f.kind === 'oneOff')).toBe(true)
  })

  it('flags a tax-rate swing so net income is not read as operating', () => {
    const withTax = (rate, periodEnd) => [
      fact('IncomeTaxExpenseBenefit', 100 * rate, periodEnd),
      fact('IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 100, periodEnd),
    ]
    const result = computeFundamentalFeatures({
      quarterly: [
        fact('Revenues', 120, CURRENT), fact('Revenues', 100, YEAR_AGO),
        ...withTax(0.10, CURRENT), ...withTax(0.25, YEAR_AGO),
      ],
    })
    const flag = result.contamination.find((f) => f.kind === 'tax')
    expect(flag.currentRate).toBeCloseTo(0.10, 4)
    expect(flag.priorRate).toBeCloseTo(0.25, 4)
  })

  it('does not flag a tax rate that barely moved', () => {
    const withTax = (rate, periodEnd) => [
      fact('IncomeTaxExpenseBenefit', 100 * rate, periodEnd),
      fact('IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 100, periodEnd),
    ]
    const result = computeFundamentalFeatures({
      quarterly: [
        fact('Revenues', 120, CURRENT), fact('Revenues', 100, YEAR_AGO),
        ...withTax(0.21, CURRENT), ...withTax(0.23, YEAR_AGO),
      ],
    })
    expect(result.contamination.some((f) => f.kind === 'tax')).toBe(false)
  })

  it('flags growth measured against an unusually weak year-ago quarter', () => {
    // Year-ago quarter (60) is far below the median of the quarters before it.
    const result = computeFundamentalFeatures({
      quarterly: [
        fact('Revenues', 120, CURRENT),
        fact('Revenues', 60, YEAR_AGO),
        fact('Revenues', 100, PRIOR_Q_YEAR_AGO),
        fact('Revenues', 100, '2024-12-31'),
        fact('Revenues', 100, '2024-09-30'),
      ],
    })
    expect(result.contamination.some((f) => f.kind === 'easy_comparison')).toBe(true)
  })
})

describe('comparableInstantFacts', () => {
  const instant = (concept, value, periodEnd) => ({
    concept: `us-gaap:${concept}`, value, units: 'USD', periodEnd, periodStart: null,
    accession: `acc-${periodEnd}`, publicAt: `${periodEnd}T20:00:00.000Z`,
  })

  it('pairs a balance-sheet fact with the same instant a year earlier', () => {
    const [current] = comparableInstantFacts(
      [instant('CashAndCashEquivalentsAtCarryingValue', 500, CURRENT),
        instant('CashAndCashEquivalentsAtCarryingValue', 300, YEAR_AGO)],
      `${CURRENT}T23:00:00.000Z`,
    )
    expect(current.priorComparable.value).toBe(300)
    expect(current.derivation).toBe('instant')
  })

  it('never reaches for a fact that was not public by the decision time', () => {
    const facts = comparableInstantFacts(
      [instant('CashAndCashEquivalentsAtCarryingValue', 500, CURRENT),
        instant('CashAndCashEquivalentsAtCarryingValue', 300, YEAR_AGO)],
      '2025-12-31T00:00:00.000Z', // before the current quarter was filed
    )
    expect(facts.some((f) => f.periodEnd === CURRENT)).toBe(false)
  })

  it('feeds a net-debt feature that treats less debt as improvement', () => {
    const instants = comparableInstantFacts([
      instant('CashAndCashEquivalentsAtCarryingValue', 500, CURRENT),
      instant('CashAndCashEquivalentsAtCarryingValue', 300, YEAR_AGO),
      instant('LongTermDebtNoncurrent', 400, CURRENT),
      instant('LongTermDebtNoncurrent', 800, YEAR_AGO),
    ], `${CURRENT}T23:00:00.000Z`)
    const result = computeFundamentalFeatures({
      quarterly: [fact('Revenues', 120, CURRENT), fact('Revenues', 100, YEAR_AGO)],
      instant: instants,
    })
    const netDebt = result.features.find((f) => f.name === 'netDebtChange')
    expect(netDebt.currentNetDebt).toBe(-100) // 400 debt - 500 cash
    expect(netDebt.priorNetDebt).toBe(500) // 800 debt - 300 cash
    expect(netDebt.direction).toBe('improved')
  })
})

// The issue is explicit: a "beat" requires an identifiable prior expectation,
// and this pipeline has none. This is the rule most easily lost in a later edit.
describe('language discipline', () => {
  const growth = {
    name: 'revenueGrowth', value: 0.2, units: 'ratio', direction: 'improved',
    current: { periodEnd: CURRENT }, prior: { periodEnd: YEAR_AGO },
  }

  it('never says beat, surprise or missed without an expectation', () => {
    const sentence = describeChange(growth)
    expect(sentence).toMatch(/previous comparable period/)
    expect(sentence).not.toMatch(/\b(beat|beats|surprise|missed|consensus|estimate)\b/i)
  })

  it('names both period ends so the comparison can be checked', () => {
    const sentence = describeChange(growth)
    expect(sentence).toContain(YEAR_AGO)
    expect(sentence).toContain(CURRENT)
  })

  it('uses expectation language only when an expectation is actually supplied', () => {
    const sentence = describeChange(growth, { expectation: { source: 'point-in-time consensus', value: '1.10' } })
    expect(sentence).toMatch(/exceeded the point-in-time consensus expectation/)
  })

  it('says the comparison is not against an analyst expectation, in the stored thesis', () => {
    const result = computeFundamentalFeatures({
      quarterly: [fact('Revenues', 120, CURRENT), fact('Revenues', 100, YEAR_AGO)],
    })
    const thesis = summarizeImprovement(result)
    expect(thesis).toMatch(/not an analyst expectation/)
    expect(thesis).not.toMatch(/\bbeat\b/i)
  })

  it('states separated contamination in the thesis rather than hiding it', () => {
    const result = computeFundamentalFeatures({
      quarterly: [
        fact('Revenues', 200, CURRENT), fact('Revenues', 100, YEAR_AGO),
        fact('PaymentsToAcquireBusinessesNetOfCashAcquired', 5000, CURRENT),
      ],
    })
    expect(summarizeImprovement(result)).toMatch(/Separated from operating improvement/)
  })

  it('writes no thesis when nothing improved', () => {
    const result = computeFundamentalFeatures({
      quarterly: [fact('Revenues', 80, CURRENT), fact('Revenues', 100, YEAR_AGO)],
    })
    expect(summarizeImprovement(result)).toBeNull()
  })
})

describe('improvementPriority', () => {
  it('is zero when there are no comparable features', () => {
    expect(improvementPriority({ features: [], contamination: [] })).toBe(0)
  })

  it('ranks a clean improvement above the same improvement with contamination', () => {
    const features = [{ name: 'revenueGrowth', direction: 'improved' },
      { name: 'operatingMarginChange', direction: 'improved' }]
    const clean = improvementPriority({ features, contamination: [] })
    const contaminated = improvementPriority({ features, contamination: [{ kind: 'acquisition' }] })
    expect(clean).toBeGreaterThan(contaminated)
    // Contamination lowers rank; it does not exclude the candidate.
    expect(contaminated).toBeGreaterThan(0)
  })

  it('ranks deterioration below improvement', () => {
    const improved = improvementPriority({ features: [{ name: 'revenueGrowth', direction: 'improved' }] })
    const declined = improvementPriority({ features: [{ name: 'revenueGrowth', direction: 'declined' }] })
    expect(improved).toBeGreaterThan(declined)
  })

  it('stays within the 0..100 range createEvidence accepts', () => {
    const everything = ['revenueGrowth', 'revenueGrowthAcceleration', 'operatingMarginChange',
      'cashConversionChange', 'dilutedShareGrowth', 'netDebtChange'].map((name) => ({ name, direction: 'improved' }))
    expect(improvementPriority({ features: everything })).toBeLessThanOrEqual(100)
    expect(improvementPriority({ features: everything, contamination: new Array(20).fill({ kind: 'tax' }) })).toBeGreaterThanOrEqual(0)
  })
})
