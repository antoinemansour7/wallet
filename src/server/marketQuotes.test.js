import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMarketQuotes } from './marketQuotes'

function yahooChartResponse(symbol, price, currency = 'USD', previousClose = price) {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            currency,
            regularMarketPrice: price,
            chartPreviousClose: previousClose,
          },
        },
      ],
      error: null,
    },
  }
}

function responseJson(data, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.POLYGON_API_KEY
  delete process.env.POLYGON_API_BASE_URL
})

describe('fetchMarketQuotes', () => {
  it('routes US stocks to Polygon and CDR/FX symbols to Yahoo', async () => {
    process.env.POLYGON_API_KEY = 'polygon-test-key'

    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = decodeURIComponent(String(input))

      if (url.startsWith('https://api.massive.com/')) {
        return responseJson({
          tickers: [
            {
              ticker: 'AAPL',
              lastTrade: { p: 150 },
              prevDay: { c: 145 },
              todaysChange: 5,
              todaysChangePerc: 3.4482758621,
              updated: 1776797678000000000,
            },
          ],
        })
      }

      if (url.includes('/MSTR.NE?')) {
        return responseJson(yahooChartResponse('MSTR.NE', 11.5, 'CAD', 11.75))
      }

      if (url.includes('/USDCAD=X?')) {
        return responseJson(yahooChartResponse('USDCAD=X', 1.37, 'CAD', 1.36))
      }

      throw new Error(`Unexpected URL: ${url}`)
    }))

    const result = await fetchMarketQuotes(['AAPL', 'MSTR.NE', 'USDCAD=X'])

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(result.missing).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.quotes.find((quote) => quote.symbol === 'AAPL')).toMatchObject({
      provider: 'polygon',
      price: 150,
      change: 5,
      currency: 'USD',
    })
    expect(result.quotes.find((quote) => quote.symbol === 'MSTR.NE')).toMatchObject({
      provider: 'yahoo',
      price: 11.5,
      change: -0.25,
      currency: 'CAD',
    })
  })

  it('falls back to Yahoo when Polygon cannot return a US stock', async () => {
    process.env.POLYGON_API_KEY = 'polygon-test-key'

    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = decodeURIComponent(String(input))

      if (url.startsWith('https://api.massive.com/')) {
        return responseJson({ error: 'snapshots unavailable' }, false, 403)
      }

      if (url.includes('/FALLBACK1?')) {
        return responseJson(yahooChartResponse('FALLBACK1', 20, 'USD', 19))
      }

      throw new Error(`Unexpected URL: ${url}`)
    }))

    const result = await fetchMarketQuotes(['FALLBACK1'])

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.missing).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.quotes[0]).toMatchObject({
      provider: 'yahoo',
      symbol: 'FALLBACK1',
      price: 20,
      change: 1,
    })
  })
})
