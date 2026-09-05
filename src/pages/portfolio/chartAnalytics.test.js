import { describe, expect, it } from 'vitest'
import { analyticsScopes, comparisonHasGap, comparisonTimePosition, holdingDrivers, normalizeComparison } from './chartAnalytics'

describe('chart data scopes', () => {
  it('spaces historical points by calendar time and detects missing stretches', () => {
    const points = [{ date: '2026-06-01' }, { date: '2026-06-02' }, { date: '2026-06-11' }]
    expect(comparisonTimePosition(points, 1)).toBeCloseTo(.1)
    expect(comparisonHasGap(points[0], points[1])).toBe(false)
    expect(comparisonHasGap(points[1], points[2])).toBe(true)
  })
  it('separates mixed-currency rows and cash within the same account', () => {
    const scopes = analyticsScopes([{ accountNumber: 'A', currency: 'CAD', cash: 50, positions: [
      { SYMBOL: 'CA', 'ACCOUNT CURRENCY': 'CAD', 'MARKET VALUE': 100 },
      { SYMBOL: 'US', 'ACCOUNT CURRENCY': 'USD', 'MARKET VALUE': 200 },
      { SYMBOL: 'UNKNOWN', 'MARKET VALUE': 20 },
    ] }])
    expect(scopes.map((scope) => [scope.currency, scope.accounts[0].value, scope.cash])).toEqual([['CAD', 150, 50], ['USD', 200, 0], ['Unspecified', 20, 0]])
  })
  it('retains cash-only accounts', () => {
    expect(analyticsScopes([{ accountNumber: 'Cash', currency: 'USD', cash: 100, positions: [] }])[0].accounts[0].value).toBe(100)
  })
  it('rebases both lines to the same first visible date on a range change', () => {
    const points = [{ date: '2026-01-01', portfolio: 50, benchmark: 100 }, { date: '2026-06-01', portfolio: 100, benchmark: 150 }, { date: '2026-06-20', portfolio: 110, benchmark: 120 }]
    const result = normalizeComparison(points, 30)
    expect(result[0]).toEqual({ date: '2026-06-01', portfolio: 0, benchmark: 0 })
    expect(result[1].portfolio).toBeCloseTo(10)
    expect(result[1].benchmark).toBeCloseTo(-20)
  })
  it('combines a holding across accounts and excludes absent daily changes', () => {
    const result = holdingDrivers([{ SYMBOL: 'A', 'DAY CHANGE': 20 }, { SYMBOL: 'A', 'DAY CHANGE': -5 }, { SYMBOL: 'B', 'DAY CHANGE': -30 }, { SYMBOL: 'C' }, { SYMBOL: 'D', 'DAY CHANGE': 'unavailable' }], 'DAY CHANGE')
    expect(result.items.map(({ symbol, value }) => [symbol, value])).toEqual([['B', -30], ['A', 15]])
    expect(result.missing).toBe(2)
  })
  it('does not calculate returns from zero or invalid starting balances', () => {
    expect(normalizeComparison([{ date: '2026-06-01', portfolio: 0, benchmark: 10 }, { date: '2026-06-02', portfolio: 10, benchmark: 11 }], 30)).toEqual([])
  })
})
