import { describe, it, expect } from 'vitest'
import { conversionEventsFromLedger, measureConversion, measureConversionCost, tradeEmbeddedConversions, runningCashBalances } from './conversionCost'

/** One leg of a conversion, as the ledger stores it. */
const leg = (overrides = {}) => ({
  id: `fx-${Math.random().toString(36).slice(2)}`,
  accountId: 'cash-1',
  action: 'FX',
  tradeDate: '2026-05-12',
  quantity: 0,
  amountMinor: 5000000,
  currency: 'CAD',
  fxRate: null,
  ...overrides,
})

/**
 * $50,000 CAD out, $36,630.04 USD in.
 *   charged  50000 / 36630.04 = 1.36500 CAD per USD
 *   mid                         1.34000
 *   at mid   36630.04 x 1.34  = $49,084.25
 *   spread cost                 $915.75, or 1.866%
 */
const CAD_OUT = leg({ amountMinor: 5000000, currency: 'CAD' })
const USD_IN = leg({ amountMinor: 3663004, currency: 'USD', fxRate: 1.34 })

describe('conversionEventsFromLedger', () => {
  it('pairs the two legs of one conversion', () => {
    const { events, unpairable } = conversionEventsFromLedger([CAD_OUT, USD_IN])

    expect(unpairable).toEqual([])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      fromCurrency: 'CAD', fromAmountMinor: 5000000,
      toCurrency: 'USD', toAmountMinor: 3663004,
      midRate: 1.34,
    })
  })

  it('takes the mid rate from the foreign leg, which is the one that carries it', () => {
    // fxRate is CAD per unit of foreign currency, so a CAD row has no rate.
    expect(conversionEventsFromLedger([CAD_OUT, USD_IN]).events[0].midRate).toBe(1.34)
  })

  it('reports a leg it cannot pair rather than dropping it', () => {
    // A conversion the app can see but cannot price is a different fact from
    // one that never happened.
    const { events, unpairable } = conversionEventsFromLedger([CAD_OUT])

    expect(events).toEqual([])
    expect(unpairable).toHaveLength(1)
  })

  it('does not pair legs from different days or different accounts', () => {
    expect(conversionEventsFromLedger([
      CAD_OUT, leg({ amountMinor: 3663004, currency: 'USD', tradeDate: '2026-06-01' }),
    ]).events).toEqual([])

    expect(conversionEventsFromLedger([
      CAD_OUT, leg({ amountMinor: 3663004, currency: 'USD', accountId: 'other' }),
    ]).events).toEqual([])
  })

  it('ignores rows that are not conversions', () => {
    expect(conversionEventsFromLedger([leg({ action: 'BUY' }), leg({ action: 'DIVIDEND' })]).events).toEqual([])
  })
})

describe('measureConversion', () => {
  const [event] = conversionEventsFromLedger([CAD_OUT, USD_IN]).events

  it('derives the rate charged from the two amounts', () => {
    // Brokers rarely state the rate. The ratio of the legs is the rate.
    expect(measureConversion(event).chargedRate).toBeCloseTo(1.365, 3)
  })

  it('reports the spread as a percentage and in dollars', () => {
    const result = measureConversion(event)

    expect(result.spreadPct).toBeCloseTo(1.866, 2)
    expect(result.costMinor).toBe(5000000 - Math.round(3663004 * 1.34))
    expect(result.costMinor).toBe(91575)
  })

  it('prices the alternative with the existing model rather than a second one', () => {
    const result = measureConversion(event)

    expect(result.alternativeCostMinor).toBeGreaterThan(0)
    expect(result.couldHaveSavedMinor).toBe(result.costMinor - result.alternativeCostMinor)
  })

  it('states no alternative below the amount where the technique stops paying', () => {
    const [small] = conversionEventsFromLedger([
      leg({ amountMinor: 100000, currency: 'CAD' }),
      leg({ amountMinor: 74074, currency: 'USD', fxRate: 1.34 }),
    ]).events

    expect(measureConversion(small).alternativeCostMinor).toBeNull()
    expect(measureConversion(small).couldHaveSavedMinor).toBeNull()
  })

  it('refuses rather than guessing when the mid rate never resolved', () => {
    // The spread is the entire number here. Computing it against a defaulted
    // rate would be a confident fiction.
    const [noRate] = conversionEventsFromLedger([
      CAD_OUT, leg({ amountMinor: 3663004, currency: 'USD', fxRate: null }),
    ]).events

    expect(measureConversion(noRate)).toBeNull()
  })

  it('refuses a conversion missing a leg amount', () => {
    expect(measureConversion({ fromAmountMinor: 0, toAmountMinor: 100, midRate: 1.34 })).toBeNull()
    expect(measureConversion(null)).toBeNull()
  })
})

describe('measureConversionCost', () => {
  it('totals what conversions actually cost, and the blended rate paid', () => {
    const summary = measureConversionCost({ transactions: [CAD_OUT, USD_IN] })

    expect(summary.totalCostMinor).toBe(91575)
    expect(summary.totalConvertedMinor).toBe(5000000)
    expect(summary.averageSpreadPct).toBeCloseTo(1.832, 2)
    expect(summary.complete).toBe(true)
  })

  it('says the total is incomplete rather than presenting a partial sum as the whole', () => {
    const summary = measureConversionCost({ transactions: [CAD_OUT, USD_IN, leg({ tradeDate: '2026-07-01' })] })

    expect(summary.complete).toBe(false)
    expect(summary.unpricedCount).toBe(1)
    expect(summary.totalCostMinor).toBe(91575)
  })

  it('orders most recent conversion first', () => {
    const later = [
      leg({ tradeDate: '2026-08-01', amountMinor: 1000000, currency: 'CAD' }),
      leg({ tradeDate: '2026-08-01', amountMinor: 740740, currency: 'USD', fxRate: 1.34 }),
    ]
    const summary = measureConversionCost({ transactions: [CAD_OUT, USD_IN, ...later] })

    expect(summary.conversions[0].tradeDate).toBe('2026-08-01')
  })

  it('says nothing when the ledger holds no conversions', () => {
    expect(measureConversionCost({ transactions: [leg({ action: 'BUY' })] })).toBeNull()
    expect(measureConversionCost({ transactions: [] })).toBeNull()
  })
})

// ─── Conversions bundled into a trade (#137) ──────────────────────────────────

/**
 * The RKLB purchase from the spec: $918.56 of stock, $1,317.40 debited in CAD,
 * Bank of Canada reference 1.393 for that day.
 *
 * Note on the spec's own figures: it quotes a 2.94% spread and $38.10 of cost.
 * Reusing measureConversion — which the issue requires — gives 2.958% and
 * $37.85. The 2.94% follows from dividing by the *rounded* effective rate
 * (1.434 / 1.393) rather than the real one, and $38.10 implies a reference of
 * 1.39272 rather than 1.393. The shared formula is the thing worth preserving,
 * so these assert what it produces.
 */
const RKLB = (overrides = {}) => ({
  id: 'buy-rklb',
  accountId: 'cash-1',
  action: 'BUY',
  tradeDate: '2026-08-12',
  symbol: 'RKLB',
  quantity: 8,
  priceCurrency: 'USD', // Independently established trade-price currency.
  priceMinor: 11482,      // 8 x $114.82 = $918.56 USD
  amountMinor: 131740,    // $1,317.40 CAD actually debited
  currency: 'CAD',
  fxRate: 1.393,
  ...overrides,
})

const usdInflow = (amountMinor, overrides = {}) => ({
  id: `in-${amountMinor}`,
  accountId: 'cash-1',
  action: 'SELL',
  tradeDate: '2026-08-01',
  quantity: 1,
  amountMinor,
  currency: 'USD',
  fxRate: 1.39,
  ...overrides,
})

const HISTORY = { 'cash-1': '2026-01-01' }

describe('runningCashBalances', () => {
  it('tracks the balance immediately before each row, per account', () => {
    const { balanceBefore } = runningCashBalances([
      usdInflow(100000),
      { ...RKLB(), currency: 'USD', amountMinor: 91856 },
    ], 'USD')

    expect(balanceBefore.get('in-100000')).toBe(0)
    expect(balanceBefore.get('buy-rklb')).toBe(100000)
  })

  it('keeps accounts separate and ignores other currencies', () => {
    const { closing } = runningCashBalances([
      usdInflow(100000),
      usdInflow(50000, { id: 'other', accountId: 'cash-2' }),
      usdInflow(9900, { id: 'cad', currency: 'CAD' }),
    ], 'USD')

    expect(closing.get('cash-1')).toBe(100000)
    expect(closing.get('cash-2')).toBe(50000)
  })
})

describe('tradeEmbeddedConversions', () => {
  it('produces no event when existing USD cash covers the purchase', () => {
    // A USD buy is not evidence of a conversion. An account holding the cash
    // pays out of it and converts nothing.
    const { events } = tradeEmbeddedConversions({
      transactions: [usdInflow(100000), RKLB()],
      historyStarts: HISTORY,
    })

    expect(events).toEqual([])
  })

  it('prices a purchase with no USD cash behind it, at the spec’s numbers', () => {
    const { events } = tradeEmbeddedConversions({ transactions: [RKLB()], historyStarts: HISTORY })
    const [priced] = events.map((event) => measureConversion(event))

    expect(priced.toAmountMinor).toBe(91856)     // USD used      $918.56
    expect(priced.fromAmountMinor).toBe(131740)  // CAD debited $1,317.40
    expect(priced.chargedRate).toBe(1.434201)    // effective rate    1.434
    expect(priced.midRate).toBe(1.393)           // reference rate    1.393
    expect(priced.spreadPct).toBe(2.958)
    expect(priced.costMinor).toBe(3785)
    expect(priced.source).toBe('trade-embedded')
  })

  it('sizes the conversion at the shortfall, not the whole purchase', () => {
    // Half-funded from existing cash converted half as much. Charging the
    // spread on the full purchase would overstate what the broker took.
    const { events } = tradeEmbeddedConversions({
      transactions: [usdInflow(50000), RKLB()],
      historyStarts: HISTORY,
    })
    const [priced] = events.map((event) => measureConversion(event))

    expect(priced.toAmountMinor).toBe(41856)
    expect(priced.fromAmountMinor).toBe(60030)
    expect(priced.costMinor).toBe(1725)
    // The rate is the broker's either way — only the amount converted changes.
    expect(priced.spreadPct).toBe(2.958)
  })

  it('excludes a trade whose prior balance cannot be established', () => {
    // Not zero and not "fully converted": cash held before the ledger begins is
    // invisible, and guessing either way invents or erases a real cost.
    const noHistory = tradeEmbeddedConversions({ transactions: [RKLB()], historyStarts: {} })
    const startsAfter = tradeEmbeddedConversions({
      transactions: [RKLB()], historyStarts: { 'cash-1': '2026-09-01' },
    })

    expect(noHistory.events).toEqual([])
    expect(noHistory.unpriced[0].reason).toBe('insufficient-history')
    expect(startsAfter.events).toEqual([])
  })

  it('refuses a trade with no reference rate rather than defaulting one', () => {
    const { events, unpriced } = tradeEmbeddedConversions({
      transactions: [RKLB({ fxRate: null })], historyStarts: HISTORY,
    })

    expect(events).toEqual([])
    expect(unpriced[0].reason).toBe('no-reference-rate')
  })

  it('ignores a purchase settled in its own currency', () => {
    // Currency mismatch is not the evidence, but a trade debited in the same
    // currency it was priced in has no CAD leg to measure a spread against.
    const { events } = tradeEmbeddedConversions({
      transactions: [RKLB({ currency: 'USD', amountMinor: 91856 })], historyStarts: HISTORY,
    })

    expect(events).toEqual([])
  })
})

describe('measureConversionCost — both kinds of evidence', () => {
  // Deliberately small: a conversion large enough to fund the later purchase
  // would leave nothing for the trade to convert, and the merge would have
  // nothing to merge. The engine is right to report one conversion then — this
  // fixture exists to exercise two.
  const explicitPair = [
    { id: 'fx-cad', accountId: 'cash-1', action: 'FX', tradeDate: '2026-07-01', amountMinor: 13400, currency: 'CAD', quantity: 0 },
    { id: 'fx-usd', accountId: 'cash-1', action: 'FX', tradeDate: '2026-07-01', amountMinor: 10000, currency: 'USD', quantity: 0, fxRate: 1.34 },
  ]

  it('merges explicit rows and trade-embedded conversions into one total', () => {
    const summary = measureConversionCost({
      transactions: [...explicitPair, RKLB()], historyStarts: HISTORY,
    })

    expect(summary.conversions).toHaveLength(2)
    expect(summary.conversions.map((c) => c.source).sort()).toEqual(['ledger-fx', 'trade-embedded'])
    expect(summary.totalCostMinor).toBe(
      summary.conversions.reduce((sum, c) => sum + c.costMinor, 0),
    )
  })

  it('does not count one real conversion twice', () => {
    // A broker that reports both an FX row and the trade it funded describes a
    // single conversion. The explicit row wins; the trade is not re-priced.
    const sameDayFx = explicitPair.map((row) => ({ ...row, tradeDate: '2026-08-12' }))
    const summary = measureConversionCost({
      transactions: [...sameDayFx, RKLB()], historyStarts: HISTORY,
    })

    expect(summary.conversions).toHaveLength(1)
    expect(summary.conversions[0].source).toBe('ledger-fx')
  })

  it('reports one conversion when an earlier one already funded the trade', () => {
    // $3,663 bought in July covers a $918.56 purchase in August. The purchase
    // converted nothing, and counting it would invent a second conversion.
    const large = [
      { id: 'fx-cad', accountId: 'cash-1', action: 'FX', tradeDate: '2026-07-01', amountMinor: 500000, currency: 'CAD', quantity: 0 },
      { id: 'fx-usd', accountId: 'cash-1', action: 'FX', tradeDate: '2026-07-01', amountMinor: 366300, currency: 'USD', quantity: 0, fxRate: 1.34 },
    ]
    const summary = measureConversionCost({ transactions: [...large, RKLB()], historyStarts: HISTORY })

    expect(summary.conversions).toHaveLength(1)
    expect(summary.conversions[0].source).toBe('ledger-fx')
  })

  it('still reports nothing when the ledger holds neither', () => {
    expect(measureConversionCost({ transactions: [usdInflow(100000)], historyStarts: HISTORY })).toBeNull()
  })
})

describe('FX evidence and record identity', () => {
  it('refuses an unverified unit-price currency instead of inventing a 1:1 conversion', () => {
    const trade = RKLB({ symbol: 'NVDA', quantity: 1, amountMinor: 24611, priceMinor: 24611, priceCurrency: undefined, fxRate: 1.393 })
    const result = measureConversionCost({ transactions: [trade], historyStarts: { [trade.accountId]: '2026-01-01' } })
    expect(result.conversions).toEqual([])
    expect(result.unpricedCount).toBe(1)
    expect(result.complete).toBe(false)
    expect(result.unpriced[0]).toMatchObject({ symbol: 'NVDA', reason: 'unverified-price-currency' })
  })

  it('does not count a verified CAD-priced CAD trade as a currency conversion', () => {
    expect(measureConversionCost({ transactions: [RKLB({ priceCurrency: 'CAD' })] })).toBeNull()
  })

  it('counts repeated stable identities once, retaining equal amounts in different accounts', () => {
    const first = [CAD_OUT, USD_IN]
    const second = first.map((row) => ({ ...row, accountId: 'cash-2' }))
    const result = measureConversionCost({ transactions: [...first, ...first, ...second] })
    expect(result.conversions).toHaveLength(2)
    expect(result.totalCostMinor).toBe(91575 * 2)
    expect(new Set(result.conversions.map((row) => row.accountId)).size).toBe(2)
  })

  it('retains separate same-day conversions with equal amounts and different identities', () => {
    const second = [CAD_OUT, USD_IN].map((row) => ({ ...row, id: `${row.id}-second` }))
    const result = measureConversionCost({ transactions: [CAD_OUT, USD_IN, ...second] })
    expect(result.conversions).toHaveLength(2)
    expect(new Set(result.conversions.map((row) => row.transactionId)).size).toBe(2)
  })

  it('does not relabel unsupported currencies as CAD/USD', () => {
    const result = conversionEventsFromLedger([leg({ currency: 'EUR' }), leg({ currency: 'JPY' })])
    expect(result.events).toHaveLength(0)
    expect(result.unpairable).toHaveLength(2)
  })

  it('preserves a verified below-reference result rather than clamping it to zero', () => {
    const result = measureConversionCost({ transactions: [leg({ amountMinor: 138000 }), leg({ currency: 'USD', amountMinor: 100000, fxRate: 1.39 })] })
    expect(result.totalCostMinor).toBe(-1000)
  })
})

describe('a Canadian security is not a conversion', () => {
  // A CAD-hedged CDR settles in CAD because it *is* Canadian. Reporting it as
  // needing currency details blames missing data for something that never
  // happened, and the holder is told to fix a gap that does not exist.
  const cdr = (overrides = {}) => ({
    id: 'nvda-cdr', accountId: 'a1', action: 'BUY', symbol: 'NVDA',
    tradeDate: '2026-08-12', quantity: 1, priceMinor: 24611, amountMinor: 24611,
    currency: 'CAD', securityCurrency: 'CAD', fxRate: 1.393, ...overrides,
  })
  const history = { a1: '2026-01-01' }

  it('does not list a CAD-settled Canadian security as unpriced', () => {
    const { events, unpriced } = tradeEmbeddedConversions({ transactions: [cdr()], historyStarts: history })

    expect(events).toEqual([])
    expect(unpriced).toEqual([])
  })

  it('still reports a US-listed security bought in CAD as missing evidence', () => {
    // Same settlement currency, different security. This one did convert, and
    // the record simply does not carry the US-dollar side of it.
    const { unpriced } = tradeEmbeddedConversions({
      transactions: [cdr({ id: 'rklb', symbol: 'RKLB', securityCurrency: 'USD' })],
      historyStarts: history,
    })

    expect(unpriced[0]).toMatchObject({ symbol: 'RKLB', reason: 'unverified-price-currency' })
  })

  it('leaves a ledger of only Canadian purchases with nothing to report', () => {
    expect(measureConversionCost({ transactions: [cdr()], historyStarts: history })).toBeNull()
  })
})
