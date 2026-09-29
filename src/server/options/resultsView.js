import { optionsLocalParts } from './calendar.js'
import { optionsEntryCost } from './evaluation.js'

// The plain-language results page, derived entirely from the shadow
// evaluation so the two pages can never disagree. Dollars are per contract:
// "paid" is the ask with slippage and the entry fee, and every later value is
// what the contract would sell for at the bid after slippage and the exit fee,
// so a value and its percentage are always the same number.
export const RESULTS_DAYS = Object.freeze([1, 3, 5])
const WIN_DAY = 3

const cents = (value) => Number(value.toFixed(2))
const valueAt = (paidUsd, returnPct) => (Number.isFinite(paidUsd) && Number.isFinite(returnPct) ? cents(paidUsd * (1 + returnPct / 100)) : null)
const localDate = (instant) => (instant ? optionsLocalParts(instant).date : null)

function dayResult(point, paidUsd) {
  if (!point) return { state: 'not_recorded', reason: 'not_scheduled' }
  if (point.status === 'contract_expired_before_endpoint') return { state: 'expired' }
  const date = localDate(point.scheduledAt)
  if (Number.isFinite(point.returnPct)) return { state: 'observed', date, returnPct: point.returnPct, valueUsd: valueAt(paidUsd, point.returnPct) }
  if (point.status === 'unexpired_horizon') return { state: 'pending', date }
  return { state: 'not_recorded', date, reason: point.status }
}

function resultPick(row) {
  const paidUsd = Number.isFinite(row.frozen?.ask) ? cents(optionsEntryCost(row.frozen.ask)) : null
  const tracked = row.status !== 'missing'
  const days = Object.fromEntries(RESULTS_DAYS.map((day) => [day, tracked ? dayResult(row.checkpoints.find((point) => point.key === String(day)), paidUsd) : { state: 'not_tracked' }]))
  const decisive = days[WIN_DAY]
  return {
    id: row.id, contractId: row.contractId, tradingDate: row.tradingDate, rank: row.rank,
    ticker: row.ticker, direction: row.direction, strikePrice: row.strikePrice, expirationDate: row.expirationDate,
    tracked, untrackedReason: tracked ? null : row.reason, expired: row.status === 'expired',
    paidUsd,
    now: tracked && row.current ? { at: row.current.at, returnPct: row.current.returnPct, valueUsd: valueAt(paidUsd, row.current.returnPct) } : null,
    days,
    result: decisive.state === 'observed' ? (decisive.returnPct > 0 ? 'won' : 'lost') : null,
  }
}

function count(picks) {
  return {
    picks: picks.length,
    up: picks.filter((item) => item.now?.returnPct > 0).length,
    down: picks.filter((item) => item.now && item.now.returnPct <= 0).length,
    won: picks.filter((item) => item.result === 'won').length,
    lost: picks.filter((item) => item.result === 'lost').length,
    notTracked: picks.filter((item) => !item.tracked).length,
  }
}

export function optionsResultsView(shadow) {
  const picks = (shadow?.rows || []).map(resultPick)
  const days = [...(shadow?.days || [])].sort((a, b) => b.tradingDate.localeCompare(a.tradingDate)).map((day) => {
    const dayPicks = picks.filter((item) => item.tradingDate === day.tradingDate).sort((a, b) => a.rank - b.rank)
    return {
      tradingDate: day.tradingDate, status: day.status,
      day3Date: dayPicks.map((item) => item.days[WIN_DAY].date).find(Boolean) || null,
      counts: count(dayPicks), picks: dayPicks,
    }
  })
  return { checkedAt: shadow?.checkedAt || null, winDay: WIN_DAY, days }
}
