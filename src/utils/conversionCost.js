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
import { dedupeTransactions } from './dedupeTransactions.js'

/** Both legs of a conversion land on the same day, in opposite directions. */
const SAME_DAY = (a, b) => a.tradeDate === b.tradeDate

const magnitude = (value) => Math.abs(Number(value) || 0)

// Deduplicate only stable identities. Equal dates/amounts can be real trades
// in different accounts and must never be merged on appearance alone.
const uniqueTransactions = (transactions) => {
  const seen = new Set()
  return transactions.filter((row) => {
    const id = row?.id || row?.sourceId
    if (!id) return true
    const key = `${row.accountId}:${id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

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
  // Only explicitly reported FX events qualify. A plausible ratio between two
  // ordinary deposits does not prove a conversion or its direction.
  const fx = uniqueTransactions(transactions)
    .filter((t) => t?.action === 'FX' && t.tradeDate && magnitude(t.amountMinor) > 0)
    .sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0))

  // Multiple different FX legs on one date need a conversion identifier.
  // Pairing them by array order invents a broker rate. Identical amounts/rates
  // remain interchangeable without changing the measured result.
  const groupKey = (row) => JSON.stringify([row.accountId, row.tradeDate, row.conversionId || ''])
  const groups = new Map()
  for (const row of fx) { const key = groupKey(row); groups.set(key, [...(groups.get(key) || []), row]) }
  const ambiguous = new Set([...groups].filter(([, rows]) => {
    const cad = rows.filter((r) => String(r.currency).toUpperCase() === 'CAD')
    const usd = rows.filter((r) => String(r.currency).toUpperCase() === 'USD')
    return (cad.length > 1 || usd.length > 1) && (new Set(cad.map((r) => magnitude(r.amountMinor))).size > 1 || new Set(usd.map((r) => `${magnitude(r.amountMinor)}:${r.fxRate}`)).size > 1)
  }).map(([key]) => key))

  const events = []
  const unpairable = []
  const used = new Set()

  for (let i = 0; i < fx.length; i += 1) {
    if (used.has(i)) continue
    const left = fx[i]
    if (ambiguous.has(groupKey(left))) { unpairable.push(left); continue }

    const partnerIndex = fx.findIndex((right, j) => (
      j > i && !used.has(j) && SAME_DAY(left, right)
      && groupKey(right) === groupKey(left)
      && new Set([left.currency, right.currency].map((c) => String(c).toUpperCase())).size === 2
      && [left.currency, right.currency].every((c) => ['CAD', 'USD'].includes(String(c).toUpperCase()))
    ))

    if (partnerIndex === -1) { unpairable.push(left); continue }
    const right = fx[partnerIndex]

    used.add(i)
    used.add(partnerIndex)

    // The leg carrying a mid-market rate is the non-CAD one: fxRate is CAD per
    // unit of the foreign currency, so a CAD row has no rate to carry.
    const foreign = String(left.currency).toUpperCase() === 'CAD' ? right : left
    const domestic = foreign === left ? right : left

    events.push({
      transactionId: `${left.id || left.sourceId || i}:${right.id || right.sourceId || partnerIndex}`,
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
export function measureConversionCost({ transactions = [], sourceId = null, historyStarts = {}, year = null, asOf = null } = {}) {
  transactions = uniqueTransactions(transactions)
  const { events, unpairable } = conversionEventsFromLedger(transactions)
  // Both kinds of evidence, priced by the same formula and merged into one
  // list, so a caller never has to know which sort of record a conversion came
  // from — only that it happened and what it cost.
  const embedded = tradeEmbeddedConversions({ transactions, historyStarts, explicitEvents: events })

  // A single year, applied here rather than by each caller. The Summary card and
  // the Planning report both read this function, and two aggregations over the
  // same data are two chances to disagree about what a year cost.
  const inYear = (entry) => (!year || String(entry?.tradeDate ?? '').slice(0, 4) === String(year)) && (!asOf || entry.tradeDate <= asOf)

  const priced = [
    ...events.map((event) => measureConversion({ ...event, source: 'ledger-fx' }, { sourceId })),
    ...embedded.events.map((event) => measureConversion(event, { sourceId })),
  ].filter(Boolean).filter(inYear)

  // Refusals are counted for the same year the total covers, so "3 conversions,
  // 1 not priced" describes one period rather than two.
  const unpricedCount = unpairable.filter(inYear).length
    + (events.filter(inYear).length + embedded.events.filter(inYear).length - priced.length)
    + embedded.unpriced.filter(inYear).length

  if (priced.length === 0 && unpricedCount === 0) return null

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
    unpricedCount,
    unpriced: embedded.unpriced.filter(inYear),
    complete: unpricedCount === 0,
    year: year ?? null,
    currency: 'CAD',
  }
}

// ─── Conversions bundled into a trade (#137) ──────────────────────────────────

/**
 * Not every conversion arrives as its own ledger row.
 *
 * The pairing above prices an *explicit* conversion — two cash movements a
 * broker reported as such. The commonest real case is quieter: a USD purchase
 * the account had no USD cash to fund, where the broker converted CAD to cover
 * it and reported one trade rather than a trade plus a conversion. Priced only
 * from explicit rows, that conversion contributes nothing to the total even
 * though it really happened.
 *
 * A USD buy is **not** evidence of a conversion on its own. An account holding
 * enough USD cash pays for it out of that cash and converts nothing. The
 * evidence is a shortfall: what the trade cost against what the account held
 * immediately before it.
 */

/** Rows that move cash in the currency they are denominated in. */
const CASH_INFLOW = new Set(['SELL', 'DIVIDEND', 'ROC', 'TRANSFER', 'FX'])
const CASH_OUTFLOW = new Set(['BUY', 'FEE', 'TAX'])

const isCash = (action) => CASH_INFLOW.has(action) || CASH_OUTFLOW.has(action)

/**
 * A running cash balance per account, in one currency, keyed by the row that
 * follows it. The value against a transaction id is the balance *immediately
 * before* that row is applied, which is the quantity the shortfall test needs.
 *
 * The opening balance is taken as zero at the account's `historyStartsAt`.
 * That is an assumption, and it is the one place this module cannot verify:
 * cash held before the ledger begins is invisible, and would make a funded
 * purchase look like a shortfall. Trades are therefore only priced for accounts
 * whose history demonstrably predates them — see `tradeEmbeddedConversions`.
 */
export function runningCashBalances(transactions = [], currency = 'USD') {
  const wanted = String(currency).toUpperCase()
  // Every cash-affecting row is ordered, not only the ones denominated in the
  // tracked currency. A purchase the broker settled in CAD moves no US dollars
  // — but it is exactly the row whose USD balance has to be read, so it has to
  // appear in the timeline to be given one.
  const ordered = [...transactions]
    .filter((t) => t?.tradeDate && isCash(t.action))
    .sort((a, b) => (
      a.tradeDate < b.tradeDate ? -1
        : a.tradeDate > b.tradeDate ? 1
          : String(a.id ?? '').localeCompare(String(b.id ?? ''))
    ))

  const balanceBefore = new Map()
  const byAccount = new Map()

  for (const row of ordered) {
    const account = row.accountId
    const running = byAccount.get(account) ?? 0
    balanceBefore.set(row.id, running)

    // Only a row denominated in the tracked currency moves it.
    if (String(row.currency ?? '').toUpperCase() !== wanted) continue
    const amount = magnitude(row.amountMinor)
    byAccount.set(account, CASH_OUTFLOW.has(row.action) ? running - amount : running + amount)
  }

  return { balanceBefore, closing: byAccount }
}

/**
 * What the trade cost, and what the broker debited to fund it.
 *
 * The two legs have to come off the row itself. `amountMinor` is what left the
 * account, stated in the row's own currency; quantity times unit price is what
 * the security cost in its own. When those two currencies differ, the ratio
 * between them is the rate the broker actually used — the same derivation the
 * explicit path makes from two paired rows, read from one.
 *
 * Returns null when either leg is missing. A trade whose CAD side cannot be
 * established has no measurable spread, and inventing one from the reference
 * rate would report a zero-cost conversion, which is worse than reporting none.
 */
function tradeLegs(row) {
  const rowCurrency = String(row?.currency ?? '').toUpperCase()
  const debitedMinor = magnitude(row?.amountMinor)
  const quantity = magnitude(row?.quantity)
  const priceMinor = magnitude(row?.priceMinor)
  if (!(debitedMinor > 0) || !(quantity > 0) || !(priceMinor > 0)) return null

  // The security's own cost, in the currency it is priced in.
  const securityCostMinor = Math.round(quantity * priceMinor)
  if (!(securityCostMinor > 0)) return null

  // Same currency on both sides means nothing was converted to make this trade.
  if (rowCurrency === 'USD') return null
  if (rowCurrency !== 'CAD') return null
  if (String(row.priceCurrency || '').toUpperCase() !== 'USD') return null

  return { debitedMinor, usdCostMinor: securityCostMinor, brokerRate: debitedMinor / securityCostMinor }
}

/**
 * Conversions the ledger implies rather than states.
 *
 * @param historyStarts accountId -> the date that account's history begins.
 *   Required: without it the balance before a trade cannot be established, and
 *   an unknown opening balance is refused rather than assumed to be zero.
 */
export function tradeEmbeddedConversions({ transactions = [], historyStarts = {}, explicitEvents = [] } = {}) {
  transactions = uniqueTransactions(transactions)
  const { balanceBefore } = runningCashBalances(transactions, 'USD')

  // A trade already accounted for by an explicit conversion on the same day in
  // the same account is not converted twice.
  const explicitKeys = new Set(explicitEvents.map((event) => `${event.accountId}|${event.tradeDate}`))

  const events = []
  const unpriced = []

  for (const row of transactions) {
    if (row?.action !== 'BUY' || !row.tradeDate) continue

    if (explicitKeys.has(`${row.accountId}|${row.tradeDate}`)) continue
    // The ledger's currency labels its amount, not an independently verified
    // USD unit price. In particular, a CAD amount equal to quantity × price
    // cannot prove a 1:1 CAD/USD conversion. Legacy records need evidence from
    // their source before the embedded path can price them.
    if (String(row.currency).toUpperCase() === 'CAD' && !row.priceCurrency && magnitude(row.priceMinor) > 0 && magnitude(row.quantity) > 0) {
      unpriced.push({ transactionId: row.id ?? null, tradeDate: row.tradeDate, accountId: row.accountId, symbol: row.symbol, reason: 'unverified-price-currency' })
      continue
    }
    const legs = tradeLegs(row)
    if (!legs) continue

    // Without a history boundary the balance is unknowable, and a trade that
    // predates the boundary has an opening balance this cannot see.
    const startsAt = historyStarts[row.accountId]
    if (!startsAt || row.tradeDate <= startsAt) {
      unpriced.push({ transactionId: row.id ?? null, tradeDate: row.tradeDate, accountId: row.accountId, symbol: row.symbol, reason: 'insufficient-history' })
      continue
    }

    const midRate = Number(row.fxRate)
    if (!(midRate > 0)) {
      unpriced.push({ transactionId: row.id ?? null, tradeDate: row.tradeDate, accountId: row.accountId, symbol: row.symbol, reason: 'no-reference-rate' })
      continue
    }

    // A USD balance the ledger never saw is treated as absent, not negative.
    const available = Math.max(balanceBefore.get(row.id) ?? 0, 0)
    const shortfallMinor = legs.usdCostMinor - available
    // Funded out of USD already held: nothing was converted.
    if (shortfallMinor <= 0) continue

    events.push({
      tradeDate: row.tradeDate,
      accountId: row.accountId,
      transactionId: row.id ?? null,
      symbol: row.symbol ?? null,
      fromCurrency: 'CAD',
      // Only the converted part is priced. A trade half-funded from existing
      // cash converted half as much, and charging the spread on the whole
      // purchase would overstate what the broker actually took.
      fromAmountMinor: Math.round(shortfallMinor * legs.brokerRate),
      toCurrency: 'USD',
      toAmountMinor: shortfallMinor,
      midRate,
      // So a screen can say which of the two kinds of evidence this rests on.
      source: 'trade-embedded',
      usdCostMinor: legs.usdCostMinor,
      usdAvailableMinor: available,
    })
  }

  return { events, unpriced }
}

// A what-if scenario, not evidence of a past conversion. A USD purchase may
// have used USD already held. Callers must carry this assumption with the cost.
export const DEFAULT_BROKER_SPREAD_PCT = 1.5

export function estimateConversionCost({
  transactions = [], year = null, spreadPct = DEFAULT_BROKER_SPREAD_PCT, measured = null, asOf = null,
} = {}) {
  const rate = Number(spreadPct)
  if (!Number.isFinite(rate) || rate < 0) return null

  // A purchase already covered by a measured conversion is not estimated on top
  // of it: that would charge the same exchange twice.
  const measuredKeys = new Set((measured?.conversions ?? []).map((c) => `${c.accountId}|${c.tradeDate}`))

  const purchases = []
  for (const row of dedupeTransactions(transactions)) {
    if (row?.action !== 'BUY' || !row.tradeDate) continue
    if (year && String(row.tradeDate).slice(0, 4) !== String(year)) continue
    if (asOf && row.tradeDate > asOf) continue
    // Model a full conversion only as an explicit scenario, not a recorded cost.
    if (String(row.currency ?? '').toUpperCase() !== 'USD') continue
    if (measuredKeys.has(`${row.accountId}|${row.tradeDate}`)) continue

    const usdMinor = magnitude(row.amountMinor)
    const midRate = Number(row.fxRate)
    // Without the day's reference rate there is no Canadian figure to take a
    // spread of, and inventing one would be an estimate resting on an estimate.
    if (!(usdMinor > 0) || !(midRate > 0)) continue

    const atMidMinor = Math.round(usdMinor * midRate)
    purchases.push({
      transactionId: row.id ?? null,
      accountId: row.accountId,
      symbol: row.symbol ?? null,
      tradeDate: row.tradeDate,
      usdMinor,
      midRate,
      atMidMinor,
      estimatedCostMinor: Math.round((atMidMinor * rate) / 100),
      currency: 'CAD',
      basis: 'scenario',
    })
  }

  if (purchases.length === 0) return null

  return {
    purchases: purchases.sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : -1)),
    totalCostMinor: purchases.reduce((sum, p) => sum + p.estimatedCostMinor, 0),
    totalConvertedMinor: purchases.reduce((sum, p) => sum + p.atMidMinor, 0),
    spreadPct: rate,
    year: year ?? null,
    currency: 'CAD',
    basis: 'scenario',
    assumption: 'Assumes the full purchase amount required CAD-to-USD conversion; existing USD cash is not deducted.',
  }
}
