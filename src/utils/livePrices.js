import { parseNum } from './portfolioStats'

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

function isCdr(row) {
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

function isSafeQuoteForRow(row, quote) {
  const quoteCurrency = symbolKey(quote.currency)

  // CDRs are always CAD-denominated regardless of what ACCOUNT CURRENCY says.
  if (isCdr(row)) {
    return !quoteCurrency || quoteCurrency === 'CAD'
  }

  // For regular stocks, always apply live prices. The account currency field
  // from the broker CSV may not accurately reflect the security's denomination
  // (e.g., USD stocks reported under a CAD-denominated account umbrella).
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
  const usdCadRate = fxQuote && Number.isFinite(fxQuote.price) ? fxQuote.price : null
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
    // The broker CSV book values are in the account's base currency (CAD), so we must
    // convert the live USD price to CAD to keep market value and P&L consistent.
    const accountCurrency = symbolKey(row['ACCOUNT CURRENCY'])
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
      'ACCOUNT CURRENCY': row['ACCOUNT CURRENCY'] || quote.currency || '',
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
