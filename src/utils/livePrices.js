import { parseNum } from './portfolioStats'

function compactNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : ''
}

function compactPct(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : ''
}

function symbolKey(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

export function collectSymbols(rows) {
  return [...new Set(
    rows
      .map((row) => String(row.SYMBOL ?? '').trim())
      .filter(Boolean),
  )]
}

export async function fetchLivePrices(symbols) {
  const uniqueSymbols = [...new Set(symbols.map((symbol) => String(symbol).trim()).filter(Boolean))]
  if (uniqueSymbols.length === 0) return { quotes: [], missing: [] }

  const res = await fetch('/api/live-prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols: uniqueSymbols }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || `Quote service error ${res.status}`)
  }

  return {
    quotes: Array.isArray(data.quotes) ? data.quotes : [],
    missing: Array.isArray(data.missing) ? data.missing : [],
    errors: Array.isArray(data.errors) ? data.errors : [],
    cache: data.cache ?? null,
  }
}

export function applyLivePrices(rows, quotes) {
  const quoteMap = new Map(quotes.map((quote) => [symbolKey(quote.symbol), quote]))
  let updatedRows = 0

  const nextRows = rows.map((row) => {
    const quote = quoteMap.get(symbolKey(row.SYMBOL))
    const quantity = parseNum(row.QUANTITY)

    if (!quote || !Number.isFinite(quote.price) || quantity <= 0) {
      return row
    }

    updatedRows += 1
    const marketValue = quote.price * quantity
    const bookValue = parseNum(row['BOOK VALUE'])
    const dayChange = Number.isFinite(quote.change)
      ? quote.change * quantity
      : Number.isFinite(quote.previousClose)
        ? (quote.price - quote.previousClose) * quantity
        : null
    const dayChangePct = Number.isFinite(quote.changePercent)
      ? quote.changePercent
      : Number.isFinite(quote.previousClose) && quote.previousClose > 0
        ? ((quote.price - quote.previousClose) / quote.previousClose) * 100
        : null
    const unrealized = bookValue > 0 ? marketValue - bookValue : null
    const unrealizedPct = bookValue > 0 ? (unrealized / bookValue) * 100 : null

    return {
      ...row,
      'ACCOUNT CURRENCY': row['ACCOUNT CURRENCY'] || quote.currency || '',
      'MARKET PRICE': compactNumber(quote.price),
      'MARKET VALUE': compactNumber(marketValue),
      'DAY CHANGE': dayChange === null ? row['DAY CHANGE'] : compactNumber(dayChange),
      'DAY CHANGE %': dayChangePct === null ? row['DAY CHANGE %'] : compactPct(dayChangePct),
      'UNREALIZED GAIN/LOSS': unrealized === null ? row['UNREALIZED GAIN/LOSS'] : compactNumber(unrealized),
      'UNREALIZED GAIN/LOSS %': unrealizedPct === null ? row['UNREALIZED GAIN/LOSS %'] : compactPct(unrealizedPct),
    }
  })

  return { rows: nextRows, updatedRows }
}

export async function enrichRowsWithLivePrices(rows) {
  const symbols = collectSymbols(rows)
  const { quotes, missing, errors, cache } = await fetchLivePrices(symbols)
  const result = applyLivePrices(rows, quotes)

  return {
    ...result,
    quotes,
    missing,
    errors,
    cache,
  }
}
