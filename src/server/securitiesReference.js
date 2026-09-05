/**
 * Securities reference data: yield, exchange, whether a fund holds foreign
 * equities, and a real identifier for securities Plaid did not supply one
 * for.
 *
 * Design: docs/design/securities-reference-data.md. Replaces two stopgaps in
 * withholdingTax.js (#17/#88): a curated ~35-ticker fund list, and an assumed
 * 1.3% yield for every holding.
 *
 * Every live source here was tested directly against the real endpoint
 * before this was written, not assumed from memory:
 *
 *   · Yield comes from real dividend history via the chart endpoint this app
 *     already calls unauthenticated for prices (`events=div`) — not from
 *     `quoteSummary`'s `dividendYield`, which needs an undocumented
 *     crumb/cookie workaround and came back empty for two ETFs even though
 *     the same field populated for an ordinary dividend-paying stock.
 *   · Exchange and currency come from that same already-fetched chart
 *     response's `meta` object — no new call.
 *   · Fund composition (`topHoldings`) and identifier lookup (OpenFIGI) are
 *     the two genuinely new dependencies here, and each is confirmed live
 *     against a real security before being trusted.
 *
 * Consistent failure direction throughout: every function here returns
 * `null` (or `false`/`[]` where that's the honest empty state) rather than
 * guessing, so a caller that gets nothing back is exactly as safe as before
 * this module existed.
 */

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

// ─── Yield, from real dividend history ─────────────────────────────────────

/** The chart endpoint's dividend events object into a plain, sorted array. */
export function parseDividendEvents(chartResult) {
  const dividends = chartResult?.events?.dividends
  if (!dividends || typeof dividends !== 'object') return []

  return Object.values(dividends)
    .filter((event) => Number.isFinite(event?.date) && Number.isFinite(event?.amount))
    .map((event) => ({ date: event.date, amount: event.amount }))
    .sort((a, b) => a.date - b.date)
}

/**
 * Trailing-12-month yield as a percent, or null when there is nothing to
 * measure. Zero and "unknown" are different facts — a fund that pays no
 * dividend and one this module has no history for both return null here,
 * and the caller (withholdingTax.js, via an injected assumption) decides
 * what a missing yield means for its own purpose.
 */
export function trailingYieldPct(dividends, price, { now = Date.now() } = {}) {
  if (!Number.isFinite(price) || price <= 0) return null
  if (!Array.isArray(dividends) || !dividends.length) return null

  const cutoff = (now - ONE_YEAR_MS) / 1000 // dividend dates are unix seconds
  const trailing = dividends.filter((d) => d.date >= cutoff)
  if (!trailing.length) return null

  const total = trailing.reduce((sum, d) => sum + d.amount, 0)
  return (total / price) * 100
}

// ─── Exchange and currency, from the same chart response ───────────────────

export function exchangeInfoFromChartMeta(meta) {
  return {
    exchange: meta?.exchangeName ?? null,
    exchangeName: meta?.fullExchangeName ?? null,
    currency: meta?.currency ?? null,
  }
}

// ─── Fund composition ───────────────────────────────────────────────────────

/**
 * Pure-Canadian-equity index funds. Kept small and stable on purpose — this
 * is the list that used to be paired with an unbounded "known foreign funds"
 * list in withholdingTax.js. Flipping which side is enumerated is the point:
 * domestic Canadian-equity funds are a small, slow-changing set worth
 * maintaining by hand; foreign exposure is not, so it is derived from
 * whatever a fund's real holdings turn out to be instead.
 */
export const DOMESTIC_EQUITY_FUNDS = new Set([
  'XIC.TO', 'ZCN.TO', 'VCN.TO', 'XIU.TO', 'ZDV.TO', 'XDV.TO', 'CDZ.TO', 'VCE.TO',
])

/**
 * A fund's real top holdings into a foreign-exposure verdict.
 *
 * Confirmed live against XEQT.TO: only one of its five largest holdings
 * (XIC.TO) is a domestic-equity fund; the rest — including a Total US
 * Market fund and an EAFE fund — are foreign. That is a fund this module has
 * never been told about by name, classified correctly from what it actually
 * holds, which is the entire reason this replaces a maintained list rather
 * than extending it.
 */
export function classifyFundComposition(holdings, { domesticFunds = DOMESTIC_EQUITY_FUNDS } = {}) {
  if (!Array.isArray(holdings) || !holdings.length) return null

  const evidence = []
  let foreignPct = 0

  for (const holding of holdings) {
    const symbol = String(holding?.symbol ?? '').trim().toUpperCase()
    if (!symbol) continue
    if (domesticFunds.has(symbol)) continue
    evidence.push(symbol)
    foreignPct += Number(holding.holdingPercent) || 0
  }

  return { holdsForeignEquities: evidence.length > 0, foreignPct, evidence }
}

// ─── Identifier lookup, for statement imports Plaid never touched ─────────

/**
 * Ticker + exchange into a FIGI via OpenFIGI's free, public mapping
 * endpoint. Every failure mode — no mapping, a bad response, a network
 * error — resolves to `null` rather than throwing: a FIGI lookup is
 * best-effort reference data, and every caller treats "couldn't find one"
 * and "didn't ask" identically, by falling back to the symbol key.
 *
 * `fetchImpl` defaults to the global `fetch` and is overridable for tests —
 * matching the pattern in historicalFx.js's `fetchRange`.
 */
export async function fetchFigi(ticker, exchangeCode, { fetchImpl = fetch } = {}) {
  if (!ticker) return null

  try {
    const response = await fetchImpl('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ idType: 'TICKER', idValue: ticker, ...(exchangeCode ? { exchCode: exchangeCode } : {}) }]),
    })

    if (!response.ok) return null

    const body = await response.json()
    const figi = body?.[0]?.data?.[0]?.figi
    return typeof figi === 'string' && figi ? figi : null
  } catch {
    return null
  }
}

// ─── Live chart-based fetches (dividends + exchange meta share one call) ──

/**
 * One call serves both parseDividendEvents and exchangeInfoFromChartMeta —
 * the same endpoint yahooQuotes.js already uses for prices, asked for a
 * year of history with dividend events included.
 */
export async function fetchChartWithDividends(symbol, { fetchImpl = fetch } = {}) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&events=div`
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!response.ok) return null
  const body = await response.json()
  return body?.chart?.result?.[0] ?? null
}

// ─── Fund composition, via the crumb-gated quoteSummary endpoint ──────────

/**
 * Yahoo's public quoteSummary now requires a session cookie plus a crumb
 * token minted against it — undocumented, and confirmed live to be the only
 * way to reach `topHoldings` today. This is the one piece of this module
 * riding on something genuinely fragile: an unofficial handshake Yahoo could
 * change or block without notice. Every caller of `fetchTopHoldings`
 * receives `null` on any failure here, same as an unrecognized fund — this
 * breaking degrades to the stopgap this module replaces, not to an error.
 */
export async function fetchYahooCrumb({ fetchImpl = fetch } = {}) {
  try {
    const cookieResponse = await fetchImpl('https://fc.yahoo.com', { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const setCookie = cookieResponse.headers?.get?.('set-cookie')
    if (!setCookie) return null

    const crumbResponse = await fetchImpl('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': 'Mozilla/5.0', cookie: setCookie },
    })
    if (!crumbResponse.ok) return null

    const crumb = (await crumbResponse.text()).trim()
    return { crumb, cookie: setCookie }
  } catch {
    return null
  }
}

export async function fetchTopHoldings(symbol, { fetchImpl = fetch, session } = {}) {
  const resolvedSession = session ?? await fetchYahooCrumb({ fetchImpl })
  if (!resolvedSession) return null

  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
      + `?modules=topHoldings&crumb=${encodeURIComponent(resolvedSession.crumb)}`
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0', cookie: resolvedSession.cookie } })
    if (!response.ok) return null

    const body = await response.json()
    const holdings = body?.quoteSummary?.result?.[0]?.topHoldings?.holdings
    if (!Array.isArray(holdings)) return null

    return holdings.map((h) => ({ symbol: h.symbol, holdingPercent: h.holdingPercent?.raw ?? null }))
  } catch {
    return null
  }
}
