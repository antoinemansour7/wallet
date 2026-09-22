// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { ALPACA_ANALYTICS_UNITS, ALPACA_FEATURE_SOURCE, ALPACA_FEEDS, createAlpacaOptionsAdapter } from './alpaca.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'

const recorded = JSON.parse(readFileSync(new URL('./fixtures/alpaca/recorded-chain.json', import.meta.url)))
const security = OPTIONS_WATCHLIST_SNAPSHOT.securities.find((item) => item.ticker === 'NVDA')
const now = '2026-09-22T13:32:10.000Z'
const request = {
  security,
  expirationDateGte: '2026-09-29',
  expirationDateLte: '2026-11-21',
  strikePriceGte: 180,
  strikePriceLte: 220,
  deadline: '2026-09-22T13:33:00.000Z',
}

const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'x-ratelimit-limit': '200', 'x-ratelimit-remaining': '199', ...headers },
})

function recordedFetch(fixture = structuredClone(recorded), intercept = null) {
  return vi.fn(async (input, init) => {
    const url = new URL(input)
    expect(url.searchParams.has('apiKey')).toBe(false)
    expect(init.headers['APCA-API-KEY-ID']).toBe('fixture-key')
    expect(init.headers['APCA-API-SECRET-KEY']).toBe('fixture-secret')
    const intercepted = await intercept?.(url)
    if (intercepted) return intercepted
    if (url.pathname === '/v2/stocks/snapshots') return response(fixture.stock)
    if (url.pathname === '/v2/options/contracts') return response(fixture.contracts[url.searchParams.get('page_token') ? 1 : 0])
    if (url.pathname === '/v1beta1/options/snapshots/NVDA') return response(fixture.snapshots[url.searchParams.get('page_token') ? 1 : 0])
    throw new Error(`Unexpected fixture request: ${url.pathname}`)
  })
}

function adapter(fetchImpl, overrides = {}) {
  return createAlpacaOptionsAdapter({
    apiKeyId: 'fixture-key',
    apiSecretKey: 'fixture-secret',
    dataBaseUrl: 'https://data.alpaca.test',
    tradingBaseUrl: 'https://paper.alpaca.test',
    fetchImpl,
    now: () => now,
    pause: vi.fn(),
    ...overrides,
  })
}

describe('Alpaca free options-data adapter', () => {
  it('fetches every metadata and chain page and normalizes calls, puts and synchronized IEX stock data', async () => {
    const fetchImpl = recordedFetch()
    const result = await adapter(fetchImpl).optionChain(request)

    expect(result).toMatchObject({
      schemaVersion: 'alpaca-option-chain-observation-v1',
      provider: 'alpaca',
      feed: 'indicative',
      entitlement: 'basic-free',
      complete: true,
      pricingReady: true,
      pageCounts: { metadata: 2, snapshots: 2 },
      requestCount: 5,
    })
    expect(result.underlying).toMatchObject({
      ticker: 'NVDA',
      feed: ALPACA_FEEDS.stock,
      pricingReady: true,
      quote: { bid: 201.4, ask: 201.6, marketAt: '2026-09-22T13:32:05.123456789Z' },
      trade: { price: 201.5, marketAt: '2026-09-22T13:32:04.987654321Z' },
    })
    expect(result.underlying.quote.marketAt).not.toBe(result.underlying.trade.marketAt)
    expect(result.underlying.quote.fetchedAt).toBe(now)
    expect(result.contracts).toHaveLength(2)

    const call = result.contracts.find((item) => item.type === 'call')
    expect(call).toMatchObject({
      contractId: 'osi:NVDA261016C00200000',
      rawId: 'provider-call-id',
      rootSymbol: 'NVDA',
      strikePrice: 200,
      expirationDate: '2026-10-16',
      multiplier: 100,
      pennyProgram: true,
      quote: { bid: 8.3, ask: 8.5, bidSize: 5, askSize: 10, semantics: ALPACA_FEEDS.optionQuote },
      trade: { price: 8.4, size: 2, semantics: ALPACA_FEEDS.optionTrade },
      openInterest: { value: 120, asOfDate: '2026-09-21', semantics: 'prior_session_close_inventory' },
      volume: { value: 150, session: 'rth', sessionDate: '2026-09-22' },
      analytics: { impliedVolatility: 0.54, units: ALPACA_ANALYTICS_UNITS, marketAt: null, age: 'unknown', localRecalibrationSupported: true },
    })
    expect(call.quote.marketAt).not.toBe(call.trade.marketAt)
    expect(call.missing).toEqual(expect.arrayContaining([
      { path: 'quote.publicAt', reason: 'provider_does_not_supply_public_at' },
      { path: 'analytics.marketAt', reason: 'provider_does_not_timestamp_analytics' },
      { path: 'fmv', reason: 'feed_does_not_supply_fmv' },
    ]))

    const put = result.contracts.find((item) => item.type === 'put')
    expect(put.openInterest).toEqual({ value: null, asOfDate: null, semantics: 'prior_session_close_inventory' })
    expect(put.analytics.impliedVolatility).toBeNull()
    expect(put.analytics.greeks.delta).toBeNull()
    expect(put.missing).toEqual(expect.arrayContaining([
      { path: 'trade', reason: 'provider_field_absent' },
      { path: 'openInterest.value', reason: 'provider_field_absent' },
      { path: 'analytics.impliedVolatility', reason: 'provider_analytics_unavailable' },
    ]))
    expect(result.rejected).toEqual([])

    const urls = fetchImpl.mock.calls.map(([input]) => new URL(input))
    expect(urls.filter((url) => url.pathname === '/v2/options/contracts').map((url) => url.searchParams.get('page_token'))).toEqual([null, 'metadata-page-2'])
    expect(urls.filter((url) => url.pathname.includes('/v1beta1/options/snapshots')).map((url) => url.searchParams.get('page_token'))).toEqual([null, 'snapshot-page-2'])
    expect(urls.every((url) => ['data.alpaca.test', 'paper.alpaca.test'].includes(url.host))).toBe(true)
  })

  it('marks the underlying stale without substituting the trade, bar or fetch time for its quote time', async () => {
    const fixture = structuredClone(recorded)
    fixture.stock.NVDA.latestQuote.t = '2026-09-22T13:30:00.000000000Z'
    const result = await adapter(recordedFetch(fixture)).optionChain(request)
    expect(result.complete).toBe(true)
    expect(result.pricingReady).toBe(false)
    expect(result.underlying.quoteFresh).toBe(false)
    expect(result.underlying.quote.marketAt).toBe('2026-09-22T13:30:00.000000000Z')
    expect(result.underlying.missing).toContainEqual({ path: 'quote.freshness', reason: 'stale_underlying_quote' })
  })

  it('marks a chain incomplete when the page budget prevents full pagination', async () => {
    const result = await adapter(recordedFetch(), { maxPages: 1 }).optionChain(request)
    expect(result.complete).toBe(false)
    expect(result.pricingReady).toBe(false)
    expect(result.pageCounts).toEqual({ metadata: 1, snapshots: 0 })
    expect(result.failures).toEqual(expect.arrayContaining([
      { code: 'page_budget', status: null, retryable: true },
      { code: 'contract_metadata_incomplete', status: null, retryable: false },
    ]))
  })

  it('does not retry missing entitlement or continue into chain snapshots', async () => {
    const pause = vi.fn()
    const fetchImpl = recordedFetch(structuredClone(recorded), (url) => url.pathname === '/v2/options/contracts' ? response({}, 403) : null)
    const result = await adapter(fetchImpl, { pause }).optionChain(request)
    expect(result.complete).toBe(false)
    expect(result.failures).toContainEqual({ code: 'missing_entitlement', status: 403, retryable: false })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(pause).not.toHaveBeenCalled()
  })

  it('retries a transient throttle within the deadline and records bounded request use', async () => {
    let throttled = false
    const pause = vi.fn()
    const fetchImpl = recordedFetch(structuredClone(recorded), (url) => {
      if (url.pathname === '/v2/options/contracts' && !throttled) {
        throttled = true
        return response({}, 429, { 'retry-after': '1' })
      }
      return null
    })
    const result = await adapter(fetchImpl, { pause }).optionChain(request)
    expect(result.complete).toBe(true)
    expect(result.requestCount).toBe(6)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(pause).toHaveBeenCalledWith(1000)
  })

  it('does not sleep past a stage deadline after a quota response', async () => {
    const pause = vi.fn()
    const fetchImpl = recordedFetch(structuredClone(recorded), (url) => url.pathname === '/v2/options/contracts' ? response({}, 429, { 'retry-after': '60' }) : null)
    const result = await adapter(fetchImpl, { pause, maxRetryDelayMs: 60000 }).optionChain({ ...request, deadline: '2026-09-22T13:32:15.000Z' })
    expect(result.complete).toBe(false)
    expect(result.failures).toContainEqual({ code: 'rate_limited', status: 429, retryable: true })
    expect(pause).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('fails closed on malformed market fields and unsafe pagination', async () => {
    const malformed = structuredClone(recorded)
    malformed.snapshots[0].snapshots.NVDA261016C00200000.latestQuote.t = Number('1790083921123456789')
    const malformedResult = await adapter(recordedFetch(malformed)).optionChain(request)
    expect(malformedResult.complete).toBe(false)
    expect(malformedResult.contracts).toEqual([])
    expect(malformedResult.failures).toContainEqual({ code: 'corrupt_payload', status: null, retryable: false })

    const unsafe = structuredClone(recorded)
    unsafe.contracts[0].next_page_token = 'https://evil.example/steal'
    const unsafeResult = await adapter(recordedFetch(unsafe)).optionChain(request)
    expect(unsafeResult.complete).toBe(false)
    expect(unsafeResult.failures).toContainEqual({ code: 'corrupt_pagination', status: null, retryable: false })
  })

  it('returns explicit missing rows when a requested underlying snapshot is absent', async () => {
    const result = await adapter(vi.fn(async () => response({}))).underlyingSnapshots([security], { deadline: request.deadline })
    expect(result).toMatchObject({ complete: false, pricingReady: false, observations: [], missing: [{ ticker: 'NVDA', reason: 'provider_snapshot_absent' }] })
  })

  it('fetches and normalizes fully paginated adjusted daily bars for point-in-time features', async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(input)
      expect(url.pathname).toBe('/v2/stocks/bars')
      expect(url.searchParams.get('adjustment')).toBe('all')
      return response({
        bars: { NVDA: [{ t: '2026-09-18T04:00:00Z', o: 198, h: 202, l: 197, c: 201, v: 123456 }] },
        next_page_token: url.searchParams.get('page_token') ? null : 'bars-page-2',
        ...(url.searchParams.get('page_token') ? { bars: { NVDA: [{ t: '2026-09-21T04:00:00Z', o: 201, h: 204, l: 200, c: 203, v: 234567 }] } } : {}),
      })
    })
    const result = await adapter(fetchImpl).stockBars([security], { start: '2026-09-18', end: '2026-09-21', deadline: request.deadline })
    expect(result).toMatchObject({ complete: true, pages: 2, requestCount: 2, missing: [] })
    expect(result.observations).toHaveLength(2)
    expect(result.observations[1]).toMatchObject({
      securityId: security.securityId, ticker: 'NVDA', date: '2026-09-21', close: 203,
      availableAt: now, source: ALPACA_FEATURE_SOURCE,
    })
  })

  it('rejects credential-bearing or path-bearing base URLs before any request', () => {
    expect(() => adapter(vi.fn(), { dataBaseUrl: 'https://user:secret@data.alpaca.test' })).toThrow('HTTPS origin')
    expect(() => adapter(vi.fn(), { tradingBaseUrl: 'https://paper.alpaca.test/v2' })).toThrow('HTTPS origin')
  })
})
