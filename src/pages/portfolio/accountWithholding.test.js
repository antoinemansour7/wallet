import { describe, it, expect } from 'vitest'
import { accountWithholding, portfolioWithholding, accountTypeOf } from './accountPresentation'

const usHolding = (overrides = {}) => ({
  SYMBOL: 'VTI',
  DESCRIPTION: 'VANGUARD TOTAL STOCK MARKET ETF',
  'MARKET VALUE': '50000.00',
  'ACCOUNT CURRENCY': 'USD',
  'ACCOUNT TYPE': 'TFSA',
  ...overrides,
})

const account = (accountNumber, positions) => ({ accountNumber, positions })

const TFSA = account('tfsa-1', [usHolding()])
const RRSP = account('rrsp-1', [usHolding({ 'ACCOUNT TYPE': 'RRSP' })])
const CANADIAN = account('cash-1', [usHolding({
  SYMBOL: 'ENB.TO', DESCRIPTION: 'ENBRIDGE INC', 'ACCOUNT CURRENCY': 'CAD', 'ACCOUNT TYPE': 'NON_REGISTERED',
})])

const tax = (overrides = {}) => ({
  accountId: 'tfsa-1', accountType: 'TFSA', action: 'TAX',
  tradeDate: '2026-06-01', amountMinor: 4300, currency: 'USD', ...overrides,
})
const NOW = Date.parse('2026-09-06T00:00:00Z')

describe('accountTypeOf', () => {
  it('reads the registration type off the account rows', () => {
    expect(accountTypeOf(TFSA)).toBe('TFSA')
    expect(accountTypeOf(account('x', []))).toBeNull()
  })
})

describe('accountWithholding', () => {
  it('states the projected drag for a US holding in a TFSA, with the arithmetic', () => {
    const summary = accountWithholding(TFSA, { accounts: [TFSA] })

    // $50,000 x 1.3% x 15% = $97.50
    expect(summary.annualWithheldMinor).toBe(9750)
    expect(summary.basis).toBe('projected')
    expect(summary.recoverable).toBe(false)
    expect(summary.workings).toMatchObject({ marketValueMinor: 5000000, yieldPct: 1.3, withholdingRatePct: 15 })
    expect(summary.contributors).toEqual(['VTI'])
  })

  it('reports nothing withheld on the same holding in an RRSP', () => {
    expect(accountWithholding(RRSP, { accounts: [RRSP] }).annualWithheldMinor).toBe(0)
  })

  it('offers no comparison when the user holds no account that would differ', () => {
    // An RRSP column for someone without an RRSP is a recommendation to open one.
    expect(accountWithholding(TFSA, { accounts: [TFSA] }).comparison).toBeNull()
  })

  it('compares against an account type the user actually has', () => {
    const summary = accountWithholding(TFSA, { accounts: [TFSA, RRSP] })

    expect(summary.comparison).toEqual([{ accountType: 'RRSP', annualWithheldMinor: 0 }])
  })

  it('says nothing at all when no holding is affected', () => {
    expect(accountWithholding(CANADIAN, { accounts: [CANADIAN] })).toBeNull()
  })

  it('prefers a measured figure over the projection when the ledger has one', () => {
    const summary = accountWithholding(TFSA, { accounts: [TFSA], transactions: [tax()], now: NOW })

    expect(summary.basis).toBe('measured')
    expect(summary.annualWithheldMinor).toBe(4300)
    expect(summary.workings.recordCount).toBe(1)
  })

  it('keeps the projection for a fund whose tax is lost inside it', () => {
    // No record of in-fund withholding can exist against the account, so a
    // measured figure would silently replace a real cost with a smaller one.
    const inFund = account('tfsa-1', [usHolding({
      SYMBOL: 'VFV.TO', DESCRIPTION: 'VANGUARD S&P 500 INDEX ETF', 'ACCOUNT CURRENCY': 'CAD',
    })])
    const summary = accountWithholding(inFund, { accounts: [inFund], transactions: [tax()], now: NOW })

    expect(summary.unavoidable).toBe(true)
    expect(summary.basis).toBe('projected')
    expect(summary.comparison).toBeNull()
  })
})

describe('portfolioWithholding', () => {
  it('totals the drag across accounts for the Overview line', () => {
    expect(portfolioWithholding([TFSA, RRSP])).toMatchObject({
      annualWithheldMinor: 9750, basis: 'projected', accountCount: 1,
    })
  })

  it('reports a total containing any projection as projected', () => {
    // The weaker of the two bases is the honest label for a mixed total.
    const summary = portfolioWithholding([TFSA, account('other-1', [usHolding({ SYMBOL: 'SPY' })])], {
      transactions: [tax()], now: NOW,
    })

    expect(summary.basis).toBe('projected')
  })

  it('says nothing when no account has anything to report', () => {
    expect(portfolioWithholding([CANADIAN])).toBeNull()
    expect(portfolioWithholding([RRSP])).toBeNull()
    expect(portfolioWithholding([])).toBeNull()
  })
})
