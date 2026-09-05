/**
 * Superficial-loss detection.
 *
 * Design: docs/design/transaction-ledger.md §7, §8. Issue #19.
 *
 * Sell at a loss, buy the identical property back within 30 days either side,
 * and still hold it at the end of that window, and the loss is denied — it is
 * added to the cost base of what you still own instead of reducing this year's
 * gain.
 *
 * Two asymmetries with the cost-base pass matter, and conflating them is the
 * usual way this gets built wrong:
 *
 *   · **Registered accounts count here.** Buying back in a TFSA or RRSP denies
 *     a loss taken in a cash account, even though that TFSA can never produce a
 *     capital gain of its own. So this pass reads every account, while
 *     poolCostBase reads only the non-registered ones.
 *
 *   · **The window is 61 days, not 30.** Thirty days before the sale, the day
 *     itself, and thirty days after. A repurchase *preceding* the disposition
 *     triggers the rule exactly as one following it does, which is the half
 *     people forget.
 *
 * This never writes. It produces candidates for review, because the window
 * reaches into accounts the app cannot see — a spouse's, a corporation the
 * user controls, or a brokerage that was never connected — so it is never in a
 * position to know it has the whole picture. Every result says so.
 */

const DAY_MS = 86400000

/** The rule's own span: 30 days before, the day itself, 30 days after. */
export const WINDOW_DAYS = 30

/** Acquisitions that count as buying the property back. */
const ACQUISITIONS = new Set(['BUY', 'REINVEST'])

function shiftDate(isoDate, days) {
  const ms = Date.parse(`${isoDate}T00:00:00Z`)
  if (!Number.isFinite(ms)) return null
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Position in a security across every account, registered included, as at a
 * date. Quantities are already signed by action in the ledger, so a sale
 * subtracts without this having to know which actions dispose.
 */
function positionAsAt(transactions, securityKey, date) {
  return transactions.reduce((total, t) => {
    if (t.securityKey !== securityKey || t.tradeDate > date) return total
    return total + (Number(t.quantity) || 0)
  }, 0)
}

/**
 * @param disposals Loss-making dispositions from poolCostBase. Only pools with
 *   `derived` provenance produce these, which is deliberate: a disposition
 *   whose cost base is unknown has no known loss, so there is nothing to deny.
 */
export function detectSuperficialLosses({ transactions = [], disposals = [] } = {}) {
  const candidates = []

  for (const disposal of disposals) {
    if (!(disposal?.gainMinor < 0) || !(disposal.quantity > 0)) continue

    const windowStart = shiftDate(disposal.tradeDate, -WINDOW_DAYS)
    const windowEnd = shiftDate(disposal.tradeDate, WINDOW_DAYS)
    if (!windowStart || !windowEnd) continue

    const repurchases = transactions.filter((t) => (
      t.securityKey === disposal.securityKey
      && ACQUISITIONS.has(t.action)
      && t.tradeDate >= windowStart
      && t.tradeDate <= windowEnd
    ))
    if (repurchases.length === 0) continue

    const acquiredQuantity = repurchases.reduce((sum, t) => sum + Math.abs(Number(t.quantity) || 0), 0)
    if (acquiredQuantity <= 0) continue

    // The third condition, and the one that stops a full exit from being
    // flagged: the property has to still be held when the window closes.
    const heldAtWindowEnd = positionAsAt(transactions, disposal.securityKey, windowEnd)
    if (heldAtWindowEnd <= 0) continue

    // The denied portion is the least of what was sold, what was bought back,
    // and what is still held — a partial repurchase denies a partial loss.
    const deniedQuantity = Math.min(disposal.quantity, acquiredQuantity, heldAtWindowEnd)
    const lossMinor = Math.abs(disposal.gainMinor)
    const deniedMinor = Math.round((lossMinor * deniedQuantity) / disposal.quantity)

    candidates.push({
      securityKey: disposal.securityKey,
      symbol: disposal.symbol,
      disposal: {
        transactionId: disposal.transactionId,
        accountId: disposal.accountId,
        tradeDate: disposal.tradeDate,
        quantity: disposal.quantity,
        lossMinor,
      },
      window: { start: windowStart, end: windowEnd, days: WINDOW_DAYS * 2 + 1 },
      repurchases: repurchases.map((t) => ({
        transactionId: t.id ?? null,
        accountId: t.accountId,
        accountType: t.accountType ?? null,
        tradeDate: t.tradeDate,
        quantity: Math.abs(Number(t.quantity) || 0),
      })),
      acquiredQuantity: Number(acquiredQuantity.toFixed(6)),
      heldAtWindowEnd: Number(heldAtWindowEnd.toFixed(6)),
      deniedQuantity: Number(deniedQuantity.toFixed(6)),
      deniedMinor,
      // Denying the loss is not the end of it: the amount is added to the cost
      // base of what is still held, so it is deferred rather than lost.
      partial: deniedQuantity < disposal.quantity,
      currency: 'CAD',
      // Carried on every candidate rather than shown once in the UI, so the
      // limitation cannot be separated from the number it qualifies.
      reviewRequired: true,
      unseenAccountsCaveat: 'The 61-day window also covers a spouse\'s accounts and any brokerage not connected here, which this check cannot see.',
    })
  }

  return candidates.sort((a, b) => (
    a.disposal.tradeDate < b.disposal.tradeDate ? -1
      : a.disposal.tradeDate > b.disposal.tradeDate ? 1
        : String(a.securityKey).localeCompare(String(b.securityKey))
  ))
}
