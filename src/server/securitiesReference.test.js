import { describe, it, expect, vi } from 'vitest'
import {
  parseDividendEvents,
  trailingYieldPct,
  exchangeInfoFromChartMeta,
  classifyFundComposition,
  DOMESTIC_EQUITY_FUNDS,
  fetchFigi,
} from './securitiesReference'

const NOW = new Date('2026-09-05T00:00:00Z').getTime()
const daysAgo = (n) => Math.floor((NOW - n * 86400000) / 1000)

describe('parseDividendEvents', () => {
  it('turns the chart endpoint’s dividend events into a plain array', () => {
    const chart = { events: { dividends: { '1757943000': { amount: 0.51, date: 1757943000 }, '1764599400': { amount: 0.51, date: 1764599400 } } } }
    expect(parseDividendEvents(chart)).toEqual([
      { date: 1757943000, amount: 0.51 },
      { date: 1764599400, amount: 0.51 },
    ])
  })

  it('returns an empty array for a security with no dividend history', () => {
    expect(parseDividendEvents({ events: {} })).toEqual([])
    expect(parseDividendEvents({})).toEqual([])
    expect(parseDividendEvents(null)).toEqual([])
  })
})

describe('trailingYieldPct', () => {
  it('sums the trailing 12 months of dividends and divides by the current price', () => {
    const dividends = [
      { date: daysAgo(30), amount: 0.53 },
      { date: daysAgo(120), amount: 0.53 },
      { date: daysAgo(210), amount: 0.51 },
      { date: daysAgo(300), amount: 0.51 },
    ]
    // (0.53+0.53+0.51+0.51) / 100 * 100 = 2.08%
    expect(trailingYieldPct(dividends, 100, { now: NOW })).toBeCloseTo(2.08, 5)
  })

  it('excludes a dividend paid more than 12 months ago', () => {
    const dividends = [{ date: daysAgo(30), amount: 1 }, { date: daysAgo(400), amount: 5 }]
    expect(trailingYieldPct(dividends, 100, { now: NOW })).toBeCloseTo(1, 5)
  })

  it('returns null rather than 0 for a security with no dividends in the window', () => {
    // No dividends could mean "does not pay one" or "we have no history for
    // it" — both are real gaps, and 0% reads as a measured fact rather than
    // an absence. The caller decides what to do with null.
    expect(trailingYieldPct([], 100, { now: NOW })).toBeNull()
  })

  it('returns null rather than dividing by zero for a missing or zero price', () => {
    expect(trailingYieldPct([{ date: daysAgo(30), amount: 1 }], 0, { now: NOW })).toBeNull()
    expect(trailingYieldPct([{ date: daysAgo(30), amount: 1 }], null, { now: NOW })).toBeNull()
  })
})

describe('exchangeInfoFromChartMeta', () => {
  it('reads exchange and currency from the chart endpoint’s existing meta object', () => {
    // No new endpoint for this — confirmed live against XEQT.TO before writing
    // this: the price-fetching call already carries this.
    const meta = { exchangeName: 'TOR', fullExchangeName: 'Toronto', currency: 'CAD' }
    expect(exchangeInfoFromChartMeta(meta)).toEqual({ exchange: 'TOR', exchangeName: 'Toronto', currency: 'CAD' })
  })

  it('returns nulls rather than guessing when meta is absent', () => {
    expect(exchangeInfoFromChartMeta(null)).toEqual({ exchange: null, exchangeName: null, currency: null })
  })
})

const xeqtHoldings = [
  { symbol: 'XTOT.TO', holdingPercent: 0.2915 },
  { symbol: 'XIC.TO', holdingPercent: 0.2536 },
  { symbol: 'XEF.TO', holdingPercent: 0.2464 },
  { symbol: 'ITOT', holdingPercent: 0.1608 },
  { symbol: 'XEC.TO', holdingPercent: 0.0467 },
]

describe('classifyFundComposition', () => {
  it('flags foreign exposure from a fund’s real holdings, confirmed against XEQT.TO', () => {
    // XIC.TO is the only domestic holding here; everything else is foreign —
    // this is real data pulled live, not a fabricated fixture.
    const result = classifyFundComposition(xeqtHoldings)
    expect(result.holdsForeignEquities).toBe(true)
    expect(result.foreignPct).toBeCloseTo(0.2915 + 0.2464 + 0.1608 + 0.0467, 4)
    expect(result.evidence).toContain('XTOT.TO')
    expect(result.evidence).not.toContain('XIC.TO')
  })

  it('reports no foreign exposure for a fund holding only known domestic equities', () => {
    const result = classifyFundComposition([{ symbol: 'XIC.TO', holdingPercent: 1 }])
    expect(result.holdsForeignEquities).toBe(false)
    expect(result.evidence).toEqual([])
  })

  it('generalizes to a fund never seen before, because it reasons from holdings rather than a maintained list', () => {
    const result = classifyFundComposition([{ symbol: 'BRAND-NEW-FUND', holdingPercent: 1 }])
    expect(result.holdsForeignEquities).toBe(true)
    expect(result.evidence).toContain('BRAND-NEW-FUND')
  })

  it('returns null rather than guessing when there are no holdings to reason from', () => {
    expect(classifyFundComposition([])).toBeNull()
    expect(classifyFundComposition(null)).toBeNull()
  })

  it('accepts a custom domestic list, defaulting to the exported one', () => {
    expect(DOMESTIC_EQUITY_FUNDS.has('XIC.TO')).toBe(true)
    const result = classifyFundComposition([{ symbol: 'MYFUND.TO', holdingPercent: 1 }], { domesticFunds: new Set(['MYFUND.TO']) })
    expect(result.holdsForeignEquities).toBe(false)
  })
})

describe('fetchFigi', () => {
  it('maps a ticker and exchange to a FIGI', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => [{ data: [{ figi: 'BBG00PPX3Y33', ticker: 'XEQT', exchCode: 'CT' }] }],
    }))

    const figi = await fetchFigi('XEQT', 'CT', { fetchImpl })
    expect(figi).toBe('BBG00PPX3Y33')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openfigi.com/v3/mapping',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('returns null when OpenFIGI has no mapping, rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => [{ warning: 'No identifier found.' }] }))
    expect(await fetchFigi('ZZZZZ', 'XX', { fetchImpl })).toBeNull()
  })

  it('returns null on a transport failure rather than surfacing it as a rejection', async () => {
    // A FIGI lookup is best-effort reference data, not something a caller
    // should have to wrap in try/catch to use — a failed lookup and an
    // unmapped ticker mean the same thing to every caller: fall back to the
    // symbol key.
    const fetchImpl = vi.fn(async () => { throw new Error('network down') })
    expect(await fetchFigi('XEQT', 'CT', { fetchImpl })).toBeNull()
  })

  it('returns null on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429 }))
    expect(await fetchFigi('XEQT', 'CT', { fetchImpl })).toBeNull()
  })
})

it('identifies a fund from chart metadata when its profile cannot be fetched', async () => {
  const { resolveSecurityReference } = await import('./securitiesReference')
  const fetchImpl = vi.fn(async (url) => String(url).includes('/chart/')
    ? { ok: true, json: async () => ({ chart: { result: [{ meta: { instrumentType: 'ETF', regularMarketPrice: 100, exchangeName: 'TOR', currency: 'CAD' } }] } }) }
    : { ok: false })
  const result = await resolveSecurityReference('VFV.TO', { fetchImpl, now: NOW })
  expect(result).toMatchObject({ isFund: true, expenseRatioPct: null, holdsForeignEquities: null })
})
