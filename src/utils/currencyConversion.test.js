import { describe, it, expect } from 'vitest'
import {
  GAMBIT_MINIMUM_CAD,
  brokerProfile,
  conversionComparison,
  accountConversionExposure,
  describeConversion,
} from './currencyConversion'

const usHolding = (value, overrides = {}) => ({
  SYMBOL: 'VTI',
  DESCRIPTION: 'VANGUARD TOTAL STOCK MARKET ETF',
  'MARKET VALUE': String(value),
  'ACCOUNT CURRENCY': 'USD',
  ...overrides,
})

const caHolding = (value) => ({
  SYMBOL: 'RY.TO',
  DESCRIPTION: 'ROYAL BANK OF CANADA',
  'MARKET VALUE': String(value),
  'ACCOUNT CURRENCY': 'CAD',
})

describe('brokerProfile', () => {
  it('recognises a broker from its Plaid source id', () => {
    expect(brokerProfile('plaid:questrade')).toMatchObject({ key: 'questrade', name: 'Questrade' })
  })

  it('falls back to a generic profile for a broker it does not know', () => {
    const profile = brokerProfile('plaid:some-new-broker')
    expect(profile.key).toBe('generic')
    // The steps must not claim to be that broker's steps.
    expect(profile.stepsAreGeneric).toBe(true)
  })

  it('falls back for a statement import, which names no broker', () => {
    expect(brokerProfile('file:march-statement').key).toBe('generic')
    expect(brokerProfile(null).key).toBe('generic')
  })

  it('knows that some brokers convert at near-spot, where the technique saves nothing', () => {
    // Interactive Brokers converts at roughly institutional spread. Suggesting
    // a multi-day workaround to save nothing would discredit the whole feature.
    expect(brokerProfile('plaid:interactive-brokers').gambitWorthwhile).toBe(false)
  })
})

describe('conversionComparison', () => {
  it('states the saving in dollars for the amount actually being converted', () => {
    const result = conversionComparison({ amountCad: 50000, sourceId: 'plaid:questrade' })

    // Broker spread on 50,000 at 1.5% is 750.
    expect(result.brokerCostMinor).toBe(75000)
    // The gambit costs the bid-ask spread plus two commissions, not a flat
    // percentage — which is exactly why it stops paying on small amounts.
    expect(result.gambitCostMinor).toBeLessThan(15000)
    expect(result.savingMinor).toBe(result.brokerCostMinor - result.gambitCostMinor)
    expect(result.savingMinor).toBeGreaterThan(60000)
  })

  it('scales with the amount rather than quoting a generic percentage', () => {
    const small = conversionComparison({ amountCad: 10000, sourceId: 'plaid:questrade' })
    const large = conversionComparison({ amountCad: 100000, sourceId: 'plaid:questrade' })
    expect(large.savingMinor).toBeGreaterThan(small.savingMinor * 5)
  })

  it('carries the arithmetic so the screen can show its working', () => {
    const result = conversionComparison({ amountCad: 50000, sourceId: 'plaid:questrade' })
    expect(result.workings).toMatchObject({
      amountMinor: 5000000,
      brokerSpreadPct: expect.any(Number),
      bidAskPct: expect.any(Number),
      commissionMinor: expect.any(Number),
      legs: 2,
    })
  })

  describe('says nothing when there is nothing to say', () => {
    it('returns null below the amount where the effort stops paying', () => {
      expect(conversionComparison({ amountCad: 1000, sourceId: 'plaid:questrade' })).toBeNull()
      expect(conversionComparison({ amountCad: GAMBIT_MINIMUM_CAD - 1, sourceId: 'plaid:questrade' })).toBeNull()
    })

    it('returns null for a broker that already converts at near-spot', () => {
      expect(conversionComparison({ amountCad: 50000, sourceId: 'plaid:interactive-brokers' })).toBeNull()
    })

    it('returns null for a nonsensical amount', () => {
      expect(conversionComparison({ amountCad: 0, sourceId: 'plaid:questrade' })).toBeNull()
      expect(conversionComparison({ amountCad: -5000, sourceId: 'plaid:questrade' })).toBeNull()
    })
  })
})

describe('accountConversionExposure', () => {
  it('finds a CAD account holding US-listed securities, converting them to CAD', () => {
    const account = {
      currency: 'CAD',
      positions: [usHolding(30000), caHolding(20000), usHolding(20000)],
    }
    // The US rows are priced in USD. Summing them as if they were Canadian
    // dollars would understate the conversion by roughly a third.
    const exposure = accountConversionExposure(account, { usdCadRate: 1.35 })
    expect(exposure.amountCad).toBe(67500)
    expect(exposure.holdings).toHaveLength(2)
  })

  it('does not convert a row that never said it was in US dollars', () => {
    // A row with no recorded currency is added as-is rather than multiplied by
    // the rate on a guess. Note the classifier treats an explicit CAD currency
    // as a Canadian listing, so a US stock a broker reports in CAD is missed
    // entirely — a gap that needs real listing data (#88), not a currency guess.
    const account = {
      currency: 'CAD',
      positions: [usHolding(50000, { 'ACCOUNT CURRENCY': '' })],
    }
    expect(accountConversionExposure(account, { usdCadRate: 1.35 }).amountCad).toBe(50000)
  })

  it('refuses to size the conversion when USD rows have no rate to convert with', () => {
    // A number that is wrong by the exchange rate is worse than no number,
    // because the whole point of this feature is a figure someone can check
    // against their own account.
    const account = { currency: 'CAD', positions: [usHolding(50000)] }
    expect(accountConversionExposure(account, { usdCadRate: null })).toBeNull()
    expect(accountConversionExposure(account)).toBeNull()
  })

  it('ignores Canadian holdings, which need no conversion', () => {
    const account = { currency: 'CAD', positions: [caHolding(50000)] }
    expect(accountConversionExposure(account, { usdCadRate: 1.35 })).toBeNull()
  })

  it('ignores a Canadian-listed fund of US equities — it is bought in CAD', () => {
    // VFV holds US stocks but trades in CAD, so buying it converts nothing.
    // Flagging it would send someone through a conversion they never make.
    const account = {
      currency: 'CAD',
      positions: [{ SYMBOL: 'VFV.TO', DESCRIPTION: 'VANGUARD S&P 500 INDEX ETF', 'MARKET VALUE': '50000', 'ACCOUNT CURRENCY': 'CAD' }],
    }
    expect(accountConversionExposure(account, { usdCadRate: 1.35 })).toBeNull()
  })

  it('ignores a USD-denominated account, which already holds US dollars', () => {
    const account = { currency: 'USD', positions: [usHolding(50000)] }
    expect(accountConversionExposure(account, { usdCadRate: 1.35 })).toBeNull()
  })

  it('returns null for an empty account', () => {
    expect(accountConversionExposure({ currency: 'CAD', positions: [] }, { usdCadRate: 1.35 })).toBeNull()
    expect(accountConversionExposure(null)).toBeNull()
  })
})

describe('describeConversion', () => {
  const result = () => conversionComparison({ amountCad: 50000, sourceId: 'plaid:questrade' })

  it('names the saving and the broker', () => {
    const text = describeConversion(result())
    expect(text).toMatch(/\$6\d\d/)
    expect(text).toMatch(/Questrade/)
  })

  it('says the saving is on the spread, not a guaranteed amount', () => {
    // The rate moves between the two legs. A number presented as certain
    // would be the one thing people remember when it lands differently.
    expect(describeConversion(result())).toMatch(/rate can move|not guaranteed|between the two/i)
  })

  it('describes the mechanic without pitching the instrument', () => {
    // DLR is the tool the technique uses. The page must not read as a reason
    // to own it — that would be a recommendation to buy a specific security.
    const forbidden = /\b(invest in DLR|DLR is a good|recommend DLR|great investment|buy DLR for the|hold DLR long)/i
    expect(describeConversion(result())).not.toMatch(forbidden)
  })

  it('gives the steps for that broker when they are known', () => {
    const steps = describeConversion(result(), { includeSteps: true })
    expect(steps).toMatch(/journal/i)
  })

  it('does not present generic steps as though they were the broker’s own', () => {
    const generic = conversionComparison({ amountCad: 50000, sourceId: 'plaid:some-new-broker' })
    const text = describeConversion(generic, { includeSteps: true })
    // Getting the steps wrong is the thing that makes people abandon this
    // halfway through, so an unknown broker has to say it is unverified.
    expect(text).toMatch(/confirm|vary|check with/i)
  })

  it('returns nothing for nothing', () => {
    expect(describeConversion(null)).toBe('')
  })
})
