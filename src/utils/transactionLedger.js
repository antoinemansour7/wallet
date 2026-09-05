/**
 * The transaction record, and the rules for getting one out of an import.
 *
 * Design: docs/design/transaction-ledger.md
 *
 * Two properties matter more than anything else here:
 *
 *   · **Idempotence.** The id is derived from the transaction, never
 *     generated, so re-importing an overlapping window writes the same
 *     documents with the same content. Recovering from a partial import is
 *     re-running it, not reconciling it.
 *
 *   · **Refusal over guessing.** A record that cannot be identified, dated or
 *     classified is dropped rather than defaulted. A guessed action books a
 *     cash movement as a purchase; a guessed date puts a trade in the wrong
 *     side of a 61-day window; a defaulted FX rate reports a USD trade as
 *     Canadian dollars. Each produces a plausible number that is wrong, which
 *     is worse than a gap someone can see.
 */

import { resolveSecurityKey } from './securityKey'
import { toMinorUnits } from './money'

export const ACTIONS = {
  BUY: 'BUY',
  SELL: 'SELL',
  DIVIDEND: 'DIVIDEND',
  ROC: 'ROC',
  REINVEST: 'REINVEST',
  FEE: 'FEE',
  SPLIT: 'SPLIT',
  TRANSFER: 'TRANSFER',
}

// Actions whose quantity is a disposition and is therefore stored negative,
// so that summing quantity over a security is the position.
const NEGATIVE_QUANTITY = new Set([ACTIONS.SELL])

const PLAID_ACTIONS = new Map([
  ['buy', ACTIONS.BUY],
  ['sell', ACTIONS.SELL],
  ['dividend', ACTIONS.DIVIDEND],
  ['cash', ACTIONS.DIVIDEND],
  ['reinvestment', ACTIONS.REINVEST],
  ['return of capital', ACTIONS.ROC],
  ['fee', ACTIONS.FEE],
  ['transfer', ACTIONS.TRANSFER],
  ['split', ACTIONS.SPLIT],
])

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * FNV-1a, run twice with different offsets to widen the digest.
 *
 * Deliberately not crypto.subtle: that is async, and normalisation has to stay
 * a pure synchronous function so an import can be tested and reasoned about
 * without a promise in the middle. This hash is content-addressing inside one
 * user's ledger, not a security boundary.
 */
function hash(input) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ code, 0x85ebca6b) >>> 0
  }

  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'))
}

export function transactionIdFor(record) {
  if (record?.source === 'plaid' && record.sourceId) return `plaid:${record.sourceId}`

  // Every field that distinguishes one real transaction from another. Quantity
  // and amount are both here: two buys of the same security on the same day at
  // different sizes are different transactions.
  const material = [
    record?.accountId,
    record?.tradeDate,
    record?.securityKey,
    record?.action,
    record?.quantity,
    record?.amountMinor,
  ].join('|')

  return `${record?.source === 'plaid' ? 'plaid' : 'manual'}:${hash(material)}`
}

function resolveAction(raw) {
  const candidates = [raw?.subtype, raw?.type, raw?.action]
  for (const candidate of candidates) {
    const key = String(candidate ?? '').trim().toLowerCase()
    if (PLAID_ACTIONS.has(key)) return PLAID_ACTIONS.get(key)
    const direct = String(candidate ?? '').trim().toUpperCase()
    if (ACTIONS[direct]) return ACTIONS[direct]
  }
  return null
}

function resolveTradeDate(raw) {
  const value = String(raw?.tradeDate ?? raw?.date ?? '').trim()
  if (!ISO_DATE.test(value)) return null
  return Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ? null : value
}

/**
 * Sources disagree about whether a sale is signed. Normalising on the action
 * rather than trusting the sign means a source that signs and a source that
 * does not both land the same way, and re-importing across a source change
 * does not flip a position.
 */
function signQuantity(quantity, action) {
  const magnitude = Math.abs(Number(quantity) || 0)
  return NEGATIVE_QUANTITY.has(action) ? -magnitude : magnitude
}

export function normalizeTransaction(raw, context = {}) {
  if (!raw) return null

  const { source = 'manual', security, accountId, accountType = null, fx = null } = context
  if (!accountId) return null

  const resolvedSecurity = resolveSecurityKey(security)
  if (!resolvedSecurity) return null

  const action = resolveAction(raw)
  if (!action) return null

  const tradeDate = resolveTradeDate(raw)
  if (!tradeDate) return null

  const quantity = signQuantity(raw.quantity, action)
  const amountMinor = toMinorUnits(raw.amount)
  const priceMinor = toMinorUnits(raw.price)

  const record = {
    accountId,
    accountType,
    securityKey: resolvedSecurity.key,
    securityKeyBasis: resolvedSecurity.basis,
    symbol: String(security?.symbol ?? '').trim().toUpperCase(),
    action,
    tradeDate,
    quantity,
    priceMinor,
    amountMinor,
    // Zero is the right default for fees specifically: a trade with no
    // commission is ordinary and means exactly zero, unlike a missing amount.
    feesMinor: toMinorUnits(raw.fees) ?? 0,
    currency: String(raw.iso_currency_code ?? raw.currency ?? security?.currency ?? '').trim().toUpperCase() || null,
    fxRate: fx?.rate ?? null,
    fxRateSource: fx?.source ?? null,
    fxAsOf: fx?.asOf ?? null,
    source,
    sourceId: raw.investment_transaction_id ?? raw.sourceId ?? null,
  }

  return { ...record, id: transactionIdFor(record) }
}
