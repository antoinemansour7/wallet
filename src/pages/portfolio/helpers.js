import { fmtCurrency, fmtPct, fmtNumber, pnlColor, parseNum } from '../../utils/portfolioStats'

export function renderCell(type, val) {
  switch (type) {
    case 'currency': return { text: fmtCurrency(val), cls: 'text-text-secondary' }
    case 'pnl':      return { text: fmtCurrency(val), cls: pnlColor(val) }
    case 'pct':      return { text: fmtPct(val),      cls: pnlColor(val) }
    case 'number':   return { text: fmtNumber(val),   cls: 'text-text-secondary' }
    case 'symbol':   return { text: val ?? '—',       cls: 'text-text-primary font-bold' }
    case 'desc':     return { text: val ?? '—',       cls: 'text-text-muted' }
    default:         return { text: val ?? '—',       cls: 'text-text-secondary' }
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
  return rows
    .map((row, index) => ({
      index,
      symbol:      row.SYMBOL || 'Unknown',
      description: row.DESCRIPTION || '',
      value:       parseNum(row['MARKET VALUE']),
      pnl:         parseNum(row['UNREALIZED GAIN/LOSS']),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
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
