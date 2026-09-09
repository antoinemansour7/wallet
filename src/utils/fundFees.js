/**
 * What the portfolio pays in fund fees each year.
 *
 * A management expense ratio is deducted from the fund's value rather than
 * billed, so it never appears as a line on a statement and most people have no
 * idea what they pay. Stating it in dollars is the whole feature.
 *
 * Two rules do the work, and both are about refusing to average the wrong set:
 *
 *   · **Individual stocks are excluded, not counted at zero.** A stock has no
 *     MER. Including it at 0% drags the portfolio average toward zero in
 *     proportion to how much of the portfolio is stocks, which produces a
 *     smaller number that looks like a better one.
 *
 *   · **Missing fee data is stated, never treated as zero.** A portfolio
 *     reading "$0 in fees" because a lookup failed is worse than one that says
 *     nothing, because the first is a claim and the second is a gap.
 *
 * Deliberately not here: naming a cheaper equivalent fund. That needs a
 * maintained mapping of comparable funds, which does not exist in this codebase
 * and cannot be inferred from an expense ratio alone — VFV and XEQT are not
 * substitutes for each other however their fees compare. Suggesting one would
 * also cross from measurement into a recommendation to buy a named security,
 * which is the line #16 draws.
 */

import { toMinorUnits } from './money.js'

const marketValueMinorOf = (row) => toMinorUnits(row?.['MARKET VALUE'])

/**
 * @param reference symbol -> { expenseRatioPct, isFund } from securityReference
 * @returns null when no holding is a fund with known fees — nothing to say.
 */
export function summarizeFundFees(rows = [], reference = {}) {
  const refFor = (row) => reference[String(row?.SYMBOL ?? '').trim().toUpperCase()] ?? null

  let annualFeeMinor = 0
  let weightedFeeMinor = 0
  let pricedValueMinor = 0
  let unpricedValueMinor = 0
  const priced = []
  const unpriced = []

  for (const row of rows) {
    const value = marketValueMinorOf(row)
    if (!value || value <= 0) continue

    const ref = refFor(row)
    // Only funds. A security we could not resolve at all is not assumed to be
    // one: an unresolved stock counted as an unpriced fund would report a gap
    // in fee data that does not exist.
    if (!ref?.isFund) continue

    const mer = Number(ref.expenseRatioPct)
    if (ref.expenseRatioPct == null || ref.expenseRatioPct === '' || !Number.isFinite(mer) || mer < 0) {
      unpricedValueMinor += value
      unpriced.push(String(row.SYMBOL ?? '').toUpperCase())
      continue
    }

    weightedFeeMinor += (value * mer) / 100
    annualFeeMinor += Math.round((value * mer) / 100)
    pricedValueMinor += value
    priced.push({ symbol: String(row.SYMBOL ?? '').toUpperCase(), expenseRatioPct: mer, annualFeeMinor: Math.round((value * mer) / 100) })
  }

  if (priced.length === 0 && unpriced.length === 0) return null

  return {
    annualFeeMinor,
    // Weighted across the funds whose fees are known — not across the whole
    // portfolio, which would silently include stocks at zero.
    weightedMerPct: pricedValueMinor > 0 ? Number(((weightedFeeMinor / pricedValueMinor) * 100).toFixed(3)) : null,
    pricedValueMinor,
    unpricedValueMinor,
    holdings: priced.sort((a, b) => b.annualFeeMinor - a.annualFeeMinor),
    // Named, so the gap is visible rather than folded into the total.
    missingFeeData: unpriced.sort(),
    complete: unpriced.length === 0,
  }
}
