import { getQuoteSymbolsForRow } from '../../utils/livePrices'

function number(value) {
  if (value == null || String(value).trim() === '') return null
  const parsed = Number(String(value).replace(/[,$%\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}
const completeSum = (values) => values.every((value) => value != null) ? values.reduce((sum, value) => sum + value, 0) : null

export function compositionHoldings(rows) {
  const groups = new Map()
  for (const row of rows) {
    const symbol = String(row.SYMBOL || 'Unknown').trim().toUpperCase()
    const id = (getQuoteSymbolsForRow(row)[0] || symbol).toUpperCase()
    if (!groups.has(id)) groups.set(id, { id, symbol, description: row.DESCRIPTION || '', rows: [] })
    groups.get(id).rows.push(row)
  }
  return [...groups.values()].map((item) => {
    const value = completeSum(item.rows.map((row) => number(row['MARKET VALUE'])))
    const cost = completeSum(item.rows.map((row) => number(row['BOOK VALUE'])))
    const quantity = completeSum(item.rows.map((row) => number(row.QUANTITY)))
    const pnl = completeSum(item.rows.map((row) => {
      const reported = number(row['UNREALIZED GAIN/LOSS'])
      const basis = number(row['BOOK VALUE']), market = number(row['MARKET VALUE'])
      return reported ?? (basis != null && market != null ? market - basis : null)
    }))
    const day = completeSum(item.rows.map((row) => number(row['DAY CHANGE'])))
    const previous = value != null && day != null ? value - day : null
    return {
      ...item, value, cost, quantity, pnl, day,
      pnlPct: pnl != null && cost > 0 ? pnl / cost * 100 : null,
      dayPct: day != null && previous > 0 ? day / previous * 100 : null,
      averageCost: cost != null && quantity > 0 ? cost / quantity : null,
      accounts: [...new Set(item.rows.map((row) => row['ACCOUNT NUMBER']).filter(Boolean))],
    }
  }).filter((item) => item.value > 0).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
}

export function sortComposition(items, field, direction) {
  return [...items].sort((a, b) => {
    if (a[field] == null) return b[field] == null ? a.id.localeCompare(b.id) : 1
    if (b[field] == null) return -1
    const comparison = field === 'symbol' ? a.symbol.localeCompare(b.symbol) : a[field] - b[field]
    return comparison * (direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id)
  })
}
