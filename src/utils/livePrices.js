import { parseNum } from './portfolioStats.js'

const FX_SYMBOL = 'USDCAD=X'

function compactNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : ''
}

function compactPct(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : ''
}

function symbolKey(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

/**
 * Which currency a row's stored figures are already in.
 *
 * ACCOUNT CURRENCY when the import recorded one. When it did not, guessing is
 * dangerous in one specific direction: book value and market value must end up
 * in the same currency or the reported P&L is the exchange rate rather than a
 * return. Assuming "unknown means CAD" did exactly that to a connected US
 * holding — its market value was converted, its cost basis was not, and a
 * position bought at a loss reported a 37% profit.
 *
 * The import stored a price beside the book value, in the same currency, so the
 * question can be answered from evidence instead of assumption: compare that
 * price against the quote, and against the quote converted. Prices move, so a
 * hypothesis only wins if it lands close; otherwise this says nothing and the
 * caller leaves the row in whatever currency it arrived in.
 */
const CURRENCY_MATCH_TOLERANCE = 0.15

export function inferRowCurrency(row, quote, usdCadRate) {
  const stated = symbolKey(row['ACCOUNT CURRENCY'])
  if (stated) return stated

  const quoted = symbolKey(quote?.currency)
  const stored = parseNum(row['MARKET PRICE'])
  if (!usdCadRate || quoted !== 'USD' || !(stored > 0) || !(quote?.price > 0)) return ''

  const asQuoted = Math.abs(stored / quote.price - 1)
  const asConverted = Math.abs(stored / (quote.price * usdCadRate) - 1)
  if (Math.min(asQuoted, asConverted) > CURRENCY_MATCH_TOLERANCE) return ''

  return asConverted < asQuoted ? 'CAD' : quoted
}

/**
 * Canadian Depositary Receipts trade in CAD on Cboe Canada, and this one flag
 * decides three separate things: which ticker to quote, whether to convert
 * currency, and whether a quote is plausible at all.
 *
 * It used to be only a regex over the description, which holds for a broker
 * statement ("BROADCOM INC CDR C$HDG") but not for a connected brokerage,
 * where the description is whatever the institution happens to call the
 * security. Miss it and the quote resolves to the US listing — NVDA at ~$180
 * USD against a CDR worth ~$48 CAD — and is then multiplied by the exchange
 * rate on top, because a missed CDR also looks like a US holding sitting in a
 * Canadian account.
 *
 * The import now settles this from structured data wherever it has any, and
 * says so on the row. The description check stays for statements, which carry
 * no such data.
 */
export const CDR_KEY = '__isCdr'

/**
 * When this row last took a live quote.
 *
 * A row that cannot be priced keeps the value it arrived with, which is the
 * right behaviour — blanking a holding is worse than showing an old number.
 * But it then rendered identically to one priced seconds ago: same weight,
 * same colour, same figures, nothing saying the number was days old. The
 * refresh banner named the missing symbols, and it is one dismissible line at
 * the top of a scrolling page.
 *
 * Staleness is judged against the other rows rather than against the clock, so
 * a portfolio that has never been priced at all — every row still at its
 * statement value — marks nothing. What is worth surfacing is a row the last
 * refresh left behind while its neighbours moved on.
 */
export const PRICED_AT_KEY = '__pricedAt'

const asTime = (value) => {
  const ms = Date.parse(String(value ?? ''))
  return Number.isFinite(ms) ? ms : null
}

/** The most recent moment any row here was successfully priced. */
export function lastPricedAt(rows = []) {
  return rows.reduce((newest, row) => {
    const ms = asTime(row?.[PRICED_AT_KEY])
    return ms !== null && (newest === null || ms > newest) ? ms : newest
  }, null)
}

/**
 * Rows priced within this of the freshest one count as current. A refresh walks
 * its rows over a few seconds, so exact equality would mark half a portfolio.
 */
const SAME_REFRESH_MS = 5 * 60 * 1000

/** True when the newest refresh moved on without this row. */
export function isPriceStale(row, newest) {
  if (newest === null) return false
  const ms = asTime(row?.[PRICED_AT_KEY])
  if (ms === null) return true
  return newest - ms > SAME_REFRESH_MS
}

function isCdr(row) {
  if (typeof row?.[CDR_KEY] === 'boolean') return row[CDR_KEY]
  return /\bCDR\b/i.test(String(row.DESCRIPTION ?? ''))
}

function hasExchangeSuffix(symbol) {
  return String(symbol ?? '').includes('.')
}

export function getQuoteSymbolsForRow(row) {
  const symbol = String(row.SYMBOL ?? '').trim()
  if (!symbol) return []

  if (isCdr(row) && !hasExchangeSuffix(symbol)) {
    // CDRs always trade in CAD on the NEO exchange.
    // Don't gate on ACCOUNT CURRENCY — it may not be reliably extracted from the broker CSV.
    // Don't add the base symbol as fallback: CDR tickers (e.g. ORAC) often don't exist on
    // US markets (Oracle is ORCL), so requesting them just produces a spurious "not found".
    return [`${symbol}.NE`]
  }

  return [symbol]
}

// TSX-listed securities are reported by the broker without an exchange suffix,
// and Yahoo does not resolve them from the bare ticker: asking for "HSU" returns
// a 200 with a NasdaqGS stub carrying a null currency and zero candles at every
// range, rather than an error. Nothing downstream distinguished that from a real
// quote, so those holdings were priced at nothing — dropped from the chart and
// frozen at their CSV values in the table. It hits Canadian leveraged ETFs
// hardest (the BetaPro/Global X 2x products are TSX-only), which is where it was
// first noticed. Verified 2026-08-31: HSU/HXU/HQD/HNU all return 0 candles bare
// and 220-251 candles with .TO.
//
// Kept as a *fallback* rather than a second primary: plenty of tickers are valid
// on both exchanges, and the bare form is the right answer whenever it resolves.
// Only rows the first pass could not price pay for the retry.
export function getFallbackQuoteSymbolsForRow(row) {
  const symbol = String(row.SYMBOL ?? '').trim()
  if (!symbol || isCdr(row) || hasExchangeSuffix(symbol)) return []
  return [`${symbol.toUpperCase()}.TO`]
}

/** Inverse of the .TO the fallback resolver appends. */
function stripTsxSuffix(symbol) {
  return symbol.endsWith('.TO') ? symbol.slice(0, -'.TO'.length) : symbol
}

/**
 * How far a quote may sit from the price the row was imported with.
 *
 * The backstop for matching the wrong listing, whatever the cause. A
 * depositary receipt against its underlying is typically several times out —
 * NVDA's CDR trades near a quarter of the US share — so a gap this size is far
 * more likely to be the wrong security than a real move. Rejecting keeps the
 * imported value, which is visibly stale rather than confidently wrong.
 *
 * Deliberately generous: a genuine tripling between refreshes is possible, and
 * freezing one row is the cheaper mistake.
 */
const MAX_QUOTE_DRIFT = 3

function isSafeQuoteForRow(row, quote) {
  const quoteCurrency = symbolKey(quote.currency)

  // CDRs are always CAD-denominated regardless of what ACCOUNT CURRENCY says.
  if (isCdr(row) && quoteCurrency && quoteCurrency !== 'CAD') return false

  // A quote wildly out of line with what this row arrived holding is more
  // likely a different security than a real move. Only meaningful against a
  // price the row actually came with; without one there is nothing to compare
  // and the quote is taken, which is the old behaviour.
  const stored = parseNum(row['MARKET PRICE'])
  if (stored > 0 && quote.price > 0) {
    const drift = Math.max(stored / quote.price, quote.price / stored)
    if (drift > MAX_QUOTE_DRIFT) return false
  }

  return true
}

export function collectSymbols(rows) {
  return [...new Set(
    rows
      .flatMap(getQuoteSymbolsForRow)
      .filter(Boolean),
  )]
}

export async function fetchLivePrices(symbols, { cachedOnly = false } = {}) {
  // Always include the USD/CAD FX rate so we can convert USD prices in CAD accounts.
  const uniqueSymbols = [...new Set(
    [...symbols, FX_SYMBOL].map((s) => String(s).trim()).filter(Boolean),
  )]
  if (uniqueSymbols.length === 0) return { quotes: [], missing: [], usdCadRate: null }

  const res = await fetch('/api/live-prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols: uniqueSymbols, cachedOnly }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || `Quote service error ${res.status}`)
  }

  const allQuotes = Array.isArray(data.quotes) ? data.quotes : []

  // Extract the FX rate and filter it out of the stock quotes.
  const fxQuote = allQuotes.find(
    (q) => symbolKey(q.symbol) === FX_SYMBOL || symbolKey(q.requestedSymbol) === FX_SYMBOL,
  )
  const usdCadRate = fxQuote && fxQuote.cacheStatus !== 'stale' && Number.isFinite(fxQuote.price) && fxQuote.price > 0 ? fxQuote.price : null
  const quotes = allQuotes.filter(
    (q) => symbolKey(q.symbol) !== FX_SYMBOL && symbolKey(q.requestedSymbol) !== FX_SYMBOL,
  )
  const missing = (Array.isArray(data.missing) ? data.missing : [])
    .filter((s) => symbolKey(s) !== FX_SYMBOL)

  return {
    quotes,
    missing,
    errors: Array.isArray(data.errors) ? data.errors : [],
    cache: data.cache ?? null,
    usdCadRate,
  }
}

export function applyLivePrices(rows, quotes, usdCadRate = null) {
  const quoteMap = new Map()
  quotes.forEach((quote) => {
    quoteMap.set(symbolKey(quote.symbol), quote)
    if (quote.requestedSymbol) quoteMap.set(symbolKey(quote.requestedSymbol), quote)
  })
  let updatedRows = 0

  const nextRows = rows.map((row) => {
    // First *usable* quote, not merely the first one that exists. Yahoo returns
    // a stub with no price for an unresolvable ticker, and picking that stub
    // shadowed the .TO quote that actually had the price.
    const quote = [...getQuoteSymbolsForRow(row), ...getFallbackQuoteSymbolsForRow(row)]
      .map((symbol) => quoteMap.get(symbolKey(symbol)))
      .find((candidate) => candidate && Number.isFinite(candidate.price))
    const quantity = parseNum(row.QUANTITY)

    if (!quote || !Number.isFinite(quote.price) || quantity <= 0 || !isSafeQuoteForRow(row, quote)) {
      return row
    }

    // Convert USD price → CAD for non-CDR stocks held in a CAD-denominated account.
    // Book values are in the account's base currency, so the live USD price has
    // to be converted to keep market value and P&L on one scale.
    //
    // Inferred rather than assumed when the import recorded no currency. This
    // briefly treated unknown as CAD, which converted the market value of a
    // connected US holding while its cost basis stayed in dollars — a loss then
    // read as a profit by the width of the exchange rate.
    const accountCurrency = inferRowCurrency(row, quote, usdCadRate)
    const needsConversion = (
      !isCdr(row)
      && symbolKey(quote.currency) === 'USD'
      && accountCurrency === 'CAD'
      && usdCadRate !== null
    )
    const fxRate = needsConversion ? usdCadRate : 1

    updatedRows += 1
    const effectivePrice = quote.price * fxRate
    const marketValue = effectivePrice * quantity
    const bookValue = parseNum(row['BOOK VALUE'])

    const previousCloseValue = Number.isFinite(quote.previousClose)
      ? quote.previousClose * fxRate * quantity
      : null
    let dayChange = previousCloseValue !== null
      ? marketValue - previousCloseValue
      : null
    let dayChangePct = dayChange !== null && previousCloseValue > 0
      ? (dayChange / previousCloseValue) * 100
      : null
    // Some providers return per-share change without previousClose — without
    // this fallback those rows render an empty day change.
    if (dayChange === null && Number.isFinite(quote.change)) {
      dayChange = quote.change * fxRate * quantity
    }
    if (dayChangePct === null && Number.isFinite(quote.changePercent)) {
      dayChangePct = quote.changePercent
    }
    const unrealized = bookValue > 0 ? marketValue - bookValue : null
    const unrealizedPct = bookValue > 0 ? (unrealized / bookValue) * 100 : null

    return {
      ...row,
      [PRICED_AT_KEY]: new Date().toISOString(),
      // Never backfilled from the quote. ACCOUNT CURRENCY is what the holding
      // is *denominated* in; quote.currency is what the security *trades* in.
      // Writing the second into the first made a US stock in a Canadian account
      // claim to be a US account, which switched the conversion above off for
      // every refresh after the first.
      'ACCOUNT CURRENCY': row['ACCOUNT CURRENCY'] || '',
      'MARKET PRICE': compactNumber(effectivePrice),
      'MARKET VALUE': compactNumber(marketValue),
      'DAY CHANGE': dayChange === null ? '' : compactNumber(dayChange),
      'DAY CHANGE %': dayChangePct === null ? '' : compactPct(dayChangePct),
      'UNREALIZED GAIN/LOSS': unrealized === null ? row['UNREALIZED GAIN/LOSS'] : compactNumber(unrealized),
      'UNREALIZED GAIN/LOSS %': unrealizedPct === null ? row['UNREALIZED GAIN/LOSS %'] : compactPct(unrealizedPct),
    }
  })

  return { rows: nextRows, updatedRows }
}

/** True when this row found a usable quote among the ones already fetched. */
function rowIsPriced(row, quoteMap) {
  return [...getQuoteSymbolsForRow(row), ...getFallbackQuoteSymbolsForRow(row)]
    .some((symbol) => quoteMap.has(symbolKey(symbol)))
}

export async function enrichRowsWithLivePrices(rows, { cachedOnly = false } = {}) {
  const symbols = collectSymbols(rows)
  const first = await fetchLivePrices(symbols, { cachedOnly })

  let quotes = first.quotes
  let missing = first.missing
  const errors = [...(first.errors || [])]

  // Second pass, only for rows the primary symbol could not price. Retrying
  // every symbol on .TO would double the quote load to rescue a handful of
  // Canadian listings, so the retry is scoped to what actually failed.
  // Only a quote carrying a usable price counts as priced. Yahoo answers an
  // unknown ticker with a stub object rather than an error, and treating that
  // as a hit would suppress the retry that rescues the symbol.
  const priced = new Map(quotes
    .filter((quote) => Number.isFinite(quote.price))
    .flatMap((quote) => [
      [symbolKey(quote.symbol), quote],
      ...(quote.requestedSymbol ? [[symbolKey(quote.requestedSymbol), quote]] : []),
    ]))
  const retrySymbols = [...new Set(
    rows
      .filter((row) => parseNum(row.QUANTITY) > 0 && !rowIsPriced(row, priced))
      .flatMap(getFallbackQuoteSymbolsForRow),
  )]

  if (retrySymbols.length > 0) {
    try {
      const second = await fetchLivePrices(retrySymbols, { cachedOnly })
      quotes = [...quotes, ...second.quotes]
      errors.push(...(second.errors || []))
      // A symbol rescued on .TO is no longer missing, and must stop being
      // reported as "not found by market providers" in the refresh banner.
      const rescued = new Set(second.quotes.flatMap((quote) => [
        stripTsxSuffix(symbolKey(quote.symbol)),
        stripTsxSuffix(symbolKey(quote.requestedSymbol || '')),
      ]))
      missing = missing.filter((symbol) => !rescued.has(symbolKey(symbol)))
    } catch {
      // The primary pass already succeeded; a failed retry must not lose it.
    }
  }

  const result = applyLivePrices(rows, quotes, first.usdCadRate)

  return {
    ...result,
    quotes,
    missing,
    errors,
    cache: first.cache,
  }
}
