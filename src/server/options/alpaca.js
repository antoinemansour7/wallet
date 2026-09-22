import { digest } from '../research/archive.js'
import { createContractEnumeration } from './contracts.js'

export const ALPACA_ADAPTER_VERSION = 'alpaca-options-adapter-v1'
export const ALPACA_FEEDS = Object.freeze({
  stock: Object.freeze({ name: 'iex', kind: 'real_time', venueCoverage: 'iex_only' }),
  optionQuote: Object.freeze({ name: 'indicative', kind: 'indicative', treatment: 'modified_quote' }),
  optionTrade: Object.freeze({ name: 'indicative', kind: 'delayed', delayMinutes: 15, treatment: 'derived_trade' }),
})
export const ALPACA_ANALYTICS_UNITS = Object.freeze({
  impliedVolatility: 'annualized_decimal_fraction',
  delta: 'option_usd_per_underlying_usd',
  gamma: 'delta_per_underlying_usd',
  theta: 'option_usd_per_calendar_day',
  vega: 'option_usd_per_volatility_percentage_point',
  rho: 'option_usd_per_interest_rate_percentage_point',
})

const symbolPattern = /^[A-Z][A-Z0-9.-]{0,14}$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
const pageTokenPattern = /^[A-Za-z0-9._~+/=-]{1,2048}$/

export class AlpacaOptionsDataError extends Error {
  constructor(code, { status = null, retryable = false } = {}) {
    super(`Alpaca options data request failed: ${code}`)
    this.name = 'AlpacaOptionsDataError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !timestampPattern.test(value)) return false
  return Number.isFinite(Date.parse(value.replace(/(\.\d{3})\d+/, '$1')))
}

function requiredTimestamp(value) {
  if (!validTimestamp(value)) throw new AlpacaOptionsDataError('corrupt_payload')
  return value
}

function number(value, _path, { integer = false, nonnegative = false, nullable = false, numericString = false } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null
    throw new AlpacaOptionsDataError('corrupt_payload')
  }
  if (typeof value !== 'number' && !(numericString && typeof value === 'string' && value.trim())) {
    throw new AlpacaOptionsDataError('corrupt_payload')
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || (nonnegative && parsed < 0)) {
    throw new AlpacaOptionsDataError('corrupt_payload')
  }
  return parsed
}

function optionalNumber(value, path) {
  return value === null || value === undefined ? null : number(value, path)
}

function ageMs(marketAt, fetchedAt) {
  return Math.max(0, Date.parse(fetchedAt.replace(/(\.\d{3})\d+/, '$1')) - Date.parse(marketAt.replace(/(\.\d{3})\d+/, '$1')))
}

function missingValue(missing, path, reason = 'provider_field_absent') {
  missing.push({ path, reason })
  return null
}

function normalizeQuote(raw, path, fetchedAt, semantics, missing) {
  if (!raw) return missingValue(missing, path)
  const marketAt = requiredTimestamp(raw.t, `${path}.marketAt`)
  const publicAt = missingValue(missing, `${path}.publicAt`, 'provider_does_not_supply_public_at')
  return {
    bid: number(raw.bp, `${path}.bid`),
    ask: number(raw.ap, `${path}.ask`),
    bidSize: number(raw.bs, `${path}.bidSize`, { integer: true, nonnegative: true }),
    askSize: number(raw.as, `${path}.askSize`, { integer: true, nonnegative: true }),
    bidExchange: raw.bx || null,
    askExchange: raw.ax || null,
    conditions: Array.isArray(raw.c) ? raw.c : raw.c == null ? [] : [raw.c],
    marketAt,
    publicAt,
    availableAt: fetchedAt,
    fetchedAt,
    ageMs: ageMs(marketAt, fetchedAt),
    semantics,
  }
}

function normalizeTrade(raw, path, fetchedAt, semantics, missing) {
  if (!raw) return missingValue(missing, path)
  const marketAt = requiredTimestamp(raw.t, `${path}.marketAt`)
  const publicAt = missingValue(missing, `${path}.publicAt`, 'provider_does_not_supply_public_at')
  return {
    price: number(raw.p, `${path}.price`),
    size: number(raw.s, `${path}.size`, { integer: true, nonnegative: true }),
    exchange: raw.x || null,
    conditions: Array.isArray(raw.c) ? raw.c : raw.c == null ? [] : [raw.c],
    providerTradeId: raw.i == null ? null : String(raw.i),
    marketAt,
    publicAt,
    availableAt: fetchedAt,
    fetchedAt,
    ageMs: ageMs(marketAt, fetchedAt),
    semantics,
  }
}

function normalizeBar(raw, path, fetchedAt, missing, session) {
  if (!raw) return missingValue(missing, path)
  const marketAt = requiredTimestamp(raw.t, `${path}.marketAt`)
  return {
    open: number(raw.o, `${path}.open`),
    high: number(raw.h, `${path}.high`),
    low: number(raw.l, `${path}.low`),
    close: number(raw.c, `${path}.close`),
    volume: number(raw.v, `${path}.volume`, { integer: true, nonnegative: true }),
    tradeCount: number(raw.n, `${path}.tradeCount`, { integer: true, nonnegative: true }),
    vwap: optionalNumber(raw.vw, `${path}.vwap`),
    marketAt,
    sessionDate: marketAt.slice(0, 10),
    session,
    availableAt: fetchedAt,
    fetchedAt,
  }
}

function normalizeUnderlying(security, raw, fetchedAt, maxAgeMs) {
  const missing = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AlpacaOptionsDataError('missing_underlying')
  const quote = normalizeQuote(raw.latestQuote, 'quote', fetchedAt, ALPACA_FEEDS.stock, missing)
  const trade = normalizeTrade(raw.latestTrade, 'trade', fetchedAt, ALPACA_FEEDS.stock, missing)
  const minuteBar = normalizeBar(raw.minuteBar, 'minuteBar', fetchedAt, missing, 'iex_minute')
  const dailyBar = normalizeBar(raw.dailyBar, 'dailyBar', fetchedAt, missing, 'iex_trading_day')
  const previousDailyBar = normalizeBar(raw.prevDailyBar, 'previousDailyBar', fetchedAt, missing, 'iex_previous_trading_day')
  const quoteFresh = Boolean(quote) && quote.ageMs <= maxAgeMs
  if (quote && !quoteFresh) missing.push({ path: 'quote.freshness', reason: 'stale_underlying_quote' })
  return {
    schemaVersion: 'alpaca-underlying-observation-v1',
    adapterVersion: ALPACA_ADAPTER_VERSION,
    provider: 'alpaca',
    feed: ALPACA_FEEDS.stock,
    entitlement: 'basic-free',
    securityId: security.securityId,
    issuerId: security.issuerId,
    ticker: security.ticker,
    quote,
    trade,
    minuteBar,
    dailyBar,
    previousDailyBar,
    fetchedAt,
    quoteFresh,
    pricingReady: quoteFresh,
    missing,
    rawReferenceHash: digest(raw),
  }
}

function normalizeAnalytics(raw, path, missing) {
  const iv = raw?.impliedVolatility
  const impliedVolatility = iv == null
    ? missingValue(missing, `${path}.impliedVolatility`, 'provider_analytics_unavailable')
    : number(iv, `${path}.impliedVolatility`, { nonnegative: true })
  const providerGreeks = raw?.greeks
  const greeks = {}
  for (const name of ['delta', 'gamma', 'theta', 'vega', 'rho']) {
    greeks[name] = providerGreeks?.[name] == null
      ? missingValue(missing, `${path}.greeks.${name}`, 'provider_analytics_unavailable')
      : number(providerGreeks[name], `${path}.greeks.${name}`)
  }
  missingValue(missing, `${path}.marketAt`, 'provider_does_not_timestamp_analytics')
  return {
    model: 'alpaca_black_scholes',
    impliedVolatility,
    greeks,
    units: ALPACA_ANALYTICS_UNITS,
    marketAt: null,
    age: 'unknown',
    localRecalibrationSupported: true,
  }
}

function normalizeOpenInterest(raw, path, missing) {
  const value = raw.open_interest
  const date = raw.open_interest_date
  if (value == null && date == null) {
    missingValue(missing, `${path}.value`, 'provider_field_absent')
    missingValue(missing, `${path}.asOfDate`, 'provider_field_absent')
    return { value: null, asOfDate: null, semantics: 'prior_session_close_inventory' }
  }
  if (value == null || !datePattern.test(date || '')) throw new AlpacaOptionsDataError('corrupt_payload')
  return {
    value: number(value, `${path}.value`, { integer: true, nonnegative: true, numericString: true }),
    asOfDate: date,
    semantics: 'prior_session_close_inventory',
  }
}

function normalizeContractObservation(contract, rawMetadata, snapshotEntry) {
  const missing = []
  const snapshot = snapshotEntry?.raw || null
  const fetchedAt = snapshotEntry?.fetchedAt || rawMetadata.fetchedAt
  if (!snapshot) missing.push({ path: 'snapshot', reason: 'provider_snapshot_absent' })
  const quote = normalizeQuote(snapshot?.latestQuote, 'quote', fetchedAt, ALPACA_FEEDS.optionQuote, missing)
  const trade = normalizeTrade(snapshot?.latestTrade, 'trade', fetchedAt, ALPACA_FEEDS.optionTrade, missing)
  const dailyBar = normalizeBar(snapshot?.dailyBar, 'dailyBar', fetchedAt, missing, 'rth')
  const minuteBar = normalizeBar(snapshot?.minuteBar, 'minuteBar', fetchedAt, missing, 'rth_minute')
  const previousDailyBar = normalizeBar(snapshot?.prevDailyBar, 'previousDailyBar', fetchedAt, missing, 'previous_rth')
  const analytics = normalizeAnalytics(snapshot, 'analytics', missing)
  missingValue(missing, 'fmv', 'feed_does_not_supply_fmv')
  return {
    ...contract,
    rawId: rawMetadata.raw.id,
    openInterest: normalizeOpenInterest(rawMetadata.raw, 'openInterest', missing),
    volume: {
      value: dailyBar?.volume ?? null,
      session: dailyBar?.session ?? 'rth',
      sessionDate: dailyBar?.sessionDate ?? null,
    },
    quote,
    trade,
    dailyBar,
    minuteBar,
    previousDailyBar,
    analytics,
    fmv: null,
    fetchedAt,
    missing,
    rawReferenceHash: digest({ metadata: rawMetadata.raw, snapshot }),
  }
}

function safeFailure(error) {
  return {
    code: error instanceof AlpacaOptionsDataError ? error.code : 'provider_unavailable',
    status: Number.isInteger(error?.status) ? error.status : null,
    retryable: error?.retryable === true,
  }
}

function skippedPages(code) {
  return { complete: false, entries: new Map(), pages: 0, nextPageToken: null, failure: { code, status: null, retryable: false } }
}

function endpoint(value, fallback, name) {
  const url = new URL(value || fallback)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`${name} must be an HTTPS origin`)
  }
  return url
}

function normalizedSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase()
  if (!symbolPattern.test(symbol)) throw new Error('Invalid Alpaca underlying symbol')
  return symbol
}

function validDate(value) {
  if (!datePattern.test(value || '')) return false
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

function pageToken(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !pageTokenPattern.test(value)) throw new AlpacaOptionsDataError('corrupt_pagination')
  return value
}

function retryDelay(response, attempt, currentTime, maximum) {
  const header = response?.headers?.get?.('retry-after')
  const seconds = header == null ? NaN : Number(header)
  const target = Number.isFinite(seconds) ? currentTime + seconds * 1000 : Date.parse(header)
  const requested = Number.isFinite(target) ? Math.max(0, target - currentTime) : 250 * (2 ** attempt)
  return Math.min(maximum, requested)
}

export function createAlpacaOptionsAdapter({
  apiKeyId = process.env.ALPACA_API_KEY_ID,
  apiSecretKey = process.env.ALPACA_API_SECRET_KEY,
  dataBaseUrl = process.env.ALPACA_DATA_BASE_URL,
  tradingBaseUrl = process.env.ALPACA_TRADING_BASE_URL,
  fetchImpl = fetch,
  now = () => Date.now(),
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxPages = 25,
  maxRequests = 50,
  maxAttempts = 3,
  requestTimeoutMs = 20000,
  maxRetryDelayMs = 5000,
  underlyingMaxAgeMs = 10000,
} = {}) {
  if (!apiKeyId || !apiSecretKey) throw new Error('Alpaca data credentials are required')
  if (![maxPages, maxRequests, maxAttempts, requestTimeoutMs].every((value) => Number.isInteger(value) && value > 0)) throw new Error('Invalid Alpaca request limits')
  const dataBase = endpoint(dataBaseUrl, 'https://data.alpaca.markets', 'Alpaca data endpoint')
  const tradingBase = endpoint(tradingBaseUrl, 'https://paper-api.alpaca.markets', 'Alpaca trading endpoint')
  const headers = { Accept: 'application/json', 'APCA-API-KEY-ID': apiKeyId, 'APCA-API-SECRET-KEY': apiSecretKey }

  const clock = () => {
    const value = new Date(now()).getTime()
    if (!Number.isFinite(value)) throw new Error('Alpaca adapter clock is invalid')
    return value
  }
  const context = (deadline) => ({
    deadline: deadline == null ? clock() + 45000 : new Date(deadline).getTime(),
    used: 0,
    diagnostics: [],
  })

  function requestUrl(base, path, params) {
    const url = new URL(path, base)
    const allowed = base.origin === dataBase.origin
      ? /^\/v2\/stocks\/snapshots$/.test(path) || /^\/v1beta1\/options\/snapshots\/[A-Z][A-Z0-9.-]{0,14}$/.test(path)
      : base.origin === tradingBase.origin && path === '/v2/options/contracts'
    if (!allowed || url.origin !== base.origin || url.pathname !== path) throw new Error('Untrusted Alpaca request path')
    for (const [key, value] of Object.entries(params || {})) if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value))
    return url
  }

  async function requestJson(run, base, path, params) {
    const url = requestUrl(base, path, params)
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const startedAt = clock()
      if (!Number.isFinite(run.deadline) || startedAt >= run.deadline) throw new AlpacaOptionsDataError('stage_deadline', { retryable: true })
      if (run.used >= maxRequests) throw new AlpacaOptionsDataError('request_budget', { retryable: true })
      run.used += 1
      let response
      try {
        response = await fetchImpl(url, {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, run.deadline - startedAt))),
        })
      } catch {
        if (attempt + 1 >= maxAttempts) throw new AlpacaOptionsDataError('provider_unavailable', { retryable: true })
        const delay = Math.min(maxRetryDelayMs, 250 * (2 ** attempt))
        if (clock() + delay >= run.deadline) throw new AlpacaOptionsDataError('stage_deadline', { retryable: true })
        await pause(delay)
        continue
      }
      run.diagnostics.push({
        path,
        status: response.status,
        rateLimit: response.headers?.get?.('x-ratelimit-limit') || null,
        rateRemaining: response.headers?.get?.('x-ratelimit-remaining') || null,
      })
      if (response.status === 401) throw new AlpacaOptionsDataError('authentication', { status: 401 })
      if (response.status === 403) throw new AlpacaOptionsDataError('missing_entitlement', { status: 403 })
      if (response.status === 429 || response.status >= 500) {
        const code = response.status === 429 ? 'rate_limited' : 'provider_unavailable'
        const delay = retryDelay(response, attempt, clock(), maxRetryDelayMs)
        if (attempt + 1 >= maxAttempts || clock() + delay >= run.deadline) throw new AlpacaOptionsDataError(code, { status: response.status, retryable: true })
        await pause(delay)
        continue
      }
      if (!response.ok) throw new AlpacaOptionsDataError('request_rejected', { status: response.status })
      let payload
      try { payload = await response.json() } catch { throw new AlpacaOptionsDataError('corrupt_payload') }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AlpacaOptionsDataError('corrupt_payload')
      return { payload, fetchedAt: new Date(clock()).toISOString() }
    }
    throw new AlpacaOptionsDataError('provider_unavailable', { retryable: true })
  }

  async function collectPages(run, { base, path, params, dataKey, mapping = false, identityKey = null }) {
    const entries = mapping ? new Map() : []
    const seenTokens = new Set()
    const seenItems = new Set()
    let token = null
    let pages = 0
    try {
      do {
        if (pages >= maxPages) throw new AlpacaOptionsDataError('page_budget', { retryable: true })
        const response = await requestJson(run, base, path, { ...params, page_token: token })
        if (Object.hasOwn(response.payload, 'next_url')) throw new AlpacaOptionsDataError('corrupt_pagination')
        const data = response.payload[dataKey]
        if (mapping) {
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AlpacaOptionsDataError('corrupt_payload')
          for (const [key, raw] of Object.entries(data)) {
            if (entries.has(key)) throw new AlpacaOptionsDataError('duplicate_page_item')
            entries.set(key, { raw, fetchedAt: response.fetchedAt })
          }
        } else {
          if (!Array.isArray(data)) throw new AlpacaOptionsDataError('corrupt_payload')
          for (const raw of data) {
            const identity = identityKey?.(raw)
            if (identity && seenItems.has(identity)) throw new AlpacaOptionsDataError('duplicate_page_item')
            if (identity) seenItems.add(identity)
            entries.push({ raw, fetchedAt: response.fetchedAt })
          }
        }
        pages += 1
        token = pageToken(response.payload.next_page_token)
        if (token && seenTokens.has(token)) throw new AlpacaOptionsDataError('pagination_cycle')
        if (token) seenTokens.add(token)
      } while (token)
      return { complete: true, entries, pages, nextPageToken: null, failure: null }
    } catch (error) {
      return { complete: false, entries, pages, nextPageToken: token, failure: safeFailure(error) }
    }
  }

  async function underlyingSnapshots(securities, { deadline, run: suppliedRun } = {}) {
    const run = suppliedRun || context(deadline)
    const requested = securities.map((security) => ({ ...security, ticker: normalizedSymbol(security.ticker) }))
    if (!requested.length || requested.length > 100) throw new Error('Alpaca stock snapshot request requires 1-100 securities')
    try {
      const response = await requestJson(run, dataBase, '/v2/stocks/snapshots', { symbols: requested.map((security) => security.ticker).join(','), feed: ALPACA_FEEDS.stock.name })
      if (Object.hasOwn(response.payload, 'next_page_token') || Object.hasOwn(response.payload, 'next_url')) throw new AlpacaOptionsDataError('corrupt_pagination')
      const observations = [], missing = []
      for (const security of requested) {
        const raw = response.payload[security.ticker]
        if (!raw) { missing.push({ ticker: security.ticker, reason: 'provider_snapshot_absent' }); continue }
        observations.push(normalizeUnderlying(security, raw, response.fetchedAt, underlyingMaxAgeMs))
      }
      return {
        schemaVersion: 'alpaca-underlying-batch-v1',
        adapterVersion: ALPACA_ADAPTER_VERSION,
        complete: missing.length === 0,
        pricingReady: missing.length === 0 && observations.every((item) => item.pricingReady),
        observations,
        missing,
        failure: null,
        requestCount: run.used,
        diagnostics: run.diagnostics,
      }
    } catch (error) {
      return {
        schemaVersion: 'alpaca-underlying-batch-v1', adapterVersion: ALPACA_ADAPTER_VERSION,
        complete: false, pricingReady: false, observations: [], missing: requested.map(({ ticker }) => ({ ticker, reason: safeFailure(error).code })),
        failure: safeFailure(error), requestCount: run.used, diagnostics: run.diagnostics,
      }
    }
  }

  async function optionChain({ security, expirationDateGte, expirationDateLte, strikePriceGte, strikePriceLte, type, rootSymbol, deadline } = {}) {
    if (!security?.securityId || !security?.issuerId) throw new Error('A resolved options security is required')
    const ticker = normalizedSymbol(security.ticker)
    if (!validDate(expirationDateGte) || !validDate(expirationDateLte) || expirationDateGte > expirationDateLte) {
      throw new Error('A bounded option expiration range is required')
    }
    if (type && !['call', 'put'].includes(type)) throw new Error('Option type must be call or put')
    if (rootSymbol && !/^[A-Z0-9.-]{1,6}$/.test(rootSymbol)) throw new Error('Invalid option root symbol')
    if (strikePriceGte != null && (!Number.isFinite(Number(strikePriceGte)) || Number(strikePriceGte) < 0)) throw new Error('Invalid minimum strike')
    if (strikePriceLte != null && (!Number.isFinite(Number(strikePriceLte)) || Number(strikePriceLte) < 0)) throw new Error('Invalid maximum strike')
    if (strikePriceGte != null && strikePriceLte != null && Number(strikePriceGte) > Number(strikePriceLte)) throw new Error('Invalid strike range')
    const run = context(deadline)
    const underlying = await underlyingSnapshots([{ ...security, ticker }], { run })
    const filters = {
      expiration_date_gte: expirationDateGte,
      expiration_date_lte: expirationDateLte,
      strike_price_gte: strikePriceGte,
      strike_price_lte: strikePriceLte,
      type,
      root_symbol: rootSymbol,
    }
    const metadata = underlying.failure ? { ...skippedPages('underlying_unavailable'), entries: [] } : await collectPages(run, {
      base: tradingBase,
      path: '/v2/options/contracts',
      params: { underlying_symbols: ticker, status: 'active', limit: 10000, ...filters },
      dataKey: 'option_contracts',
      identityKey: (raw) => raw?.id || raw?.symbol,
    })
    const snapshots = !metadata.complete ? skippedPages('contract_metadata_incomplete') : await collectPages(run, {
      base: dataBase,
      path: `/v1beta1/options/snapshots/${ticker}`,
      params: { feed: ALPACA_FEEDS.optionQuote.name, limit: 1000, ...filters },
      dataKey: 'snapshots',
      mapping: true,
    })

    let enumeration = null
    const rejected = []
    const contracts = []
    let normalizationFailure = null
    try {
      const enumeratedAt = metadata.entries[0]?.fetchedAt || new Date(clock()).toISOString()
      enumeration = createContractEnumeration({
        security: { ...security, ticker },
        rawContracts: metadata.entries.map((entry) => entry.raw),
        enumeratedAt,
        provider: 'alpaca-basic-indicative',
        complete: metadata.complete,
        nextPageToken: metadata.nextPageToken,
        requestedExpirationRange: { from: expirationDateGte, through: expirationDateLte },
      })
      rejected.push(...enumeration.rejected.map((entry) => ({ ...entry, source: 'contract_metadata' })))
      const rawById = new Map(metadata.entries.map((entry) => [entry.raw.id, entry]))
      for (const contract of enumeration.contracts) {
        const rawMetadata = rawById.get(contract.providerContractId)
        contracts.push(normalizeContractObservation(contract, rawMetadata, snapshots.entries.get(contract.osiSymbol)))
      }
      for (const symbol of snapshots.entries.keys()) {
        if (!enumeration.contracts.some((contract) => contract.osiSymbol === symbol)) rejected.push({ symbol, reasons: ['snapshot_without_accepted_metadata'], source: 'snapshot' })
      }
    } catch (error) {
      normalizationFailure = safeFailure(error)
    }

    const complete = underlying.complete && metadata.complete && snapshots.complete && !normalizationFailure
    return {
      schemaVersion: 'alpaca-option-chain-observation-v1',
      adapterVersion: ALPACA_ADAPTER_VERSION,
      provider: 'alpaca',
      feed: 'indicative',
      entitlement: 'basic-free',
      securityId: security.securityId,
      issuerId: security.issuerId,
      underlyingTicker: ticker,
      filters: { ...filters, expirationDateGte, expirationDateLte },
      complete,
      pricingReady: complete && underlying.pricingReady,
      underlying: underlying.observations[0] || null,
      enumeration,
      contracts,
      rejected,
      failures: [underlying.failure, metadata.failure, snapshots.failure, normalizationFailure].filter(Boolean),
      pageCounts: { metadata: metadata.pages, snapshots: snapshots.pages },
      requestCount: run.used,
      diagnostics: run.diagnostics,
      fetchedAt: new Date(clock()).toISOString(),
    }
  }

  return { underlyingSnapshots, optionChain }
}
