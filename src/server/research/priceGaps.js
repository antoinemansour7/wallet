// Yahoo occasionally drops a whole trading day for every symbol (2026-09-22:
// open, close and volume all null, SPY included). The evaluator rightly refuses
// to score a window with a missing session, so one provider outage would blank
// every window crossing that day. Days the benchmark itself is missing are
// provider gaps, not halts: those, and only those, are filled from Alpaca's
// consolidated (SIP) daily bars, and every filled bar records its source.
export const GAP_FILL_SOURCE = 'alpaca-sip'
const SESSION_MS = 6.5 * 3600000
const complete = (bar) => Number.isFinite(bar?.open) && bar.open > 0 && Number.isFinite(bar?.close) && bar.close > 0

/** Ended sessions within the lookback where the benchmark's own bar is empty. */
export function marketGapDates(benchmark, now, { lookbackDays = 60 } = {}) {
  const since = new Date(now).getTime() - lookbackDays * 86400000
  return [...new Set((benchmark || []).filter((bar) => bar.date && Number.isFinite(bar.timestamp) && bar.timestamp >= since
    && bar.timestamp + SESSION_MS <= new Date(now).getTime() && !complete(bar)).map((bar) => bar.date))].sort()
}

/** Replaces empty rows on gap dates with the fill, inserting a row a symbol lacks entirely. */
export function applyGapFills(bars, fills, sessionTimestamps) {
  if (!fills?.size) return bars
  const byDate = new Map((bars || []).map((bar) => [bar.date, bar]))
  for (const [date, fill] of fills) {
    const existing = byDate.get(date)
    if (complete(existing)) continue
    byDate.set(date, { ...(existing || { date, timestamp: sessionTimestamps.get(date) }),
      open: fill.open, high: fill.high, close: fill.close, source: GAP_FILL_SOURCE })
  }
  return [...byDate.values()].filter((bar) => Number.isFinite(bar.timestamp)).sort((a, b) => a.timestamp - b.timestamp)
}

export function alpacaSipDailyBars({ fetchImpl = fetch, keyId = process.env.ALPACA_API_KEY_ID, secret = process.env.ALPACA_API_SECRET_KEY } = {}) {
  return async function fetchBars(symbols, start, end) {
    if (!keyId || !secret) throw new Error('alpaca_credentials_unavailable')
    const bars = new Map()
    let token = null, pages = 0
    do {
      const url = new URL('https://data.alpaca.markets/v2/stocks/bars')
      for (const [key, value] of Object.entries({ symbols: symbols.join(','), timeframe: '1Day', start, end, feed: 'sip',
        adjustment: 'split', limit: 10000, page_token: token })) if (value) url.searchParams.set(key, String(value))
      const response = await fetchImpl(url, { headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret }, signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(`alpaca_bars_http_${response.status}`)
      const body = await response.json()
      for (const [symbol, rows] of Object.entries(body.bars || {})) {
        const list = bars.get(symbol) || []
        for (const row of rows || []) list.push({ date: String(row.t).slice(0, 10), open: row.o, high: row.h, close: row.c })
        bars.set(symbol, list)
      }
      token = body.next_page_token || null
    } while (token && ++pages < 20)
    return bars
  }
}

/**
 * Fills market-wide gap dates for any symbol. Symbols announced through
 * prefetch are fetched in batches of up to 100; anything else is fetched
 * alone on first use. A failed fetch leaves bars unfilled, never guessed.
 */
export function createGapFiller({ gapDates = [], benchmark = [], fetchBars, batchSize = 100, log = console.warn } = {}) {
  const sessionTimestamps = new Map((benchmark || []).map((bar) => [bar.date, bar.timestamp]))
  const wanted = new Set(gapDates)
  const fills = new Map()
  const failures = []
  async function load(symbols) {
    const pending = [...new Set(symbols)].filter((symbol) => !fills.has(symbol))
    if (!wanted.size || !pending.length) return
    for (let index = 0; index < pending.length; index += batchSize) {
      const batch = pending.slice(index, index + batchSize)
      const request = fetchBars(batch, gapDates[0], gapDates.at(-1)).then(
        (rows) => rows,
        (error) => {
          failures.push({ symbols: batch.length, error: error.message })
          log(`[price-gaps] fill unavailable for ${batch.length} symbols: ${error.message}`)
          return new Map()
        })
      for (const symbol of batch) {
        fills.set(symbol, request.then((rows) => new Map((rows.get(symbol) || [])
          .filter((row) => wanted.has(row.date) && complete(row)).map((row) => [row.date, row]))))
      }
      await request
    }
  }
  return {
    gapDates, failures,
    prefetch: (symbols) => load(symbols),
    async fill(symbol, bars) {
      if (!wanted.size) return bars
      if (!fills.has(symbol)) await load([symbol])
      return applyGapFills(bars, await fills.get(symbol), sessionTimestamps)
    },
  }
}
