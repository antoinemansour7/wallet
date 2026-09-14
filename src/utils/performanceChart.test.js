import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPortfolioSeries } from '../server/portfolioSeries.js'
import { MARKET_TIME_KEY } from './livePrices.js'
import { previousPortfolioClose, withIntradayEndpoint } from './performanceChart.js'

const ts = (time) => Date.parse(`2026-09-11T${time}:00-04:00`)
const session = { start: ts('09:30'), end: ts('16:00') }
const points = [{ ts: ts('09:30'), marketValue: 58400 }, { ts: ts('15:55'), marketValue: 58580 }]
const rowsAt = (time) => [{ QUANTITY: '10', [MARKET_TIME_KEY]: ts(time) }]

afterEach(() => vi.useRealTimers())

describe('previousPortfolioClose', () => {
  it('uses the reconstructed prior close with cash, historical FX and static holdings', () => {
    const daily = buildPortfolioSeries([
      { quantity: 100, currency: 'USD', accountCurrency: 'CAD', closesByDate: { '2026-09-10': 400, '2026-09-11': 410 } },
      { quantity: 1, staticValue: 3000 },
    ], { '2026-09-10': 1.3, '2026-09-11': 1.4 }, 3000)
    expect(previousPortfolioClose(daily, points[0].ts)).toEqual({ date: '2026-09-10', marketValue: 58000 })
  })

  it('selects the session preceding the bars, including weekends and holiday gaps', () => {
    const daily = [
      { date: '2026-09-04', marketValue: 57000 },
      { date: '2026-09-08', marketValue: 58000 },
    ]
    expect(previousPortfolioClose(daily, Date.parse('2026-09-08T13:30:00Z'))).toEqual(daily[0])
    expect(previousPortfolioClose(daily, Date.parse('2026-09-09T00:30:00Z'))).toEqual(daily[0]) // still Sep 8 in New York
    expect(previousPortfolioClose([], points[0].ts)).toBeNull()
    expect(previousPortfolioClose(daily, undefined)).toBeNull()
  })
})

describe('regular-session live endpoint', () => {
  it('ends at the real closing quote when opened in the evening', () => {
    vi.useFakeTimers().setSystemTime(ts('21:40'))
    const result = withIntradayEndpoint(points, 58600, rowsAt('16:00'), session, true)
    expect(result.at(-1)).toEqual({ ts: ts('16:00'), marketValue: 58600 })
    expect(result).toHaveLength(3)
  })

  it('keeps the latest market bar when timestamp/session evidence is missing', () => {
    expect(withIntradayEndpoint(points, 58600, [{ QUANTITY: 10 }], session, true)).toBe(points)
    expect(withIntradayEndpoint(points, 58600, rowsAt('16:00'), null, true)).toBe(points)
  })

  it('rejects after-hours, old-session, partial, early-close and future quotes', () => {
    vi.useFakeTimers().setSystemTime(ts('21:40'))
    for (const rows of [rowsAt('21:40'), rowsAt('09:00'), [...rowsAt('16:00'), { QUANTITY: 1 }]]) {
      expect(withIntradayEndpoint(points, 200, rows, session, true)).toBe(points)
    }
    expect(withIntradayEndpoint(points, 200, rowsAt('16:00'), { ...session, end: ts('13:00') }, true)).toBe(points)
    vi.setSystemTime(ts('15:55'))
    expect(withIntradayEndpoint(points, 200, rowsAt('16:00'), session, true)).toBe(points)
  })

  it('accepts a sharp valid live move, but preserves fake-crash protection while settling', () => {
    vi.useFakeTimers().setSystemTime(ts('15:59'))
    expect(withIntradayEndpoint(points, 200, rowsAt('15:58'), session, false)).toBe(points)
    expect(withIntradayEndpoint(points, 200, rowsAt('15:58'), session, true).at(-1)).toEqual({ ts: ts('15:58'), marketValue: 200 })
    expect(withIntradayEndpoint(points, 200, rowsAt('15:55'), session, true)).toEqual([points[0], { ts: ts('15:55'), marketValue: 200 }])
    for (const value of [NaN, Infinity, 0, -1]) {
      expect(withIntradayEndpoint(points, value, rowsAt('15:58'), session, true)).toBe(points)
    }
  })
})
