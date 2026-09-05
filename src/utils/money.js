/**
 * Money as integers.
 *
 * Portfolio totals tolerate float drift because they are already estimates
 * refreshed against a live price. An adjusted cost base does not: it is
 * carried forward across every trade in a security's life, the drift
 * compounds, and the number it produces goes on a tax return where it has to
 * agree with a brokerage statement to the cent.
 *
 * So every monetary value in the ledger is an integer count of minor units,
 * and the only places that convert are the edges — import and display.
 */

const DEFAULT_SCALE = 2

/**
 * `Math.round(value * 100)` is the obvious conversion and it is wrong often
 * enough to matter: 1.005 is stored as 1.00499999999999989 and rounds down,
 * losing a cent. Going through the decimal string instead rounds the number
 * the user actually typed rather than its binary approximation.
 */
function roundHalfUpAtScale(value, scale) {
  // toFixed rounds the decimal representation, sidestepping the binary
  // fraction; the +0 normalises -0 to 0.
  const shifted = Number(`${value}e${scale}`)
  if (!Number.isFinite(shifted)) return null
  const rounded = Math.sign(shifted) * Math.round(Math.abs(shifted))
  return rounded + 0
}

function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  if (typeof input !== 'string') return null

  const trimmed = input.trim()
  if (!trimmed) return null

  // Accounting notation: (143.29) means negative.
  const parenthesised = /^\((.*)\)$/.exec(trimmed)
  const body = parenthesised ? parenthesised[1] : trimmed

  // Strip currency symbols and thousands separators, keep sign and point.
  const stripped = body.replace(/[^0-9.\-+]/g, '')
  if (!stripped || !/\d/.test(stripped)) return null

  const parsed = Number(stripped)
  if (!Number.isFinite(parsed)) return null

  return parenthesised ? -parsed : parsed
}

export function toMinorUnits(input, scale = DEFAULT_SCALE) {
  const amount = parseAmount(input)
  if (amount === null) return null
  return roundHalfUpAtScale(amount, scale)
}

export function fromMinorUnits(minor, scale = DEFAULT_SCALE) {
  if (minor === null || minor === undefined) return null
  return Number(`${minor}e-${scale}`)
}

export function formatMinor(minor, currency = 'CAD', scale = DEFAULT_SCALE) {
  // An em dash, not $0.00. A missing amount and a zero amount mean different
  // things, and only one of them is a fact about the portfolio.
  if (minor === null || minor === undefined) return '—'

  const value = fromMinorUnits(minor, scale)
  const formatted = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  }).format(Math.abs(value))

  return value < 0 ? `-${formatted}` : formatted
}
