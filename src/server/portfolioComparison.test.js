import { describe, expect, it } from 'vitest'
import { buildComparison } from './portfolioComparison'
const day1 = '2026-06-01', day2 = '2026-06-02', day3 = '2026-06-03'
const benchmark = { currency: 'USD', closesByDate: { [day1]: 100, [day2]: 110, [day3]: 120 } }
const holding = { symbol: 'TEST', quantity: 2, currency: 'USD', staticValue: 240, closesByDate: { [day1]: 100, [day2]: 110, [day3]: 120 } }

describe('historical benchmark comparison', () => {
  it('converts holdings and benchmark with the same daily exchange rates', () => {
    const result = buildComparison({ positions: [holding], benchmark, currency: 'CAD', fx: { [day1]: 1.3, [day2]: 1.4, [day3]: 1.5 }, cashValue: 50 })
    expect(result.series.map((point) => [point.portfolio, point.benchmark])).toEqual([[310, 130], [358, 154], [410, 180]])
  })
  it('converts a Canadian listing into USD using the inverse exchange rate', () => {
    const result = buildComparison({ positions: [{ ...holding, currency: 'CAD' }], benchmark, currency: 'USD', fx: { [day1]: 1.25, [day2]: 1.25, [day3]: 1.25 } })
    expect(result.series[0]).toEqual({ date: day1, portfolio: 160, benchmark: 100 })
  })
  it('starts at the newest listing rather than backfilling earlier prices', () => {
    const result = buildComparison({ positions: [{ ...holding, closesByDate: { [day2]: 110, [day3]: 120 } }], benchmark, currency: 'USD' })
    expect(result.series.map((point) => point.date)).toEqual([day2, day3])
  })
  it('holds unavailable assets constant and reports their coverage', () => {
    const result = buildComparison({ positions: [holding, { symbol: 'MISSING', quantity: 1, staticValue: 60 }], benchmark, currency: 'USD', cashValue: 25 })
    expect(result.series[0].portfolio).toBe(285)
    expect(result.coverage).toEqual({ priced: 1, total: 2, percent: 80 })
    expect(result.missingSymbols).toEqual(['MISSING'])
  })
  it('does not silently use an exchange rate of one when FX is unavailable', () => {
    expect(() => buildComparison({ positions: [holding], benchmark, currency: 'CAD' })).toThrow('Exchange-rate history is unavailable')
  })
  it('does not invent a flat series when no holding has history', () => {
    expect(buildComparison({ positions: [{ ...holding, closesByDate: {} }], benchmark, currency: 'USD' }).series).toEqual([])
  })
  it('holds an entirely stale holding constant, avoiding a mid-series price jump', () => {
    const result = buildComparison({ positions: [holding, { ...holding, symbol: 'STALE', staticValue: 50, closesByDate: { '2026-05-01': 10, '2026-05-02': 11 } }], benchmark, currency: 'USD' })
    expect(result.series[0].portfolio).toBe(250)
    expect(result.series.at(-1).portfolio).toBe(290)
    expect(result.missingSymbols).toEqual(['STALE'])
  })
  it('rejects an unknown display currency and an unavailable benchmark', () => {
    expect(() => buildComparison({ positions: [holding], benchmark, currency: 'Unspecified' })).toThrow('Choose CAD or USD')
    expect(() => buildComparison({ positions: [holding], benchmark: null, currency: 'USD' })).toThrow('Benchmark history is unavailable')
  })
})
