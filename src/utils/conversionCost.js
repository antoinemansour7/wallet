/**
 * What a currency conversion actually cost.
 *
 * `currencyConversion.js` prices a *hypothetical* conversion: type an amount,
 * see a broker spread against Norbert's Gambit. Useful, but it is a calculator
 * — the figure is one the user supplied, not one off their statement.
 *
 * This is the measured half #18 asked for once the ledger existed:
 *
 *   > Your last conversion cost 1.87%. On $50,000, the alternative would have
 *   > cost about $75 instead of $935.
 *
 * The difference matters more than the accuracy. A number someone can check
 * against their own account persuades where an industry range they have to
 * trust does not, which is the whole thesis of #16.
 *
 * ## Where the two rates come from
 *
 * The **rate charged** is derived, not reported: brokers rarely state it, but
 * a conversion moves money out of one currency and into another, and the ratio
 * of those two amounts *is* the rate. No broker disclosure required.
 *
 * The **mid-market rate** is already on the record. Every ledger row carries
 * `fxRate` stamped at import from the Bank of Canada for that trade date, and
 * never recomputed — see the ledger design's §6. So the comparison needs no
 * new lookup and cannot drift between two viewings of the same screen.
 *
 * ## What it refuses
 *
 * A conversion missing either leg, or missing the mid rate, produces nothing.
 * The spread is the entire number here, and a spread computed against a
 * defaulted or absent rate is a confident fiction — the failure mode this
 * codebase refuses everywhere a tax figure is involved.
 */

import { conversionComparison } from './currencyConversion.js'

/** Both legs of a conversion land on the same day, in opposite directions. */
const SAME_DAY = (a, b) => a.tradeDate === b.tradeDate

const magnitude = (value) => Math.abs(Number(value) || 0)

/**
 * Pair raw FX ledger rows into conversion events.
 *
 * A conversion is two cash movements — one out, one in — and which shape a
 * given institution reports is not something this can assume. Two rows on the
 * same date in different currencies are treated as the two legs of one
 * conversion; anything that cannot be paired is returned as unpairable rather
 * than silently dropped, because a conversion the app can see but cannot price
 * is a different fact from one that never happened.
 *
 * This pairing is a heuristic over data shapes not yet observed in production.
 * It is deliberately separate from the arithmetic below so the measurement can
 * be trusted while this part is still being confirmed against real records.
 */
export function conversionEventsFromLedger(transactions = []) {
  const fx = transactions
    .filter((t) => t?.action === 'FX' && t.tradeDate && magnitude(t.amountMinor) > 0)
    .sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0))

  const events = []
  const unpairable = []
  const used = new Set()

  for (let i = 0; i < fx.length; i += 1) {
    if (used.has(i)) continue
    const left = fx[i]

    const partnerIndex = fx.findIndex((right, j) => (
      j > i && !used.has(j) && SAME_DAY(left, right)
      && right.accountId === left.accountId
      && String(right.currency ?? '') !== String(left.currency ?? '')
    ))

    if (partnerIndex === -1) { unpairable.push(left); continue }
    used.add(i)
    used.add(partnerIndex)
    const right = fx[partnerIndex]

    // The leg carrying a mid-market rate is the non-CAD one: fxRate is CAD per
    // unit of the foreign currency, so a CAD row has no rate to carry.
    const foreign = String(left.currency).toUpperCase() === 'CAD' ? right : left
    const domestic = foreign === left ? right : left

    events.push({
      tradeDate: left.tradeDate,
      accountId: left.accountId,
      fromCurrency: String(domestic.currency ?? '').toUpperCase(),
      fromAmountMinor: magnitude(domestic.amountMinor),
      toCurrency: String(foreign.currency ?? '').toUpperCase(),
      toAmountMinor: magnitude(foreign.amountMinor),
      midRate: Number(foreign.fxRate) > 0 ? Number(foreign.fxRate) : null,
    })
  }

  return { events, unpairable }
}

/**
 * The spread actually paid on one conversion.
 *
 * Returns null when it cannot be computed honestly — no mid rate, or a leg of
 * zero. `costMinor` is what the spread took out of the amount converted, which
 * is the number a person can reconcile against their statement.
 */
export function measureConversion(event, { sourceId } = {}) {
  if (!event) return null
  const { fromAmountMinor, toAmountMinor, midRate } = event
  if (!(fromAmountMinor > 0) || !(toAmountMinor > 0) || !(midRate > 0)) return null

  // Both rates are stated the same way — domestic currency per unit of
  // foreign — so they are directly comparable.
  const chargedRate = fromAmountMinor / toAmountMinor
  const spreadPct = (chargedRate / midRate - 1) * 100

  // At the mid rate the same foreign amount would have cost this much, so the
  // difference is what the spread took.
  const atMidMinor = Math.round(toAmountMinor * midRate)
  const costMinor = fromAmountMinor - atMidMinor

  // What the same conversion would have cost through Norbert's Gambit, priced
  // by the existing model rather than a second one. Null below the threshold
  // where the technique stops being worth the steps.
  const alternative = conversionComparison({ amountCad: fromAmountMinor / 100, sourceId })

  return {
    ...event,
    chargedRate: Number(chargedRate.toFixed(6)),
    midRate,
    spreadPct: Number(spreadPct.toFixed(3)),
    costMinor,
    atMidMinor,
    alternativeCostMinor: alternative ? alternative.gambitCostMinor : null,
    // Only stated when there is an alternative to state it against.
    couldHaveSavedMinor: alternative ? costMinor - alternative.gambitCostMinor : null,
    currency: event.fromCurrency,
  }
}

/**
 * Every conversion in the ledger, priced.
 *
 * Returns null when there is nothing to report. `unpricedCount` is carried so a
 * screen can say the total is incomplete rather than presenting a partial sum
 * as the whole picture.
 */
export function measureConversionCost({ transactions = [], sourceId = null } = {}) {
  const { events, unpairable } = conversionEventsFromLedger(transactions)
  const priced = events.map((event) => measureConversion(event, { sourceId })).filter(Boolean)

  if (priced.length === 0 && unpairable.length === 0) return null

  const totalCostMinor = priced.reduce((sum, entry) => sum + entry.costMinor, 0)
  const totalConvertedMinor = priced.reduce((sum, entry) => sum + entry.fromAmountMinor, 0)

  return {
    conversions: priced.sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : -1)),
    totalCostMinor,
    totalConvertedMinor,
    // The blended rate actually paid across every conversion, which is the one
    // figure comparable with the industry range #18 stopped quoting.
    averageSpreadPct: totalConvertedMinor > 0
      ? Number(((totalCostMinor / totalConvertedMinor) * 100).toFixed(3))
      : null,
    unpricedCount: unpairable.length + (events.length - priced.length),
    complete: unpairable.length === 0 && events.length === priced.length,
    currency: 'CAD',
  }
}
