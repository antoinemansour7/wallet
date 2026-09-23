import { describe, expect, it } from 'vitest'
import { buildOptionsChain, evaluateOpeningContractGates, OPTIONS_CHAIN_GATE_POLICY_VERSION } from './chainGates.js'

const TRADING_DATE = '2026-09-22'
const REGULAR_OPEN_AT = '2026-09-22T13:30:00.000Z'

function underlying({ marketAt = '2026-09-22T13:31:00.000Z', ageMs = 2000 } = {}) {
  return { quote: { bid: 99.9, ask: 100.1, marketAt, ageMs } }
}

function contract({
  expirationDate = '2026-10-16', // 24 DTE from trading date
  bid = 2, ask = 2.1, bidSize = 5, askSize = 5, quoteAgeMs = 5000, marketAt = '2026-09-22T13:31:02.000Z',
  openInterest = 200, openInterestDate = '2026-09-19', todayVolume = 10, priorVolume = null,
  delta = -0.35, analyticsAge = 'unknown',
} = {}) {
  return {
    rawId: 'raw-1', contractId: 'osi:EX261016C00100000', osiSymbol: 'EX261016C00100000', type: 'call',
    strikePrice: 100, expirationDate,
    quote: bid == null ? null : { bid, ask, bidSize, askSize, marketAt, ageMs: quoteAgeMs },
    trade: null,
    volume: { value: todayVolume, session: 'rth', sessionDate: TRADING_DATE },
    previousDailyBar: priorVolume == null ? null : { volume: priorVolume },
    openInterest: openInterest == null ? { value: null, asOfDate: null } : { value: openInterest, asOfDate: openInterestDate },
    analytics: { greeks: { delta }, age: analyticsAge },
    fetchedAt: '2026-09-22T13:31:31.000Z',
    rawReferenceHash: 'hash-1',
  }
}

function context(overrides = {}) {
  return { tradingDate: TRADING_DATE, regularOpenAt: REGULAR_OPEN_AT, underlying: underlying(), ...overrides }
}

describe('evaluateOpeningContractGates', () => {
  it('accepts a fresh, liquid, in-window contract and labels it primary', () => {
    const result = evaluateOpeningContractGates(contract(), context())
    expect(result).toMatchObject({ status: 'accepted', cohort: 'primary', dte: 24, absDelta: 0.35 })
  })

  it('rejects a zero/locked/crossed quote before checking anything else', () => {
    expect(evaluateOpeningContractGates(contract({ bid: 0 }), context())).toMatchObject({ status: 'rejected', reason: 'zero_bid' })
    expect(evaluateOpeningContractGates(contract({ bid: 2, ask: 2 }), context())).toMatchObject({ status: 'rejected', reason: 'locked_or_crossed_quote' })
    expect(evaluateOpeningContractGates(contract({ bid: 2.2, ask: 2.1 }), context())).toMatchObject({ status: 'rejected', reason: 'locked_or_crossed_quote' })
  })

  it('rejects a spread above the maximum and a premium below the minimum', () => {
    expect(evaluateOpeningContractGates(contract({ bid: 0.1, ask: 0.9 }), context())).toMatchObject({ status: 'rejected', reason: 'spread_above_maximum' })
    expect(evaluateOpeningContractGates(contract({ bid: 0.2, ask: 0.25 }), context())).toMatchObject({ status: 'rejected', reason: 'premium_below_minimum' })
  })

  it('rejects a stale contract quote, a stale underlying quote, and an excessive skew', () => {
    expect(evaluateOpeningContractGates(contract({ quoteAgeMs: 31000 }), context())).toMatchObject({ status: 'rejected', reason: 'stale_contract_quote' })
    expect(evaluateOpeningContractGates(contract(), context({ underlying: underlying({ ageMs: 11000 }) }))).toMatchObject({ status: 'rejected', reason: 'stale_underlying_quote' })
    const skewed = contract({ marketAt: '2026-09-22T13:31:00.000Z' })
    expect(evaluateOpeningContractGates(skewed, context({ underlying: underlying({ marketAt: '2026-09-22T13:31:15.000Z' }) })))
      .toMatchObject({ status: 'rejected', reason: 'quote_skew_exceeded' })
  })

  it('marks a quote timestamped before regular open as pending, not rejected', () => {
    const result = evaluateOpeningContractGates(contract({ marketAt: '2026-09-22T13:15:00.000Z' }), context({ underlying: underlying({ marketAt: '2026-09-22T13:15:05.000Z' }) }))
    expect(result).toMatchObject({ status: 'pending', reason: 'series_not_yet_open' })
  })

  it('rejects a contract outside the 7-60 calendar DTE window', () => {
    expect(evaluateOpeningContractGates(contract({ expirationDate: '2026-09-25' }), context())).toMatchObject({ status: 'rejected', reason: 'dte_outside_window' })
    expect(evaluateOpeningContractGates(contract({ expirationDate: '2026-12-01' }), context())).toMatchObject({ status: 'rejected', reason: 'dte_outside_window' })
  })

  it('rejects on missing or insufficient open interest', () => {
    expect(evaluateOpeningContractGates(contract({ openInterest: null }), context())).toMatchObject({ status: 'rejected', reason: 'open_interest_unavailable' })
    expect(evaluateOpeningContractGates(contract({ openInterest: 50 }), context())).toMatchObject({ status: 'rejected', reason: 'insufficient_open_interest' })
  })

  it('accepts on the prior-volume/current-quote fallback and rejects when neither volume rule is met', () => {
    expect(evaluateOpeningContractGates(contract({ todayVolume: 0, priorVolume: 150 }), context())).toMatchObject({ status: 'accepted' })
    expect(evaluateOpeningContractGates(contract({ todayVolume: 2, priorVolume: 10 }), context())).toMatchObject({ status: 'rejected', reason: 'insufficient_volume' })
  })

  it('rejects missing analytics and a delta outside the .15-.60 window, but accepts an untimestamped delta within it', () => {
    expect(evaluateOpeningContractGates(contract({ delta: null }), context())).toMatchObject({ status: 'rejected', reason: 'missing_analytics' })
    expect(evaluateOpeningContractGates(contract({ delta: 0.05 }), context())).toMatchObject({ status: 'rejected', reason: 'delta_outside_window' })
    const result = evaluateOpeningContractGates(contract({ delta: 0.4, analyticsAge: 'unknown' }), context())
    expect(result).toMatchObject({ status: 'accepted', analyticsAgeUnknown: true })
  })

  it('labels a contract outside the primary DTE/delta band as edge', () => {
    const result = evaluateOpeningContractGates(contract({ expirationDate: '2026-10-05', delta: 0.18 }), context())
    expect(result).toMatchObject({ status: 'accepted', cohort: 'edge' })
  })
})

describe('buildOptionsChain', () => {
  const security = { securityId: 'wallai:security:ex', issuerId: 'wallai:issuer:ex', ticker: 'EX' }

  it('splits contracts into accepted, rejected and pending, and carries enumeration rejections through', () => {
    const observation = {
      underlying: underlying(),
      contracts: [contract(), contract({ delta: null }), contract({ marketAt: '2026-09-22T13:15:00.000Z' })],
      rejected: [{ symbol: 'EX261016C00999000', reasons: ['nonstandard_deliverable'] }],
    }
    const chain = buildOptionsChain({ security, direction: 'call', tradingDate: TRADING_DATE, optionChainObservation: observation })
    expect(chain.contracts).toHaveLength(1)
    expect(chain.rejected).toHaveLength(2)
    expect(chain.rejected.find((r) => r.contractId === 'EX261016C00999000')).toMatchObject({ reason: 'nonstandard_deliverable' })
    expect(chain.pending).toHaveLength(1)
    expect(chain.underlying).toMatchObject({ securityId: security.securityId, direction: 'call' })
  })

  it('is deterministic given identical inputs', () => {
    const observation = { underlying: underlying(), contracts: [contract()], rejected: [] }
    const first = buildOptionsChain({ security, direction: 'call', tradingDate: TRADING_DATE, optionChainObservation: observation })
    const second = buildOptionsChain({ security, direction: 'call', tradingDate: TRADING_DATE, optionChainObservation: observation })
    expect(first).toEqual(second)
  })
})

describe('policy version', () => {
  it('is exported for versioning the gate/cohort policy in audit records', () => {
    expect(OPTIONS_CHAIN_GATE_POLICY_VERSION).toBe('options-opening-chain-gates-v1')
  })
})
