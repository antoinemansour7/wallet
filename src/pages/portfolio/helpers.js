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

/**
 * Largest holding first — what every broker does, because position size is the
 * first thing anyone looks for. The file order the broker happened to export in
 * carries no meaning.
 *
 * Ties break on symbol so the order is stable: without it, two equal-valued
 * positions could swap places on any re-render, and a live price refresh runs
 * every five minutes.
 */
export function sortPositionsByValue(rows) {
  return [...rows].sort((a, b) => {
    const diff = parseNum(b['MARKET VALUE']) - parseNum(a['MARKET VALUE'])
    if (diff !== 0) return diff
    return String(a.SYMBOL ?? '').localeCompare(String(b.SYMBOL ?? ''))
  })
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
  // Fixed order, never cycled past its length — a seventh account repeats a
  // hue rather than inventing one, which is the documented behaviour.
  const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)',
    'var(--series-4)', 'var(--series-5)', 'var(--series-6)']
  return accounts
    .map((account, index) => ({
      account: account.accountNumber,
      positions: account.positions.length,
      cash: account.cash,
      cashSource: account.cashSource,
      value: account.stats.totalMarketValue,
      color: SERIES[index % SERIES.length],
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

// Ranked by size, so the ramp is sequential rather than categorical — a
// rainbow here would claim the slices are unrelated identities when what the
// bar actually shows is one book cut from largest to smallest.
const TAPE_COLORS = [
  'var(--tape-1)', 'var(--tape-2)', 'var(--tape-3)', 'var(--tape-4)',
  'var(--tape-5)', 'var(--tape-6)', 'var(--tape-7)',
]

/**
 * The whole book as one ordered strip: the `limit` largest holdings, then
 * everything else folded into a single "Rest" segment. Tail positions are each
 * a sliver too thin to label, and a dozen 0.4% shards is not a picture of
 * anything.
 */
export function getCompositionSegments(rows, limit = 7) {
  const all = aggregatePositionsBySymbol(rows)
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)

  const total = all.reduce((sum, item) => sum + item.value, 0)
  const shown = all.slice(0, limit)
  const rest = all.slice(limit)

  const segments = shown.map((item, index) => ({
    ...item,
    share: pct(item.value, total),
    color: TAPE_COLORS[Math.min(index, TAPE_COLORS.length - 1)],
  }))

  if (rest.length > 0) {
    const value = rest.reduce((sum, item) => sum + item.value, 0)
    segments.push({
      index: -1,
      symbol: 'Rest',
      description: `${rest.length} smaller holding${rest.length === 1 ? '' : 's'}`,
      count: rest.length,
      value,
      pnl: rest.reduce((sum, item) => sum + item.pnl, 0),
      share: pct(value, total),
      color: 'var(--tape-rest)',
      isRest: true,
    })
  }

  return { segments, total, holdingCount: all.length }
}
