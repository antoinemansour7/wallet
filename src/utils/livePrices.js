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

function getQuoteSymbolsForRow(row) {
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

export async function fetchLivePrices(symbols) {
  // Always include the USD/CAD FX rate so we can convert USD prices in CAD accounts.
  const uniqueSymbols = [...new Set(
    [...symbols, FX_SYMBOL].map((s) => String(s).trim()).filter(Boolean),
  )]
  if (uniqueSymbols.length === 0) return { quotes: [], missing: [], usdCadRate: null }

  const res = await fetch('/api/live-prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols: uniqueSymbols }),
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
    const quote = getQuoteSymbolsForRow(row)
      .map((symbol) => quoteMap.get(symbolKey(symbol)))
      .find(Boolean)
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
    const dayChange = previousCloseValue !== null
      ? marketValue - previousCloseValue
      : null
    const dayChangePct = dayChange !== null && previousCloseValue > 0
      ? (dayChange / previousCloseValue) * 100
      : null
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

export async function enrichRowsWithLivePrices(rows) {
  const symbols = collectSymbols(rows)
  const { quotes, missing, errors, cache, usdCadRate } = await fetchLivePrices(symbols)
  const result = applyLivePrices(rows, quotes, usdCadRate)

  return {
    ...result,
    quotes,
    missing,
    errors,
    cache,
  }
}
