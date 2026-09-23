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
export function otmLabel(row, contract) {
  if (!row || !contract || !Number.isFinite(row.underlyingPrice) || !Number.isFinite(contract.strikePrice)) return 'Moneyness unavailable'
  const otm = contract.type === 'call' ? row.underlyingPrice < contract.strikePrice : row.underlyingPrice > contract.strikePrice
  const relation = contract.type === 'call' ? 'below' : 'above'
  if (otm) return `${row.askEntryModeledBidReturnPct > 0 ? 'Modeled gain while still OTM' : 'Still OTM'} · stock ${relation} strike`
  return row.underlyingPrice === contract.strikePrice ? 'At the money' : 'In the money'
}
