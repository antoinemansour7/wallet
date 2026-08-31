import { describe, expect, it } from 'vitest'
import { buildPortfolioSeries, buildIntradaySeries } from './portfolioSeries'

describe('buildPortfolioSeries', () => {
  it('sums quantity × close across positions per day', () => {
    const series = buildPortfolioSeries([
      { quantity: 10, currency: 'CAD', accountCurrency: 'CAD', closesByDate: { '2026-06-01': 100, '2026-06-02': 110 } },
      { quantity: 2, currency: 'CAD', accountCurrency: 'CAD', closesByDate: { '2026-06-01': 50, '2026-06-02': 40 } },
    ])

    expect(series).toEqual([
      { date: '2026-06-01', marketValue: 1100 },
      { date: '2026-06-02', marketValue: 1180 },
    ])
  })

  it('carries the last close forward across missing days (holidays, gaps)', () => {
    const series = buildPortfolioSeries([
      { quantity: 1, currency: 'CAD', accountCurrency: 'CAD', closesByDate: { '2026-06-01': 100, '2026-06-03': 120 } },
      { quantity: 1, currency: 'CAD', accountCurrency: 'CAD', closesByDate: { '2026-06-01': 10, '2026-06-02': 20, '2026-06-03': 30 } },
    ])

    // 06-02: first symbol has no candle — carried at 100
    expect(series[1]).toEqual({ date: '2026-06-02', marketValue: 120 })
  })

  it('converts USD positions in CAD accounts using the per-day FX rate', () => {
    const series = buildPortfolioSeries(
      [{ quantity: 10, currency: 'USD', accountCurrency: 'CAD', closesByDate: { '2026-06-01': 100, '2026-06-02': 100 } }],
      { '2026-06-01': 1.3, '2026-06-02': 1.4 },
    )

    expect(series[0].marketValue).toBe(1300)
    expect(series[1].marketValue).toBe(1400)
  })

  it('leaves USD positions in USD accounts unconverted', () => {
    const series = buildPortfolioSeries(
      [{ quantity: 10, currency: 'USD', accountCurrency: 'USD', closesByDate: { '2026-06-01': 100 } }],
      { '2026-06-01': 1.3 },
    )

    expect(series[0].marketValue).toBe(1000)
  })

  it('adds the cash balance as a constant and handles empty input', () => {
    const series = buildPortfolioSeries(
      [{ quantity: 1, currency: 'CAD', accountCurrency: 'CAD', closesByDate: { '2026-06-01': 100 } }],
      {},
      500,
    )

    expect(series[0].marketValue).toBe(600)
    expect(buildPortfolioSeries([])).toEqual([])
  })
})

describe('buildIntradaySeries', () => {
  it('sums holdings per 5-min bar and emits ms timestamps', () => {
    const series = buildIntradaySeries([
      { quantity: 10, currency: 'USD', accountCurrency: 'USD', closesByTs: { 1000: 50, 1300: 52 } },
      { quantity: 2, currency: 'USD', accountCurrency: 'USD', closesByTs: { 1000: 100, 1300: 90 } },
    ])

    expect(series).toEqual([
      { ts: 1000 * 1000, marketValue: 700 },
      { ts: 1300 * 1000, marketValue: 700 },
    ])
  })

  it('carries the last price forward across missing bars', () => {
    const series = buildIntradaySeries([
      { quantity: 1, currency: 'USD', accountCurrency: 'USD', closesByTs: { 1000: 10, 2000: 30 } },
      { quantity: 1, currency: 'USD', accountCurrency: 'USD', closesByTs: { 1000: 5, 1500: 6, 2000: 7 } },
    ])

    // at ts=1500 the first holding has no bar → carried at 10
    expect(series[1]).toEqual({ ts: 1500 * 1000, marketValue: 16 })
  })

  it('applies the most recent FX rate at or before each bar', () => {
    const series = buildIntradaySeries(
      [{ quantity: 10, currency: 'USD', accountCurrency: 'CAD', closesByTs: { 1000: 100, 2000: 100 } }],
      { 900: 1.3, 1800: 1.4 },
    )

    expect(series[0].marketValue).toBe(1300) // 1.3 in effect at ts 1000
    expect(series[1].marketValue).toBe(1400) // 1.4 in effect by ts 2000
  })

  it('returns empty when no bars exist (pre-open / weekend)', () => {
    expect(buildIntradaySeries([{ quantity: 1, currency: 'USD', accountCurrency: 'USD', closesByTs: {} }])).toEqual([])
    expect(buildIntradaySeries([])).toEqual([])
  })
})

// A holding the price provider cannot value must never quietly become zero:
// that understated the whole portfolio, and because the daily and intraday
// paths failed on different symbols, the total visibly changed with the range.
describe('unpriceable and stale holdings', () => {
  const priced = { quantity: 1, currency: 'CAD', accountCurrency: 'CAD', closesByDate: { '2026-06-01': 100, '2026-06-02': 110 } }

  it('holds a position with no candles at its last known value', () => {
    const series = buildPortfolioSeries([
      priced,
      { quantity: 5, currency: '', accountCurrency: 'CAD', closesByDate: {}, staticValue: 500 },
    ])

    expect(series).toEqual([
      { date: '2026-06-01', marketValue: 600 },
      { date: '2026-06-02', marketValue: 610 },
    ])
  })

  it('drops it to zero only when there is no known value either', () => {
    const series = buildPortfolioSeries([priced, { quantity: 5, closesByDate: {} }])
    expect(series[0].marketValue).toBe(100)
  })

  it('does the same on the intraday path, where TSX ETFs have no bars at all', () => {
    const series = buildIntradaySeries([
      { quantity: 1, currency: 'CAD', accountCurrency: 'CAD', closesByTs: { 1000: 100, 2000: 120 } },
      { quantity: 5, currency: '', accountCurrency: 'CAD', closesByTs: {}, staticValue: 500 },
    ])
    expect(series.map((p) => p.marketValue)).toEqual([600, 620])
  })

  // The bug this exists for: HSU.TO returns a live quote but no daily candle
  // after 2026-07-17, so the old carry-forward valued it at a six-week-old
  // price indefinitely — roughly 20% high, every single day.
  it('stops carrying a stale close once the symbol goes quiet', () => {
    const series = buildPortfolioSeries([
      { quantity: 1, currency: 'CAD', accountCurrency: 'CAD',
        closesByDate: { '2026-06-01': 100, '2026-06-02': 100, '2026-06-03': 100, '2026-06-04': 100,
                        '2026-06-05': 100, '2026-06-06': 100, '2026-06-07': 100, '2026-06-20': 100 } },
      { quantity: 1, currency: 'CAD', accountCurrency: 'CAD',
        closesByDate: { '2026-06-01': 900 }, staticValue: 700 },
    ])

    // within the tolerance the real close still carries
    expect(series.find((p) => p.date === '2026-06-05').marketValue).toBe(1000)
    // past it, the broker value wins over an invented price
    expect(series.find((p) => p.date === '2026-06-20').marketValue).toBe(800)
  })

  it('still carries a real close across an ordinary weekend gap', () => {
    const series = buildPortfolioSeries([
      { quantity: 1, currency: 'CAD', accountCurrency: 'CAD', closesByDate: { '2026-06-05': 10, '2026-06-08': 12 } },
      { quantity: 1, currency: 'CAD', accountCurrency: 'CAD', closesByDate: { '2026-06-05': 100 }, staticValue: 1 },
    ])
    // 06-08 is 3 days later — inside the tolerance, so 100 is still used, not 1
    expect(series.find((p) => p.date === '2026-06-08').marketValue).toBe(112)
  })
})
