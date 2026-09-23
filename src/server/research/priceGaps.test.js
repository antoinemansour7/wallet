// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { GAP_FILL_SOURCE, alpacaSipDailyBars, applyGapFills, createGapFiller, marketGapDates } from './priceGaps.js'

const session = (date, close = 100, extra = {}) => ({ date, timestamp: Date.parse(`${date}T13:30:00Z`), open: close - 1, high: close + 1, close, ...extra })
const empty = (date) => ({ date, timestamp: Date.parse(`${date}T13:30:00Z`), open: null, high: null, close: null })
// The 2026-09-22 Yahoo outage: every symbol, SPY included, has an empty row.
const spy = [session('2026-09-18', 761.69), session('2026-09-21', 773.5), empty('2026-09-22'), session('2026-09-23', 769.95)]
const now = Date.parse('2026-09-24T09:42:00Z')

describe('market-wide price gaps', () => {
  it('finds ended sessions where the benchmark itself has no bar', () => {
    expect(marketGapDates(spy, now)).toEqual(['2026-09-22'])
    expect(marketGapDates(spy, Date.parse('2026-09-22T15:00:00Z'))).toEqual([])
    expect(marketGapDates([...spy.slice(0, 3), empty('2026-09-23')], Date.parse('2026-09-23T18:00:00Z'))).toEqual(['2026-09-22'])
  })

  it('fills only empty rows, marks the source, and inserts a row a symbol lacks', () => {
    const fills = new Map([['2026-09-22', { date: '2026-09-22', open: 258, high: 259, close: 254.98 }], ['2026-09-21', { open: 1, high: 1, close: 1 }]])
    const timestamps = new Map(spy.map((bar) => [bar.date, bar.timestamp]))
    const filled = applyGapFills([session('2026-09-21', 258.45), empty('2026-09-22')], fills, timestamps)
    expect(filled[0]).toEqual(session('2026-09-21', 258.45))
    expect(filled[1]).toMatchObject({ date: '2026-09-22', open: 258, close: 254.98, source: GAP_FILL_SOURCE })
    const inserted = applyGapFills([session('2026-09-21'), session('2026-09-23')], fills, timestamps)
    expect(inserted.map((bar) => bar.date)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23'])
    expect(inserted[1].timestamp).toBe(timestamps.get('2026-09-22'))
  })
})

describe('gap filler', () => {
  const fetchBars = vi.fn(async (symbols) => new Map(symbols.map((symbol) => [symbol, [
    { date: '2026-09-22', open: 10, high: 11, close: 10.5 }, { date: '2026-09-21', open: 9, high: 9, close: 9 },
  ]])))

  it('prefetches announced symbols in batches of 100 for the gap dates only', async () => {
    fetchBars.mockClear()
    const filler = createGapFiller({ gapDates: ['2026-09-22'], benchmark: spy, fetchBars })
    await filler.prefetch(Array.from({ length: 150 }, (_, index) => `S${index}`))
    expect(fetchBars.mock.calls.map(([symbols, start, end]) => [symbols.length, start, end])).toEqual([[100, '2026-09-22', '2026-09-22'], [50, '2026-09-22', '2026-09-22']])
    const bars = await filler.fill('S7', [session('2026-09-21', 9.2), empty('2026-09-22')])
    expect(bars[0].close).toBe(9.2)
    expect(bars[1]).toMatchObject({ close: 10.5, source: GAP_FILL_SOURCE })
    expect(fetchBars).toHaveBeenCalledTimes(2)
  })

  it('fetches an unannounced symbol once, on first use', async () => {
    fetchBars.mockClear()
    const filler = createGapFiller({ gapDates: ['2026-09-22'], benchmark: spy, fetchBars })
    await filler.fill('LATE', [empty('2026-09-22')])
    await filler.fill('LATE', [empty('2026-09-22')])
    expect(fetchBars.mock.calls.map(([symbols]) => symbols)).toEqual([['LATE']])
  })

  it('makes no request when there is no market-wide gap', async () => {
    fetchBars.mockClear()
    const filler = createGapFiller({ gapDates: [], benchmark: spy, fetchBars })
    await filler.prefetch(['A', 'B'])
    const bars = [session('2026-09-21')]
    expect(await filler.fill('A', bars)).toBe(bars)
    expect(fetchBars).not.toHaveBeenCalled()
  })

  it('leaves bars unfilled when the fill source fails, and records why', async () => {
    const log = vi.fn()
    const filler = createGapFiller({ gapDates: ['2026-09-22'], benchmark: spy, log, fetchBars: async () => { throw new Error('alpaca_credentials_unavailable') } })
    const bars = await filler.fill('A', [empty('2026-09-22')])
    expect(bars[0].close).toBeNull()
    expect(filler.failures).toEqual([{ symbols: 1, error: 'alpaca_credentials_unavailable' }])
    expect(log).toHaveBeenCalledOnce()
  })
})

describe('Alpaca SIP daily bars', () => {
  it('requests consolidated split-adjusted bars and follows pages', async () => {
    const fetchImpl = vi.fn(async (url) => {
      expect(url.searchParams.get('feed')).toBe('sip')
      expect(url.searchParams.get('adjustment')).toBe('split')
      const second = url.searchParams.has('page_token')
      return { ok: true, json: async () => second
        ? { bars: { SPY: [{ t: '2026-09-22T04:00:00Z', o: 772, h: 775, c: 773.38 }] }, next_page_token: null }
        : { bars: { AMZN: [{ t: '2026-09-22T04:00:00Z', o: 258, h: 259, c: 254.98 }] }, next_page_token: 'next' } }
    })
    const bars = await alpacaSipDailyBars({ fetchImpl, keyId: 'k', secret: 's' })(['AMZN', 'SPY'], '2026-09-22', '2026-09-22')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(bars.get('AMZN')).toEqual([{ date: '2026-09-22', open: 258, high: 259, close: 254.98, volume: null }])
    expect(bars.get('SPY')[0].close).toBe(773.38)
  })

  it('refuses to run without credentials', async () => {
    await expect(alpacaSipDailyBars({ keyId: '', secret: '' })(['SPY'], '2026-09-22', '2026-09-22')).rejects.toThrow('alpaca_credentials_unavailable')
  })
})
