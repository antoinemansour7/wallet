import { describe, it, expect } from 'vitest'
import { conversionEventsFromLedger, measureConversion, measureConversionCost } from './conversionCost'

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
