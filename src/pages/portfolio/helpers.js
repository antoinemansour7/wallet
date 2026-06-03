import { fmtCurrency, fmtPct, fmtNumber, pnlColor, parseNum } from '../../utils/portfolioStats'

export function renderCell(type, val) {
  switch (type) {
    case 'currency': return { text: fmtCurrency(val), cls: 'text-white/60' }
    case 'pnl':      return { text: fmtCurrency(val), cls: pnlColor(val) }
    case 'pct':      return { text: fmtPct(val),      cls: pnlColor(val) }
    case 'number':   return { text: fmtNumber(val),   cls: 'text-white/60' }
    case 'symbol':   return { text: val ?? '—',       cls: 'text-white font-bold' }
    case 'desc':     return { text: val ?? '—',       cls: 'text-white/40' }
    default:         return { text: val ?? '—',       cls: 'text-white/60' }
  }
}

export function pct(value, total) {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (value / total) * 100))
}

export function barWidth(value, max) {
  if (value <= 0 || max <= 0) return '0%'
  return `${Math.max(4, pct(value, max))}%`
}

export function getTopPositions(rows, limit = 6) {
  return aggregatePositionsBySymbol(rows)
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

export function aggregatePositionsBySymbol(rows) {
  const bySymbol = new Map()

  for (const row of rows) {
    const symbol = String(row.SYMBOL || 'Unknown').trim().toUpperCase() || 'Unknown'
    const existing = bySymbol.get(symbol)
    const value = parseNum(row['MARKET VALUE'])
    const pnl = parseNum(row['UNREALIZED GAIN/LOSS'])
    const dayChange = parseNum(row['DAY CHANGE'])
    const previousValue = value - dayChange

    if (existing) {
      existing.value += value
      existing.pnl += pnl
      existing.dayChange += dayChange
      existing.previousValue += previousValue
      if (!existing.description && row.DESCRIPTION) existing.description = row.DESCRIPTION
    } else {
      bySymbol.set(symbol, {
        index: bySymbol.size,
        symbol,
        description: row.DESCRIPTION || '',
        value,
        pnl,
        dayChange,
        previousValue,
      })
    }
  }

  return Array.from(bySymbol.values()).map((item) => ({
    ...item,
    dayChangePct: item.previousValue > 0 ? (item.dayChange / item.previousValue) * 100 : 0,
  }))
}

export function getAccountBreakdown(accounts) {
  const CHART_COLORS = ['#1c1c1c', '#3f3f46', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8']
  const CHART_GRADIENTS = [
    ['#1c1c1c', '#3f3f46'],
    ['#3f3f46', '#52525b'],
    ['#52525b', '#71717a'],
    ['#71717a', '#a1a1aa'],
    ['#a1a1aa', '#d4d4d8'],
    ['#1c1c1c', '#52525b'],
  ]
  return accounts
    .map((account, index) => ({
      account: account.accountNumber,
      positions: account.positions.length,
      cash: account.cash,
      cashSource: account.cashSource,
      value: account.stats.totalMarketValue,
      color: CHART_COLORS[index % CHART_COLORS.length],
      gradient: CHART_GRADIENTS[index % CHART_GRADIENTS.length],
    }))
    .filter((item) => item.value > 0 || item.cash !== 0)
}

export function getPnlBuckets(rows) {
  const buckets = [
    { id: 'gainers', label: 'Gainers', count: 0, value: 0, gradient: ['#0d9488', '#0f766e'] },
    { id: 'losers',  label: 'Losers',  count: 0, value: 0, gradient: ['#ef4444', '#dc2626'] },
    { id: 'flat',    label: 'Flat',    count: 0, value: 0, gradient: ['#a1a1aa', '#71717a'] },
  ]
  for (const row of rows) {
    const p = parseNum(row['UNREALIZED GAIN/LOSS'])
    if (p > 0)      { buckets[0].count += 1; buckets[0].value += p }
    else if (p < 0) { buckets[1].count += 1; buckets[1].value += Math.abs(p) }
    else            { buckets[2].count += 1 }
  }
  return buckets
}
