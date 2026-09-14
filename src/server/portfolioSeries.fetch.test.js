import { afterEach, describe, expect, it, vi } from 'vitest'
import { getIntradaySeries, getPortfolioSeries } from './portfolioSeries.js'

const cache = vi.hoisted(() => new Map())
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: () => ({
  get: async (key) => cache.get(key),
  set: async (key, value) => cache.set(key, value),
}) } }))

const ts = (time) => Date.parse(`2026-09-11T${time}:00-04:00`) / 1000
function response(symbol, intraday = true) {
  const fx = symbol === 'USDCAD=X'
  return { chart: { result: [{
    meta: { currency: fx ? 'CAD' : 'USD', currentTradingPeriod: { regular: { start: ts('09:30'), end: ts('13:00') } } },
    timestamp: intraday ? [ts('09:30'), ts('12:55'), ts('13:00'), ts('18:00')]
      : [Date.parse('2026-09-10T13:30:00Z') / 1000, ts('09:30')],
    indicators: { quote: [{ close: intraday ? (fx ? [1.4, 1.4, 1.4, 1.5] : [100, 110, 112, 150]) : (fx ? [1.3, 1.4] : [100, 110]) }] },
  }] } }
}
function mockProvider() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const parsed = new URL(url)
    const symbol = decodeURIComponent(parsed.pathname.split('/').at(-1))
    // Exercise the real TSX fallback and the static holding fallback.
    if (symbol === 'HSU' || symbol.startsWith('MISSING')) {
      return { ok: true, json: async () => ({ chart: { result: [{ meta: {}, timestamp: [], indicators: { quote: [{ close: [] }] } }] } }) }
    }
    return { ok: true, json: async () => response(symbol, parsed.searchParams.get('interval') === '5m') }
  }))
}

afterEach(() => {
  cache.clear()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('portfolio reconstruction metadata', () => {
  it('returns actual early-close session bounds and excludes after-hours bars', async () => {
    mockProvider()
    const result = await getIntradaySeries({ positions: [{ symbol: 'ABC', quantity: 10 }], includeSession: true })
    expect(result.session).toEqual({ start: ts('09:30') * 1000, end: ts('13:00') * 1000 })
    expect(result.series.at(-1)).toEqual({ ts: ts('13:00') * 1000, marketValue: 1120 })
    expect(result.series).toHaveLength(3)
    expect(fetch.mock.calls[0][0]).toContain('includePrePost=false')
    expect(await getIntradaySeries({ positions: [{ symbol: 'ABC', quantity: 10 }] })).toEqual(result.series)
  })

  it('preserves cash, FX, TSX resolution and static holdings on both paths', async () => {
    mockProvider()
    const positions = [
      { symbol: 'HSU', quantity: 10, accountCurrency: 'CAD' },
      { symbol: 'MISSING.NE', quantity: 1, marketValue: 500 },
    ]
    const daily = await getPortfolioSeries({ positions, cashValue: 200 })
    expect(daily[0].marketValue).toBe(2000) // 10 × 100 × 1.3 + 500 + 200
    const intraday = await getIntradaySeries({ positions, cashValue: 200, includeSession: true })
    expect(intraday.series[0].marketValue).toBe(2100)
    expect(fetch.mock.calls.some(([url]) => url.includes('/HSU.TO?'))).toBe(true)
  })

  it('caches session metadata without mixing account currencies, static values or fractional cash', async () => {
    mockProvider()
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://cache.example')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test')
    for (const build of [getPortfolioSeries, getIntradaySeries]) {
      const positions = [{ symbol: 'ABC', quantity: 10, accountCurrency: 'USD' }, { symbol: 'MISSING.NE', quantity: 1, marketValue: 500 }]
      const input = { positions, cashValue: 0.1, includeSession: true }
      const first = await build(input)
      const calls = fetch.mock.calls.length
      expect(await build(input)).toEqual(first)
      expect(fetch).toHaveBeenCalledTimes(calls)
      const values = (result) => (result.series ?? result)[0].marketValue
      expect(values(await build({ ...input, cashValue: 0.2 }))).toBeCloseTo(values(first) + 0.1)
      expect(values(await build({ ...input, positions: [positions[0], { ...positions[1], marketValue: 900 }] }))).toBeCloseTo(values(first) + 400)
      expect(values(await build({ ...input, positions: [{ ...positions[0], accountCurrency: 'CAD' }, positions[1]] }))).toBeGreaterThan(values(first))
    }
  })
})
