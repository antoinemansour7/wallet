import { describe, it, expect } from 'vitest'
import { saleCounterfactuals, summarizeCounterfactuals, DIRECTION } from './saleCounterfactual'

const disposal = (overrides = {}) => ({
  transactionId: 'sell-1',
  accountId: 'cash-1',
  securityKey: 'isin:US67066G1040',
  symbol: 'NVDA',
  tradeDate: '2026-05-12',
  quantity: 40,
  proceedsMinor: 473600, // 40 x $118.40
  costRemovedMinor: 300000,
  gainMinor: 173600,
  ...overrides,
})

describe('saleCounterfactuals', () => {
  it('values the sold quantity at today’s price and states the difference', () => {
    // 40 x $310.58 = $12,423.20 against $4,736.00 received.
    const [result] = saleCounterfactuals({
      disposals: [disposal()],
      quotes: { NVDA: { price: 310.58, currency: 'CAD' } },
    })

    expect(result.wouldBeWorthMinor).toBe(1242320)
    expect(result.differenceMinor).toBe(768720)
    expect(result.direction).toBe(DIRECTION.HOLDING_HIGHER)
  })

  it('reports a sale that went well the same way', () => {
    // Not a guilt machine: selling before a fall is a decision that went well
    // and comes out of the same arithmetic.
    const [result] = saleCounterfactuals({
      disposals: [disposal()],
      quotes: { NVDA: { price: 50, currency: 'CAD' } },
    })

    expect(result.differenceMinor).toBe(200000 - 473600)
    expect(result.direction).toBe(DIRECTION.SELLING_HIGHER)
  })

  it('converts a foreign price before comparing it with Canadian proceeds', () => {
    // Proceeds are already CAD. Comparing an unconverted USD figure would
    // overstate the difference by roughly a third — the whole reported number.
    const [result] = saleCounterfactuals({
      disposals: [disposal()],
      quotes: { NVDA: { price: 200, currency: 'USD' } },
      usdCadRate: 1.35,
    })

    expect(result.wouldBeWorthMinor).toBe(1080000) // 40 x 200 x 1.35
  })

  it('says nothing rather than guessing when it cannot value the position', () => {
    const noQuote = saleCounterfactuals({ disposals: [disposal()], quotes: {} })
    const noRate = saleCounterfactuals({
      disposals: [disposal()],
      quotes: { NVDA: { price: 200, currency: 'USD' } },
      usdCadRate: null,
    })

    expect(noQuote).toEqual([])
    expect(noRate).toEqual([])
  })

  it('orders most recent decision first', () => {
    const results = saleCounterfactuals({
      disposals: [
        disposal({ tradeDate: '2026-01-10', transactionId: 'old' }),
        disposal({ tradeDate: '2026-07-01', transactionId: 'new' }),
      ],
      quotes: { NVDA: { price: 100, currency: 'CAD' } },
    })

    expect(results.map((r) => r.transactionId)).toEqual(['new', 'old'])
  })
})

describe('summarizeCounterfactuals', () => {
  it('nets both directions rather than only the unfavourable ones', () => {
    const results = saleCounterfactuals({
      disposals: [
        disposal({ symbol: 'NVDA', proceedsMinor: 100000, quantity: 10 }),
        disposal({ symbol: 'SHOP', proceedsMinor: 100000, quantity: 10, tradeDate: '2026-06-01' }),
      ],
      quotes: { NVDA: { price: 200, currency: 'CAD' }, SHOP: { price: 50, currency: 'CAD' } },
    })
    const summary = summarizeCounterfactuals(results)

    // NVDA +$1,000.00, SHOP -$500.00
    expect(summary.netDifferenceMinor).toBe(50000)
    expect(summary.holdingWouldBeHigher).toBe(1)
    expect(summary.sellingWasHigher).toBe(1)
  })

  it('carries the reinvestment limitation with the figure', () => {
    const summary = summarizeCounterfactuals(saleCounterfactuals({
      disposals: [disposal()], quotes: { NVDA: { price: 100, currency: 'CAD' } },
    }))
    expect(summary.excludesReinvestment).toBe(true)
  })

  it('says nothing when nothing could be compared', () => {
    expect(summarizeCounterfactuals([])).toBeNull()
  })
})
