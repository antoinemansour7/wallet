// ─── Portfolio value history reconstructed from holdings ──────────────────────
// Broker-style charts don't wait for daily snapshots: they value the current
// holdings against each symbol's historical closes. This builds
// Σ(quantity × close) per day across all positions, with USD→CAD conversion
// per-day where the account is CAD-denominated.

import { Redis } from '@upstash/redis'

const MAX_POSITIONS = 30
const FETCH_CONCURRENCY = 4
const CACHE_TTL = 30 * 60 // 30 minutes

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

async function fetchDailyCloses(symbol, days = 365) {
  const period2 = Math.floor(Date.now() / 1000)
  const period1 = period2 - days * 24 * 60 * 60
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null

  const data = await res.json()
  const result = data?.chart?.result?.[0]
  const closes = result?.indicators?.quote?.[0]?.close
  const timestamps = result?.timestamp
  if (!closes || !timestamps) return null

  const closesByDate = {}
  for (let i = 0; i < timestamps.length; i++) {
    if (Number.isFinite(closes[i])) {
      closesByDate[new Date(timestamps[i] * 1000).toISOString().slice(0, 10)] = closes[i]
    }
  }

  return { currency: result.meta?.currency || '', closesByDate }
}

async function fetchIntradayCloses(symbol) {
  // 5-minute bars for the current session — enough resolution for a 1D line
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null

  const data = await res.json()
  const result = data?.chart?.result?.[0]
  const closes = result?.indicators?.quote?.[0]?.close
  const timestamps = result?.timestamp
  if (!closes || !timestamps) return null

  const closesByTs = {}
  for (let i = 0; i < timestamps.length; i++) {
    if (Number.isFinite(closes[i])) closesByTs[timestamps[i]] = closes[i]
  }

  return { currency: result.meta?.currency || '', closesByTs }
}

/**
 * Pure intraday builder — same carry-forward logic as the daily version but
 * keyed by unix-second timestamps. Returns points keyed by ms (what the chart
 * expects from intraday data).
 */
export function buildIntradaySeries(positionSeries, fxByTs = {}, cashValue = 0) {
  const allTs = new Set()
  for (const pos of positionSeries) {
    for (const ts of Object.keys(pos.closesByTs || {})) allTs.add(Number(ts))
  }
  const tss = [...allTs].sort((a, b) => a - b)
  if (tss.length === 0) return []

  const fxTss = Object.keys(fxByTs).map(Number).sort((a, b) => a - b)
  let fxCarry = fxTss.length > 0 ? fxByTs[fxTss[0]] : 1
  let fxIdx = 0

  const carries = positionSeries.map((pos) => {
    const first = Object.keys(pos.closesByTs || {}).map(Number).sort((a, b) => a - b)[0]
    return first != null ? pos.closesByTs[first] : null
  })

  const series = []
  for (const ts of tss) {
    while (fxIdx < fxTss.length && fxTss[fxIdx] <= ts) { fxCarry = fxByTs[fxTss[fxIdx]]; fxIdx++ }

    let total = cashValue
    for (let i = 0; i < positionSeries.length; i++) {
      const pos = positionSeries[i]
      const close = pos.closesByTs?.[ts]
      if (Number.isFinite(close)) carries[i] = close
      if (!Number.isFinite(carries[i])) continue

      const needsFx = pos.currency === 'USD' && String(pos.accountCurrency || '').toUpperCase() === 'CAD'
      total += pos.quantity * carries[i] * (needsFx ? fxCarry : 1)
    }

    series.push({ ts: ts * 1000, marketValue: Number(total.toFixed(2)) })
  }

  return series
}

/**
 * Pure series builder. positionSeries entries:
 *   { quantity, currency, accountCurrency, closesByDate: {date: close} }
 * fxByDate: USDCAD close per date. Missing days are carried forward (and the
 * leading gap backfilled from the first known close) so holidays and newer
 * listings don't punch holes in the line.
 */
export function buildPortfolioSeries(positionSeries, fxByDate = {}, cashValue = 0) {
  const allDates = new Set()
  for (const pos of positionSeries) {
    for (const date of Object.keys(pos.closesByDate || {})) allDates.add(date)
  }
  const dates = [...allDates].sort()
  if (dates.length === 0) return []

  const fxDates = Object.keys(fxByDate).sort()
  let fxCarry = fxDates.length > 0 ? fxByDate[fxDates[0]] : 1

  const carries = positionSeries.map((pos) => {
    const firstDate = Object.keys(pos.closesByDate || {}).sort()[0]
    return firstDate != null ? pos.closesByDate[firstDate] : null
  })

  const series = []
  for (const date of dates) {
    if (Number.isFinite(fxByDate[date])) fxCarry = fxByDate[date]

    let total = cashValue
    for (let i = 0; i < positionSeries.length; i++) {
      const pos = positionSeries[i]
      const close = pos.closesByDate?.[date]
      if (Number.isFinite(close)) carries[i] = close
      if (!Number.isFinite(carries[i])) continue

      const needsFx = pos.currency === 'USD' && String(pos.accountCurrency || '').toUpperCase() === 'CAD'
      total += pos.quantity * carries[i] * (needsFx ? fxCarry : 1)
    }

    series.push({ date, marketValue: Number(total.toFixed(2)) })
  }

  return series
}

/**
 * Fetch candles for all positions (+ USDCAD for conversion) and build the
 * daily portfolio value series. Cached in Redis since candle history barely
 * changes intraday.
 */
export async function getPortfolioSeries({ positions = [], cashValue = 0, days = 365 } = {}) {
  const valid = positions
    .filter((p) => p.symbol && Number.isFinite(Number(p.quantity)) && Number(p.quantity) > 0)
    .slice(0, MAX_POSITIONS)
  if (valid.length === 0) return []

  const cacheKey = `portfolio-series:${days}:${valid.map((p) => `${p.symbol}x${p.quantity}`).sort().join(',')}:${Math.round(cashValue)}`
  const redis = getRedis()
  if (redis) {
    try {
      const cached = await redis.get(cacheKey)
      if (Array.isArray(cached) && cached.length > 0) return cached
    } catch { /* cache miss */ }
  }

  const queue = [...valid]
  const results = []
  async function worker() {
    while (queue.length > 0) {
      const pos = queue.shift()
      try {
        const candles = await fetchDailyCloses(pos.symbol, days)
        if (candles) {
          results.push({
            quantity: Number(pos.quantity),
            currency: candles.currency,
            accountCurrency: pos.accountCurrency || '',
            closesByDate: candles.closesByDate,
          })
        }
      } catch (err) {
        console.error(`[portfolioSeries] candles failed for ${pos.symbol}:`, err.message)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, valid.length) }, () => worker()))

  let fxByDate = {}
  const needsFx = results.some((r) => r.currency === 'USD' && String(r.accountCurrency).toUpperCase() === 'CAD')
  if (needsFx) {
    try {
      const fx = await fetchDailyCloses('USDCAD=X', days)
      fxByDate = fx?.closesByDate || {}
    } catch { /* fall back to carry of 1 */ }
  }

  const series = buildPortfolioSeries(results, fxByDate, cashValue)

  if (redis && series.length > 0) {
    try { await redis.set(cacheKey, series, { ex: CACHE_TTL }) } catch { /* non-critical */ }
  }

  return series
}

/**
 * Reconstruct today's intraday portfolio value from each holding's 5-minute
 * bars — so the 1D chart is complete from market open without the browser
 * needing to have been open. Short cache TTL since it moves during the day.
 */
export async function getIntradaySeries({ positions = [], cashValue = 0 } = {}) {
  const valid = positions
    .filter((p) => p.symbol && Number.isFinite(Number(p.quantity)) && Number(p.quantity) > 0)
    .slice(0, MAX_POSITIONS)
  if (valid.length === 0) return []

  const cacheKey = `portfolio-intraday:${valid.map((p) => `${p.symbol}x${p.quantity}`).sort().join(',')}:${Math.round(cashValue)}`
  const redis = getRedis()
  if (redis) {
    try {
      const cached = await redis.get(cacheKey)
      if (Array.isArray(cached) && cached.length > 0) return cached
    } catch { /* cache miss */ }
  }

  const queue = [...valid]
  const results = []
  async function worker() {
    while (queue.length > 0) {
      const pos = queue.shift()
      try {
        const candles = await fetchIntradayCloses(pos.symbol)
        if (candles) {
          results.push({
            quantity: Number(pos.quantity),
            currency: candles.currency,
            accountCurrency: pos.accountCurrency || '',
            closesByTs: candles.closesByTs,
          })
        }
      } catch (err) {
        console.error(`[portfolioSeries] intraday candles failed for ${pos.symbol}:`, err.message)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, valid.length) }, () => worker()))

  let fxByTs = {}
  const needsFx = results.some((r) => r.currency === 'USD' && String(r.accountCurrency).toUpperCase() === 'CAD')
  if (needsFx) {
    try {
      const fx = await fetchIntradayCloses('USDCAD=X')
      fxByTs = fx?.closesByTs || {}
    } catch { /* fall back to carry of 1 */ }
  }

  const series = buildIntradaySeries(results, fxByTs, cashValue)

  if (redis && series.length > 0) {
    try { await redis.set(cacheKey, series, { ex: 180 }) } catch { /* non-critical */ }
  }

  return series
}
