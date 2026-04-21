import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchYahooQuotes } from './yahooQuotes'

function chartResponse(symbol, price, previousClose = 100) {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            currency: 'USD',
            regularMarketPrice: price,
            chartPreviousClose: previousClose,
            regularMarketTime: 1776785789,
          },
        },
      ],
      error: null,
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchYahooQuotes cache', () => {
  it('serves fresh repeated ticker requests from cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => chartResponse('CACHE1', 125, 100),
    }))

    const first = await fetchYahooQuotes(['CACHE1'])
    const second = await fetchYahooQuotes(['CACHE1'])

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(first.cache.refreshed).toBe(1)
    expect(second.cache.hits).toBe(1)
    expect(second.cache.refreshed).toBe(0)
    expect(second.quotes[0].price).toBe(125)
  })
})
