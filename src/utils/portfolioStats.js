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
  if (n > 0) return 'text-emerald-400'
  if (n < 0) return 'text-rose-400'
  return 'text-slate-400'
}

export function computeStats(rows) {
  const totalMarketValue = rows.reduce((s, r) => s + parseNum(r['MARKET VALUE']), 0)
  const totalBookValue   = rows.reduce((s, r) => s + parseNum(r['BOOK VALUE']), 0)
  const totalUnrealized  = rows.reduce((s, r) => s + parseNum(r['UNREALIZED GAIN/LOSS']), 0)
  const totalDayChange   = rows.reduce((s, r) => s + parseNum(r['DAY CHANGE']), 0)
  const unrealizedPct    = totalBookValue  > 0 ? (totalUnrealized / totalBookValue) * 100 : 0
  const prevMarketValue  = totalMarketValue - totalDayChange
  const dayChangePct     = prevMarketValue  > 0 ? (totalDayChange  / prevMarketValue)  * 100 : 0
  return { totalMarketValue, totalBookValue, totalUnrealized, unrealizedPct, totalDayChange, dayChangePct }
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
