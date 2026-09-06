import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  lastPricedAt,
  isPriceStale,
  PRICED_AT_KEY,
  applyLivePrices,
  collectSymbols,
  enrichRowsWithLivePrices,
  fetchLivePrices,
  getFallbackQuoteSymbolsForRow,
} from './livePrices'

const ROWS = [
  {
    SYMBOL: 'AAPL',
    QUANTITY: '10',
    'BOOK VALUE': '1200.00',
    'MARKET PRICE': '100.00',
    'MARKET VALUE': '1000.00',
  },
  {
    SYMBOL: 'NVDA.NE',
    QUANTITY: '4',
    'BOOK VALUE': '100.00',
    'MARKET PRICE': '20.00',
    'MARKET VALUE': '80.00',
  },
]

const CDR_ROW = {
  SYMBOL: 'AVGO',
  DESCRIPTION: 'BROADCOM INC CDR C$HDG',
  'ACCOUNT CURRENCY': 'CAD',
  QUANTITY: '655',
  'BOOK VALUE': '8848.86',
  'MARKET PRICE': '15.30',
  'MARKET VALUE': '10021.50',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('collectSymbols', () => {
  it('deduplicates non-empty symbols', () => {
    expect(collectSymbols([...ROWS, { SYMBOL: 'AAPL' }, { SYMBOL: '' }])).toEqual(['AAPL', 'NVDA.NE'])
  })

  it('requests Canadian Yahoo symbols for CAD CDR rows', () => {
    expect(collectSymbols([CDR_ROW])).toEqual(['AVGO.NE'])
  })
})

describe('fetchLivePrices', () => {
  it('posts symbols to the live price endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ quotes: [{ symbol: 'AAPL', price: 150 }], missing: [] }),
    }))

    const result = await fetchLivePrices(['AAPL'])

    expect(fetch).toHaveBeenCalledWith('/api/live-prices', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ symbols: ['AAPL', 'USDCAD=X'], cachedOnly: false }),
    }))
    expect(result.quotes[0].price).toBe(150)
  })

  it('throws endpoint errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Yahoo failed' }),
    }))

    await expect(fetchLivePrices(['AAPL'])).rejects.toThrow('Yahoo failed')
  })
})

describe('applyLivePrices', () => {
  it('updates price, market value, day change, and unrealized P&L', () => {
    const { rows, updatedRows } = applyLivePrices(ROWS, [
      {
        symbol: 'AAPL',
        currency: 'USD',
        price: 150,
        change: 2,
        changePercent: 1.35,
      },
    ])

    expect(updatedRows).toBe(1)
    // Left as it was, not backfilled from the quote. ACCOUNT CURRENCY is what
    // the holding is denominated in; the quote's currency is what the security
    // trades in. Writing the second into the first made a US stock in a
    // Canadian account claim to be a US account, which switched the USD→CAD
    // conversion off for every refresh after the first.
    expect(rows[0]['ACCOUNT CURRENCY']).toBe('')
    expect(rows[0]['MARKET PRICE']).toBe('150.00')
    expect(rows[0]['MARKET VALUE']).toBe('1500.00')
    expect(rows[0]['DAY CHANGE']).toBe('20.00')
    expect(rows[0]['DAY CHANGE %']).toBe('1.35%')
    expect(rows[0]['UNREALIZED GAIN/LOSS']).toBe('300.00')
    expect(rows[0]['UNREALIZED GAIN/LOSS %']).toBe('25.00%')
    expect(rows[1]).toBe(ROWS[1])
  })

  it('uses previous close when quote change is unavailable', () => {
    const { rows } = applyLivePrices([ROWS[0]], [
      { symbol: 'AAPL', price: 150, previousClose: 145 },
    ])

    expect(rows[0]['DAY CHANGE']).toBe('50.00')
    expect(rows[0]['DAY CHANGE %']).toBe('3.45%')
  })

  it('does not overwrite CAD rows with USD quotes', () => {
    const { rows, updatedRows } = applyLivePrices([CDR_ROW], [
      { symbol: 'AVGO', currency: 'USD', price: 401.65, change: 8.8, changePercent: 2.2 },
    ])

    expect(updatedRows).toBe(0)
    expect(rows[0]['MARKET PRICE']).toBe('15.30')
    expect(rows[0]['MARKET VALUE']).toBe('10021.50')
  })

  it('updates CAD CDR rows with matching Canadian quotes', () => {
    const { rows, updatedRows } = applyLivePrices([CDR_ROW], [
      { symbol: 'AVGO.NE', requestedSymbol: 'AVGO.NE', currency: 'CAD', price: 15.5, change: 0.2, changePercent: 1.31 },
    ])

    expect(updatedRows).toBe(1)
    expect(rows[0]['MARKET PRICE']).toBe('15.50')
    expect(rows[0]['MARKET VALUE']).toBe('10152.50')
    expect(rows[0]['DAY CHANGE']).toBe('131.00')
  })
})

describe('enrichRowsWithLivePrices', () => {
  it('fetches and applies matching quotes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        quotes: [{ symbol: 'AAPL', price: 150, change: 1, changePercent: 0.67 }],
        missing: ['NVDA.NE'],
      }),
    }))

    const result = await enrichRowsWithLivePrices(ROWS)

    expect(result.updatedRows).toBe(1)
    expect(result.missing).toEqual(['NVDA.NE'])
    expect(result.rows[0]['MARKET VALUE']).toBe('1500.00')
  })
})

// Yahoo answers a bare TSX ticker with a 200 and an empty NasdaqGS stub rather
// than an error, so "HSU" produced no price and no candles while "HSU.TO"
// returns a full year. Canadian leveraged ETFs are TSX-only, which is why they
// were the holdings that appeared broken.
describe('TSX fallback symbols', () => {
  const TSX_ROW = { SYMBOL: 'HSU', QUANTITY: '200', 'BOOK VALUE': '5000.00', 'MARKET VALUE': '5294.00' }

  it('offers a .TO fallback for a bare symbol', () => {
    expect(getFallbackQuoteSymbolsForRow(TSX_ROW)).toEqual(['HSU.TO'])
  })

  it('offers none when the symbol already carries an exchange suffix', () => {
    expect(getFallbackQuoteSymbolsForRow({ SYMBOL: 'NVDA.NE' })).toEqual([])
  })

  it('offers none for CDRs, which are already routed to .NE', () => {
    expect(getFallbackQuoteSymbolsForRow(CDR_ROW)).toEqual([])
  })

  it('keeps the bare symbol as the primary request', () => {
    expect(collectSymbols([TSX_ROW])).toEqual(['HSU'])
  })

  it('prices a row from the .TO quote when the bare symbol returned nothing', () => {
    const { rows, updatedRows } = applyLivePrices([TSX_ROW], [
      { symbol: 'HSU.TO', requestedSymbol: 'HSU.TO', currency: 'CAD', price: 26.47, previousClose: 26.00 },
    ])

    expect(updatedRows).toBe(1)
    expect(rows[0]['MARKET VALUE']).toBe('5294.00')
    expect(rows[0]['DAY CHANGE']).toBe('94.00')
  })

  it('prefers the bare quote when both resolve', () => {
    const { rows } = applyLivePrices([TSX_ROW], [
      { symbol: 'HSU', requestedSymbol: 'HSU', currency: 'USD', price: 10 },
      { symbol: 'HSU.TO', requestedSymbol: 'HSU.TO', currency: 'CAD', price: 26.47 },
    ])
    expect(rows[0]['MARKET PRICE']).toBe('10.00')
  })

  it('retries only the unpriced rows and clears them from missing', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body)
      calls.push(body.symbols)
      if (body.symbols.includes('HSU.TO')) {
        return { ok: true, json: async () => ({ quotes: [{ symbol: 'HSU.TO', requestedSymbol: 'HSU.TO', currency: 'CAD', price: 26.47 }], missing: [] }) }
      }
      return { ok: true, json: async () => ({ quotes: [{ symbol: 'AAPL', requestedSymbol: 'AAPL', currency: 'USD', price: 150 }], missing: ['HSU'] }) }
    }))

    const result = await enrichRowsWithLivePrices([{ SYMBOL: 'AAPL', QUANTITY: '10' }, TSX_ROW])

    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(['HSU.TO', 'USDCAD=X'])
    expect(result.missing).toEqual([])
    expect(result.updatedRows).toBe(2)
  })

  it('does not fire a second request when everything already priced', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      calls.push(JSON.parse(options.body).symbols)
      return { ok: true, json: async () => ({ quotes: [{ symbol: 'AAPL', requestedSymbol: 'AAPL', currency: 'USD', price: 150 }], missing: [] }) }
    }))

    await enrichRowsWithLivePrices([{ SYMBOL: 'AAPL', QUANTITY: '10' }])

    expect(calls).toHaveLength(1)
  })

  it('keeps the first-pass prices when the retry itself fails', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1
      if (call === 1) return { ok: true, json: async () => ({ quotes: [{ symbol: 'AAPL', requestedSymbol: 'AAPL', currency: 'USD', price: 150 }], missing: ['HSU'] }) }
      return { ok: false, status: 500, json: async () => ({ error: 'provider down' }) }
    }))

    const result = await enrichRowsWithLivePrices([{ SYMBOL: 'AAPL', QUANTITY: '10' }, TSX_ROW])

    expect(result.updatedRows).toBe(1)
    expect(result.missing).toEqual(['HSU'])
  })

  it("retries when the first pass returned a priceless stub", async () => {
    const calls = []
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body)
      calls.push(body.symbols)
      if (body.symbols.includes("HSU.TO")) {
        return { ok: true, json: async () => ({ quotes: [{ symbol: "HSU.TO", requestedSymbol: "HSU.TO", currency: "CAD", price: 26.47 }], missing: [] }) }
      }
      // Yahoo answers an unknown ticker with a stub carrying no price
      return { ok: true, json: async () => ({ quotes: [{ symbol: "HSU", requestedSymbol: "HSU", currency: null }], missing: [] }) }
    }))

    const result = await enrichRowsWithLivePrices([TSX_ROW])

    expect(calls).toHaveLength(2)
    expect(result.updatedRows).toBe(1)
  })
})

describe('knowing which prices are stale', () => {
  const at = (iso) => ({ SYMBOL: 'X', [PRICED_AT_KEY]: iso })
  const now = Date.now()
  const iso = (msAgo) => new Date(now - msAgo).toISOString()

  it('stamps every row it manages to price', () => {
    const { rows } = applyLivePrices(
      [{ SYMBOL: 'AAPL', QUANTITY: '10', 'MARKET PRICE': '100' }],
      [{ symbol: 'AAPL', price: 105, currency: 'USD' }],
    )
    expect(Date.parse(rows[0][PRICED_AT_KEY])).toBeGreaterThan(0)
  })

  it('leaves a row it could not price without a fresh stamp', () => {
    const { rows } = applyLivePrices(
      [{ SYMBOL: 'NOPE', QUANTITY: '10', 'MARKET PRICE': '100' }],
      [{ symbol: 'AAPL', price: 105, currency: 'USD' }],
    )
    expect(rows[0][PRICED_AT_KEY]).toBeUndefined()
  })

  it('reports the freshest moment across the book', () => {
    expect(lastPricedAt([at(iso(90000000)), at(iso(1000))])).toBeCloseTo(now - 1000, -3)
    expect(lastPricedAt([])).toBeNull()
    expect(lastPricedAt([{ SYMBOL: 'X' }])).toBeNull()
  })

  it('marks a row the newest refresh left behind', () => {
    const newest = lastPricedAt([at(iso(1000)), at(iso(90000000))])
    expect(isPriceStale(at(iso(90000000)), newest)).toBe(true)
    expect(isPriceStale(at(iso(1000)), newest)).toBe(false)
  })

  it('marks a row that has never been priced while others have', () => {
    const newest = lastPricedAt([at(iso(1000))])
    expect(isPriceStale({ SYMBOL: 'X' }, newest)).toBe(true)
  })

  it('marks nothing when nothing has ever been priced', () => {
    // A freshly imported portfolio is all statement values. Flagging every row
    // would be noise, and the refresh banner already says the state of the run.
    expect(isPriceStale({ SYMBOL: 'X' }, lastPricedAt([{ SYMBOL: 'X' }]))).toBe(false)
  })

  it('does not mark rows priced moments apart within one refresh', () => {
    const newest = lastPricedAt([at(iso(0)), at(iso(4000))])
    expect(isPriceStale(at(iso(4000)), newest)).toBe(false)
  })
})

it('does not use an explicitly stale FX quote for conversion', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ quotes: [{ symbol: 'USDCAD=X', price: 1.4, cacheStatus: 'stale' }] }) }))
  expect((await fetchLivePrices(['MSFT'])).usdCadRate).toBeNull()
})
