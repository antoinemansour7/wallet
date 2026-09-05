import { parseNum } from '../../utils/portfolioStats'

export const currencyOf = (value) => String(value || '').trim().toUpperCase() || 'Unspecified'

// Some statement accounts contain rows in more than one currency. Split by
// each row's declared currency before computing a total or an account bar.
export function analyticsScopes(accounts) {
  const scopes = new Map()
  const get = (currency) => {
    if (!scopes.has(currency)) scopes.set(currency, { currency, rows: [], accounts: [], cash: 0 })
    return scopes.get(currency)
  }
  for (const account of accounts) {
    const byCurrency = new Map()
    for (const row of account.positions || []) {
      const currency = currencyOf(row['ACCOUNT CURRENCY'])
      if (!byCurrency.has(currency)) byCurrency.set(currency, [])
      byCurrency.get(currency).push(row)
    }
    const cashCurrency = currencyOf(account.currency)
    if (parseNum(account.cash) !== 0 || !byCurrency.size) {
      if (!byCurrency.has(cashCurrency)) byCurrency.set(cashCurrency, [])
    }
    for (const [currency, rows] of byCurrency) {
      const scope = get(currency)
      const cash = currency === cashCurrency ? parseNum(account.cash) : 0
      const invested = rows.reduce((sum, row) => sum + parseNum(row['MARKET VALUE']), 0)
      scope.rows.push(...rows)
      scope.cash += cash
      scope.accounts.push({ accountNumber: account.accountNumber, cash, invested, value: invested + cash })
    }
  }
  return [...scopes.values()].sort((a, b) => a.currency === 'Unspecified' ? 1 : b.currency === 'Unspecified' ? -1 : a.currency.localeCompare(b.currency))
}

export function normalizeComparison(series, days) {
  const valid = series.filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.portfolio) && point.portfolio > 0 && Number.isFinite(point.benchmark) && point.benchmark > 0).sort((a, b) => a.date.localeCompare(b.date))
  if (valid.length < 2) return []
  const cutoff = Date.parse(valid.at(-1).date) - days * 86400000
  const visible = valid.filter((point) => Date.parse(point.date) >= cutoff)
  if (visible.length < 2) return []
  const first = visible[0]
  return visible.map((point) => ({ date: point.date, portfolio: (point.portfolio / first.portfolio - 1) * 100, benchmark: (point.benchmark / first.benchmark - 1) * 100 }))
}

export function comparisonTimePosition(points, index) {
  const start = Date.parse(points[0].date)
  const duration = Date.parse(points.at(-1).date) - start
  return duration > 0 ? (Date.parse(points[index].date) - start) / duration : 0
}

export function comparisonHasGap(previous, point) {
  return Boolean(previous && Date.parse(point.date) - Date.parse(previous.date) > 5 * 86400000)
}

export function holdingDrivers(rows, field) {
  const items = new Map()
  let missing = 0
  for (const row of rows) {
    const raw = row[field]
    if (raw === null || raw === undefined || String(raw).trim() === '' || !Number.isFinite(Number(String(raw).replace(/[,$%\s]/g, '')))) { missing++; continue }
    const symbol = String(row.SYMBOL || 'Unknown').toUpperCase()
    if (!items.has(symbol)) items.set(symbol, { symbol, description: row.DESCRIPTION || '', value: 0 })
    items.get(symbol).value += parseNum(raw)
  }
  return { items: [...items.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.symbol.localeCompare(b.symbol)), missing }
}
