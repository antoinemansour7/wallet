import { describe, it, expect } from 'vitest'
import { estimateWealthsimpleFxFees } from './conversionCost'
const buy = (overrides = {}) => ({ id: 'rklb-1', source: 'plaid', accountId: 'tfsa', institution: 'Wealthsimple (Canada)', accountBalanceCurrency: 'CAD', action: 'BUY', tradeDate: '2026-08-12', symbol: 'RKLB', currency: 'USD', amountMinor: 91856, fxRate: 1.393, ...overrides })

describe('Wealthsimple fee estimate', () => {
  it('uses the published gross-up formula and carries the funding condition', () => {
    const result = estimateWealthsimpleFxFees({ transactions: [buy(), buy({ id: 'rklb-2', tradeDate: '2026-08-10', amountMinor: 103533, fxRate: 1.3942 })], year: 2026 })
    expect(result.totalCostMinor).toBe(4147)
    expect(result.purchases.map(p => p.estimatedCostMinor)).toEqual([1949, 2198])
    expect(result.basis).toBe('broker-fee-estimate')
    expect(result.assumption).toContain('funded entirely from CAD')
    expect(result.assumption).toContain('existing USD cash')
  })
  it.each([{ accountBalanceCurrency: 'USD' }, { accountBalanceCurrency: null }, { institution: 'Other broker' }, { currency: 'CAD' }, { fxRate: null }])('does not infer a fee for unsupported records: %j', (changes) => {
    expect(estimateWealthsimpleFxFees({ transactions: [buy(changes)] })).toBeNull()
  })
  it('does not duplicate provider IDs, measured conversions, or include future dates', () => {
    const t = buy()
    expect(estimateWealthsimpleFxFees({ transactions: [t, t] }).purchases).toHaveLength(1)
    expect(estimateWealthsimpleFxFees({ transactions: [t], asOf: '2026-08-01' })).toBeNull()
    expect(estimateWealthsimpleFxFees({ transactions: [t], year: 2025 })).toBeNull()
    expect(estimateWealthsimpleFxFees({ transactions: [t], measured: { conversions: [{ accountId: t.accountId, tradeDate: t.tradeDate }] } })).toBeNull()
  })
})
