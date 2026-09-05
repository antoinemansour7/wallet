/**
 * Pooled adjusted cost base.
 *
 * Design: docs/design/transaction-ledger.md §4, §5, §7. Issue #19.
 *
 * Three Canadian rules shape everything here, and each one is a place where the
 * obvious implementation is wrong:
 *
 *   · **Identical securities pool across every non-registered account at every
 *     institution.** A per-account cost base is not a simplification of the
 *     right answer, it is a different and incorrect number. So the pool is
 *     keyed on `securityKey` alone and the account only decides whether a
 *     transaction is admitted at all.
 *
 *   · **There is no capital gain in a registered account.** TFSA and RRSP
 *     activity is in the ledger (the superficial-loss window needs it, see
 *     superficialLoss.js) but must never touch a pool.
 *
 *   · **Each trade converts at the rate on its own trade date.** Not today's
 *     rate, and never a defaulted 1. A non-CAD transaction whose rate could not
 *     be resolved makes the pool `incomplete` rather than quietly reporting US
 *     dollars as Canadian ones.
 *
 * The output carries how it was arrived at. A screen cannot render a cost base
 * without also receiving its provenance, because the two travel in the same
 * object — which is what makes the labelling requirement mechanical rather
 * than remembered.
 */

/**
 * Registration status decides admission to the pool, nothing else.
 *
 * Deliberately a list of what *is* registered, with everything unknown
 * treated as non-registered: a Plaid account whose type did not map, or a
 * statement import that never had one, is far more likely to be a cash account
 * than a TFSA, and the alternative failure — silently dropping real trades out
 * of the pool — produces a cost base that is too low and a gain that is too
 * high, which is the direction that costs someone money.
 */
const REGISTERED_ACCOUNT_TYPES = new Set([
  'TFSA', 'RRSP', 'RRSP_SPOUSAL', 'RRIF', 'FHSA', 'RESP', 'RDSP',
  'LIRA', 'LIF', 'LRIF', 'LRSP', 'PRIF',
])

export const PROVENANCE = {
  DERIVED: 'derived',
  INCOMPLETE: 'incomplete',
}

export const INCOMPLETE_REASONS = {
  SOLD_MORE_THAN_SEEN: 'sold-more-than-seen',
  UNRESOLVED_FX: 'unresolved-fx',
  TRANSFER_IN: 'transfer-of-unknown-cost',
  PREDATES_HISTORY: 'predates-history',
}

export function isRegisteredAccount(accountType) {
  return REGISTERED_ACCOUNT_TYPES.has(String(accountType ?? '').trim().toUpperCase())
}

/**
 * A transaction's monetary fields in Canadian cents.
 *
 * Returns null when the conversion cannot be made honestly — a non-CAD
 * transaction with no resolved rate. The caller marks the pool incomplete
 * rather than substituting a rate, because a plausible wrong number on a tax
 * figure is worse than a visible gap.
 */
function toCad(minor, transaction) {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return 0
  const currency = String(transaction.currency ?? '').trim().toUpperCase()
  if (!currency || currency === 'CAD') return minor

  const rate = Number(transaction.fxRate)
  if (!Number.isFinite(rate) || rate <= 0) return null
  // FXUSDCAD is CAD per unit of foreign currency, so this multiplies.
  return Math.round(minor * rate)
}

const magnitude = (value) => Math.abs(Number(value) || 0)

/** Chronological, with a stable tie-break so a same-day pair always pools the
 *  same way and a re-run cannot produce a different cost base. */
function inLedgerOrder(transactions) {
  return [...transactions].sort((a, b) => {
    if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1
    // A buy before a sell on the same day: you cannot dispose of what the same
    // day's purchase supplied, and ordering the sell first would spuriously
    // trip the sold-more-than-seen check.
    const rank = (t) => (t.action === 'SELL' ? 1 : 0)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
}

function emptyPool(transaction) {
  return {
    securityKey: transaction.securityKey,
    symbol: transaction.symbol || '',
    // The weakest rung used by any transaction in the pool. A pool joined on a
    // bare symbol is a guess, and saying so is the point of carrying the basis
    // through from resolveSecurityKey.
    securityKeyBasis: transaction.securityKeyBasis,
    quantity: 0,
    acbMinor: 0,
    currency: 'CAD',
    realizedGainMinor: 0,
    disposals: [],
    provenance: PROVENANCE.DERIVED,
    incompleteReasons: [],
  }
}

function markIncomplete(pool, reason) {
  pool.provenance = PROVENANCE.INCOMPLETE
  if (!pool.incompleteReasons.includes(reason)) pool.incompleteReasons.push(reason)
}

/**
 * Pool every non-registered transaction into one cost base per security.
 *
 * `historyStartsAt` maps accountId to the ISO date that account's history
 * begins. A transaction is never dropped for being older; the map exists so a
 * pool whose security was already held at that boundary can say so.
 */
export function poolCostBase(transactions = [], { historyStartsAt = {} } = {}) {
  const pools = new Map()

  const eligible = inLedgerOrder(
    transactions.filter((t) => t && t.securityKey && t.tradeDate && !isRegisteredAccount(t.accountType)),
  )

  for (const transaction of eligible) {
    if (!pools.has(transaction.securityKey)) pools.set(transaction.securityKey, emptyPool(transaction))
    const pool = pools.get(transaction.securityKey)

    if (transaction.securityKeyBasis === 'symbol') pool.securityKeyBasis = 'symbol'
    if (!pool.symbol && transaction.symbol) pool.symbol = transaction.symbol

    const amount = toCad(magnitude(transaction.amountMinor), transaction)
    const fees = toCad(magnitude(transaction.feesMinor), transaction)
    if (amount === null || fees === null) {
      markIncomplete(pool, INCOMPLETE_REASONS.UNRESOLVED_FX)
      continue
    }

    const quantity = magnitude(transaction.quantity)
    const startsAt = historyStartsAt[transaction.accountId]
    if (startsAt && transaction.tradeDate < startsAt) markIncomplete(pool, INCOMPLETE_REASONS.PREDATES_HISTORY)

    switch (transaction.action) {
      case 'BUY':
        // Commission is part of what the shares cost, so it is capitalised
        // rather than expensed.
        pool.acbMinor += amount + fees
        pool.quantity += quantity
        break

      case 'REINVEST':
        // A reinvested distribution was taxed as income when received, so it
        // adds to the cost base. Omitting it is the single most common ACB
        // error and it overstates the eventual gain every time.
        pool.acbMinor += amount + fees
        pool.quantity += quantity
        break

      case 'ROC':
        // Return of capital is not income; it reduces the cost base, and can
        // drive it below zero, which is itself a taxable gain. Reported rather
        // than clamped.
        pool.acbMinor -= amount
        break

      case 'SELL': {
        if (quantity <= 0) break
        if (pool.quantity <= 0 || quantity > pool.quantity + 1e-9) {
          // Disposing of more than the ledger ever acquired means the history
          // does not reach back to the purchase. No gain is reported, because
          // any number here would be computed against a cost base that is
          // missing its opening balance.
          markIncomplete(pool, INCOMPLETE_REASONS.SOLD_MORE_THAN_SEEN)
          pool.quantity = Math.max(0, pool.quantity - quantity)
          break
        }

        // Proportional relief, computed on the pool as it stands before this
        // disposal — the whole point of pooling rather than tracking lots.
        const costRemoved = Math.round((pool.acbMinor * quantity) / pool.quantity)
        const proceeds = amount - fees
        const gain = proceeds - costRemoved

        pool.acbMinor -= costRemoved
        pool.quantity -= quantity
        pool.realizedGainMinor += gain
        pool.disposals.push({
          transactionId: transaction.id ?? null,
          accountId: transaction.accountId,
          securityKey: transaction.securityKey,
          symbol: pool.symbol,
          tradeDate: transaction.tradeDate,
          quantity,
          proceedsMinor: proceeds,
          costRemovedMinor: costRemoved,
          gainMinor: gain,
        })
        break
      }

      case 'SPLIT':
        // More shares, same money. Cost per unit falls out of the division
        // rather than being restated.
        pool.quantity += quantity
        break

      case 'TRANSFER':
        // An in-kind transfer carries a cost base the ledger cannot see. It
        // moves the position, so the quantity is real, but any gain computed
        // afterwards would rest on a cost that was never observed.
        pool.quantity += Number(transaction.quantity) || 0
        markIncomplete(pool, INCOMPLETE_REASONS.TRANSFER_IN)
        break

      // DIVIDEND is income, not a cost-base event. A standalone FEE is an
      // expense of holding rather than of acquiring, so neither moves the pool.
      default:
        break
    }
  }

  const bySecurity = [...pools.values()].map((pool) => ({
    ...pool,
    quantity: Number(pool.quantity.toFixed(6)),
    acbPerUnitMinor: pool.quantity > 0 ? Math.round(pool.acbMinor / pool.quantity) : null,
    // A gain computed from a pool that is missing history is not a gain.
    realizedGainMinor: pool.provenance === PROVENANCE.DERIVED ? pool.realizedGainMinor : null,
  }))

  return {
    bySecurity,
    disposals: bySecurity.flatMap((pool) => (pool.provenance === PROVENANCE.DERIVED ? pool.disposals : [])),
    realizedGainMinor: bySecurity.reduce((sum, pool) => sum + (pool.realizedGainMinor ?? 0), 0),
    currency: 'CAD',
  }
}
