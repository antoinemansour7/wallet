export const number = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : 'Unavailable'
export const money = (value) => Number.isFinite(value) ? `$${value.toFixed(2)}` : 'Unavailable'
export const percent = (value) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}%` : 'Unavailable'
export const iv = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'Unavailable'
export const words = (value) => String(value || 'Unavailable').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
export function timestamp(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Time unavailable'
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(value))
}
export const stateLabel = (state) => ({ theoretical: 'Theoretical · indicative inputs', delayed: 'Delayed', live: 'Live at scan', 'live-at-scan': 'Live at scan', stale: 'Stale', partial: 'Partial', closed: 'Market closed', empty: 'Valid empty', unavailable: 'Unavailable' })[state] || 'Unavailable'
export function lifecycle(data, now) {
  if (!data) return 'unavailable'
  const { summary, morning, session } = data
  if (session && now >= Date.parse(session.closesAt)) return 'closed'
  if (!morning || morning.tradingDate !== summary.tradingDate) return summary.state
  if (morning.validUntil && now > Date.parse(morning.validUntil)) return 'stale'
  return summary.state
}
const ET_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
const MARKET_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
export const clock = (value) => value && Number.isFinite(Date.parse(value)) ? `${ET_CLOCK.format(new Date(value))} ET` : 'time unknown'
export const day = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? MARKET_DAY.format(new Date(`${date}T12:00:00Z`)) : 'date unknown'
export const strike = (value) => Number.isFinite(value) ? `$${Number.isInteger(value) ? value : value.toFixed(2)}` : 'strike unknown'
export const move = (value) => Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%` : 'move unknown'
export const quoteMode = (mode) => ({ theoretical: 'Indicative quotes', delayed: 'Delayed quotes', live: 'Live at scan', 'live-at-scan': 'Live at scan' })[mode] || 'Quote source unknown'

const DRIVERS = {
  underlyingSetup: 'strong setup', technicalConfirmation: 'trend confirms', catalystQuality: 'catalyst', deltaExposure: 'good delta',
  convexity: 'good convexity', thetaEfficiency: 'low decay', ivVega: 'reasonable IV', liquidity: 'liquid', expectedMoveCompatibility: 'target within reach',
}
export function driverText(drivers) {
  const text = (drivers || []).map((item) => DRIVERS[item.component] || words(item.component).toLowerCase()).join(' · ')
  return text ? text[0].toUpperCase() + text.slice(1) : 'No standout drivers'
}
// A deduction taken because an input is missing names the gap, not the
// condition it stands in for: unknown IV history is not "IV is rich".
export function riskLabel(code, reason) {
  const unknown = reason === 'missing_input_uses_existing_worst_case_penalty'
  return ({
    iv_above_90th_percentile: unknown ? 'IV history unknown' : 'IV rich vs. its history',
    event_before_expiry_after_exit: unknown ? 'Event calendar incomplete' : 'Event before expiry',
    wide_spread: 'Wide spread', volume_only_by_prior_session: 'Thin volume today',
    decay_above_horizon_limit: 'Heavy time decay', full_premium_at_risk: 'Full premium at risk',
  })[code] || words(code)
}

const NO_SCAN = { scheduled: 'pending', due: 'due', failed: 'failed', late: 'late', missed: 'missed', published: 'unreadable' }
// What the page leads with. `today`, `empty` and `archived` show a morning
// record; every other kind is one compact card saying why there is none.
// `selected` means the URL names a morning, so an earlier one was asked for.
export function morningStatus(data, now, { selected = false } = {}) {
  if (!data?.summary) return { kind: 'unavailable' }
  const { summary, morning, opening } = data
  if (morning && morning.tradingDate === summary.tradingDate) return { kind: morning.result === 'empty' ? 'empty' : 'today', lifecycle: lifecycle(data, now) }
  if (morning && selected) return { kind: morning.result === 'empty' ? 'empty' : 'archived', archived: true }
  if (summary.state === 'closed') return { kind: 'closed' }
  if (!opening) return { kind: 'unavailable' }
  // Not due yet, or unknown: the deadline passing on screen is itself news.
  const kind = NO_SCAN[opening.status]
  if (!kind || kind === 'pending' || kind === 'due') return { kind: now >= Date.parse(opening.deadlineAt) ? 'overdue' : kind || 'due' }
  return { kind }
}

export function otmLabel(row, contract) {
  if (!row || !contract || !Number.isFinite(row.underlyingPrice) || !Number.isFinite(contract.strikePrice)) return 'Moneyness unavailable'
  const otm = contract.type === 'call' ? row.underlyingPrice < contract.strikePrice : row.underlyingPrice > contract.strikePrice
  const relation = contract.type === 'call' ? 'below' : 'above'
  if (otm) return `${row.askEntryModeledBidReturnPct > 0 ? 'Modeled gain while still OTM' : 'Still OTM'} · stock ${relation} strike`
  return row.underlyingPrice === contract.strikePrice ? 'At the money' : 'In the money'
}
