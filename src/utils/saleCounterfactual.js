/**
 * What a sale actually cost, using the user's own decisions.
 *
 * Design: #20. The first version of that issue justified this feature with
 * DALBAR's 8.5% investor return gap, presented as what mistiming costs an
 * ordinary investor every year. That figure was a single year, not an average,
 * and the methodology is contested — Morningstar's more conservative measure
 * finds 1.2%. So the population claim is gone and this computes one person's
 * own counterfactual instead: arithmetic they can check, which cannot be
 * argued with the way an average can.
 *
 * ## Both directions, always
 *
 * A counterfactual engine that surfaces only the sales someone regrets is a
 * guilt machine, not a measurement. Selling before a fall is a decision that
 * went well and it is reported the same way, from the same arithmetic. The
 * issue's own note — "it tells people they made a mistake" — is exactly why
 * this must not be built to find mistakes.
 *
 * ## What this deliberately does not model
 *
 * The proceeds went somewhere. Comparing "sold" against "held" ignores what
 * the money did next, so a sale that funded a better position reads here as a
 * cost. That is a real limitation rather than a rounding error, and every
 * result carries it rather than leaving a screen to remember to say it.
 *
 * No annualising, no extrapolation, no "you would have made X per year". One
 * decision, one comparison, at today's price.
 */

const DIRECTION = {
  HOLDING_HIGHER: 'holding-would-be-higher',
  SELLING_HIGHER: 'selling-was-higher',
  LEVEL: 'level',
}

export { DIRECTION }

/**
 * A disposal's quantity valued at today's price, in Canadian cents.
 *
 * Returns null rather than a number whenever the conversion cannot be made
 * honestly — no price, or a foreign price with no rate. Proceeds are already
 * CAD (poolCostBase converts at each trade's own rate), so comparing a USD
 * figure against them unconverted would overstate the difference by roughly a
 * third, which is the whole number this feature reports.
 */
function valueTodayMinor(disposal, quote, usdCadRate) {
  const price = Number(quote?.price)
  if (!Number.isFinite(price) || price <= 0) return null

  const currency = String(quote?.currency ?? '').trim().toUpperCase()
  const rate = Number(usdCadRate)
  if (currency && currency !== 'CAD') {
    if (!Number.isFinite(rate) || rate <= 0) return null
    return Math.round(disposal.quantity * price * 100 * rate)
  }
  return Math.round(disposal.quantity * price * 100)
}

/**
 * @param disposals from poolCostBase — already CAD, already pooled, and only
 *   ever produced for a pool whose provenance is `derived`, so a disposal
 *   whose cost base was unknown never reaches here.
 * @param quotes symbol -> { price, currency }
 */
export function saleCounterfactuals({ disposals = [], quotes = {}, usdCadRate = null } = {}) {
  const results = []

  for (const disposal of disposals) {
    if (!disposal?.symbol || !(disposal.quantity > 0)) continue

    const quote = quotes[String(disposal.symbol).trim().toUpperCase()]
    const wouldBeWorthMinor = valueTodayMinor(disposal, quote, usdCadRate)
    // Silence rather than a guess. A missing price is a gap someone can see;
    // a comparison against a stale or unconverted one is a wrong number
    // presented as a fact about their own decision.
    if (wouldBeWorthMinor === null) continue

    const differenceMinor = wouldBeWorthMinor - disposal.proceedsMinor
    results.push({
      transactionId: disposal.transactionId ?? null,
      accountId: disposal.accountId,
      symbol: String(disposal.symbol).toUpperCase(),
      tradeDate: disposal.tradeDate,
      quantity: disposal.quantity,
      proceedsMinor: disposal.proceedsMinor,
      wouldBeWorthMinor,
      differenceMinor,
      direction: differenceMinor > 0
        ? DIRECTION.HOLDING_HIGHER
        : differenceMinor < 0 ? DIRECTION.SELLING_HIGHER : DIRECTION.LEVEL,
      currency: 'CAD',
    })
  }

  return results.sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0))
}

/**
 * One line for the whole set. Null when nothing could be compared.
 *
 * `netDifferenceMinor` sums both directions rather than only the unfavourable
 * ones, so a year of good decisions reports as one.
 */
export function summarizeCounterfactuals(results = []) {
  if (results.length === 0) return null

  const netDifferenceMinor = results.reduce((sum, entry) => sum + entry.differenceMinor, 0)
  return {
    count: results.length,
    netDifferenceMinor,
    holdingWouldBeHigher: results.filter((entry) => entry.direction === DIRECTION.HOLDING_HIGHER).length,
    sellingWasHigher: results.filter((entry) => entry.direction === DIRECTION.SELLING_HIGHER).length,
    currency: 'CAD',
    // Carried on the summary rather than left to a screen, so the figure and
    // its limitation cannot be separated.
    excludesReinvestment: true,
  }
}
