import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyLivePrices,
  collectSymbols,
  enrichRowsWithLivePrices,
  fetchLivePrices,
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
      body: JSON.stringify({ symbols: ['AAPL'] }),
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
    expect(rows[0]['ACCOUNT CURRENCY']).toBe('USD')
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
