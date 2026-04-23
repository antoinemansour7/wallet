/**
 * Shared utilities for portfolio computation.
 * Extracted so they can be tested without mounting the full component.
 */

export function parseNum(val) {
  if (val === null || val === undefined || val === '') return 0
  return parseFloat(String(val).replace(/[,$%\s]/g, '')) || 0
}

export function fmtCurrency(val) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parseNum(val))
}

export function fmtPct(val) {
  const n = parseNum(val)
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

export function fmtNumber(val) {
  const n = parseNum(val)
  return n % 1 === 0 ? n.toLocaleString() : n.toFixed(2)
}

export function pnlColor(val) {
  const n = parseNum(val)
  if (n > 0) return 'text-gain'
  if (n < 0) return 'text-loss'
  return 'text-text-muted'
}

export function computeStats(rows, { cashValue = 0, realizedPnl = 0 } = {}) {
  const positionMarketValue = rows.reduce((s, r) => s + parseNum(r['MARKET VALUE']), 0)
  const totalBookValue      = rows.reduce((s, r) => s + parseNum(r['BOOK VALUE']), 0)
  const totalUnrealized     = rows.reduce((s, r) => s + parseNum(r['UNREALIZED GAIN/LOSS']), 0)
  const totalDayChange      = rows.reduce((s, r) => s + parseNum(r['DAY CHANGE']), 0)
  const totalCashValue      = parseNum(cashValue)
  const totalRealized       = parseNum(realizedPnl)
  const totalMarketValue    = positionMarketValue + totalCashValue
  const totalPnl            = totalUnrealized + totalRealized
  const unrealizedPct       = totalBookValue > 0 ? (totalUnrealized / totalBookValue) * 100 : 0
  const totalPnlPct         = totalBookValue > 0 ? (totalPnl / totalBookValue) * 100 : 0
  const prevMarketValue     = totalMarketValue - totalDayChange
  const dayChangePct        = prevMarketValue > 0 ? (totalDayChange / prevMarketValue) * 100 : 0
  return {
    positionMarketValue,
    totalMarketValue,
    totalBookValue,
    totalCashValue,
    totalRealized,
    totalUnrealized,
    totalPnl,
    totalPnlPct,
    unrealizedPct,
    totalDayChange,
    dayChangePct,
  }
}

export function groupByAccount(rows) {
  const map = {}
  for (const row of rows) {
    const acct = row['ACCOUNT NUMBER'] || 'Unknown'
    if (!map[acct]) map[acct] = []
    map[acct].push(row)
  }
  return Object.entries(map)
}
