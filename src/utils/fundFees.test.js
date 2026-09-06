import { describe, it, expect } from 'vitest'
import { summarizeFundFees } from './fundFees'

const row = (SYMBOL, value) => ({ SYMBOL, 'MARKET VALUE': String(value) })

const REFERENCE = {
  VFV: { isFund: true, expenseRatioPct: 0.09 },
  XEQT: { isFund: true, expenseRatioPct: 0.2 },
  ZBND: { isFund: true, expenseRatioPct: null },   // a fund whose fee never resolved
  SHOP: { isFund: false, expenseRatioPct: null },  // an individual stock
}

describe('summarizeFundFees', () => {
  it('states the annual cost in dollars, not only as a percentage', () => {
    // $50,000 x 0.09% = $45.00 ; $25,000 x 0.20% = $50.00
    const summary = summarizeFundFees([row('VFV', 50000), row('XEQT', 25000)], REFERENCE)

    expect(summary.annualFeeMinor).toBe(9500)
    expect(summary.holdings.map((h) => h.symbol)).toEqual(['XEQT', 'VFV'])
    expect(summary.complete).toBe(true)
  })

  it('excludes individual stocks rather than counting them at zero', () => {
    // Counting SHOP at 0% would drag the weighted rate from 0.09% to 0.03%,
    // producing a smaller number that looks like a better one.
    const withStock = summarizeFundFees([row('VFV', 50000), row('SHOP', 100000)], REFERENCE)

    expect(withStock.annualFeeMinor).toBe(4500)
    expect(withStock.weightedMerPct).toBe(0.09)
    expect(withStock.pricedValueMinor).toBe(5000000)
  })

  it('states missing fee data instead of treating it as zero', () => {
    const summary = summarizeFundFees([row('VFV', 50000), row('ZBND', 40000)], REFERENCE)

    expect(summary.complete).toBe(false)
    expect(summary.missingFeeData).toEqual(['ZBND'])
    expect(summary.unpricedValueMinor).toBe(4000000)
    // The known part is still reported, and the total does not silently include
    // the fund it could not price.
    expect(summary.annualFeeMinor).toBe(4500)
  })

  it('does not assume an unresolved security is a fund', () => {
    // An unresolved stock counted as an unpriced fund would report a gap in fee
    // data that does not exist.
    const summary = summarizeFundFees([row('VFV', 50000), row('MYSTERY', 10000)], REFERENCE)

    expect(summary.missingFeeData).toEqual([])
    expect(summary.complete).toBe(true)
  })

  it('says nothing when the portfolio holds no funds at all', () => {
    expect(summarizeFundFees([row('SHOP', 100000)], REFERENCE)).toBeNull()
    expect(summarizeFundFees([], REFERENCE)).toBeNull()
  })

  it('ignores holdings with no usable market value', () => {
    expect(summarizeFundFees([row('VFV', 0), row('VFV', '')], REFERENCE)).toBeNull()
  })

  it('weights the reported rate across the funds it could price', () => {
    const summary = summarizeFundFees([row('VFV', 50000), row('XEQT', 50000)], REFERENCE)

    // (0.09 + 0.20) / 2 by equal weight
    expect(summary.weightedMerPct).toBeCloseTo(0.145, 3)
  })
})
