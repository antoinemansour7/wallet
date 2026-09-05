import { describe, it, expect } from 'vitest'
import { poolCostBase } from './costBase'
import { detectSuperficialLosses, WINDOW_DAYS } from './superficialLoss'

const KEY = 'isin:US67066G1040'

const tx = (overrides) => ({
  id: `t-${Math.random().toString(36).slice(2)}`,
  accountId: 'questrade-1',
  accountType: 'NON_REGISTERED',
  securityKey: KEY,
  securityKeyBasis: 'isin',
  symbol: 'NVDA',
  action: 'BUY',
  tradeDate: '2024-01-01',
  quantity: 1,
  amountMinor: 0,
  feesMinor: 0,
  currency: 'CAD',
  fxRate: null,
  ...overrides,
})

/** The disposal shape poolCostBase emits, without re-deriving it each time. */
const disposal = (overrides) => ({
  transactionId: 'sell-1',
  accountId: 'questrade-1',
  securityKey: KEY,
  symbol: 'NVDA',
  tradeDate: '2024-09-10',
  quantity: 6,
  proceedsMinor: 56447,
  costRemovedMinor: 70867,
  gainMinor: -14420,
  ...overrides,
})

describe('detectSuperficialLosses', () => {
  it('denies part of a loss bought back inside a TFSA', () => {
    // The asymmetry that matters: the TFSA can never produce a capital gain of
    // its own, and buying back in it still denies the loss taken in the cash
    // account. Continues the hand-verified scenario in costBase.test.js —
    // 6 sold at a $144.20 loss, 3 bought back, so half the loss is denied.
    const transactions = [
      tx({ tradeDate: '2024-03-01', quantity: 10 }),
      tx({ tradeDate: '2024-06-15', accountId: 'wealthsimple-1', quantity: 5 }),
      tx({ tradeDate: '2024-09-10', action: 'SELL', quantity: -6 }),
      tx({ tradeDate: '2024-09-20', accountId: 'tfsa-1', accountType: 'TFSA', quantity: 3 }),
    ]

    const [candidate] = detectSuperficialLosses({ transactions, disposals: [disposal()] })

    expect(candidate.window).toEqual({ start: '2024-08-11', end: '2024-10-10', days: 61 })
    expect(candidate.acquiredQuantity).toBe(3)
    expect(candidate.heldAtWindowEnd).toBe(12)
    expect(candidate.deniedQuantity).toBe(3)
    expect(candidate.deniedMinor).toBe(7210)
    expect(candidate.partial).toBe(true)
    expect(candidate.repurchases[0].accountType).toBe('TFSA')
  })

  it('catches a repurchase before the sale, not only after it', () => {
    // The half people forget. The window opens 30 days *before* the
    // disposition, so buying first and selling at a loss second is caught too.
    const transactions = [
      tx({ tradeDate: '2024-01-01', quantity: 10 }),
      tx({ tradeDate: '2024-08-20', quantity: 6 }),
      tx({ tradeDate: '2024-09-10', action: 'SELL', quantity: -6 }),
    ]

    const [candidate] = detectSuperficialLosses({ transactions, disposals: [disposal()] })

    expect(candidate.repurchases).toHaveLength(1)
    expect(candidate.repurchases[0].tradeDate).toBe('2024-08-20')
    expect(candidate.deniedMinor).toBe(14420)
    expect(candidate.partial).toBe(false)
  })

  it('does not flag a loss where nothing was bought back', () => {
    const transactions = [
      tx({ tradeDate: '2024-03-01', quantity: 10 }),
      tx({ tradeDate: '2024-09-10', action: 'SELL', quantity: -6 }),
    ]

    expect(detectSuperficialLosses({ transactions, disposals: [disposal()] })).toEqual([])
  })

  it('does not flag a repurchase that was itself sold before the window closed', () => {
    // The third condition of the rule: the property has to still be held when
    // the window ends. A full exit inside the window is a real loss.
    const transactions = [
      tx({ tradeDate: '2024-03-01', quantity: 10 }),
      tx({ tradeDate: '2024-09-10', action: 'SELL', quantity: -10 }),
      tx({ tradeDate: '2024-09-20', quantity: 4 }),
      tx({ tradeDate: '2024-10-01', action: 'SELL', quantity: -4 }),
    ]

    const candidates = detectSuperficialLosses({
      transactions,
      disposals: [disposal({ quantity: 10 })],
    })

    expect(candidates).toEqual([])
  })

  it('never flags a disposition at a gain', () => {
    const transactions = [
      tx({ tradeDate: '2024-03-01', quantity: 10 }),
      tx({ tradeDate: '2024-09-10', action: 'SELL', quantity: -6 }),
      tx({ tradeDate: '2024-09-20', quantity: 6 }),
    ]

    expect(detectSuperficialLosses({ transactions, disposals: [disposal({ gainMinor: 5000 })] })).toEqual([])
  })

  it('treats the thirtieth day as inside the window and the thirty-first as outside', () => {
    const held = tx({ tradeDate: '2024-03-01', quantity: 10 })
    const sale = tx({ tradeDate: '2024-09-10', action: 'SELL', quantity: -6 })

    const onBoundary = detectSuperficialLosses({
      transactions: [held, sale, tx({ tradeDate: '2024-10-10', quantity: 6 })],
      disposals: [disposal()],
    })
    const pastBoundary = detectSuperficialLosses({
      transactions: [held, sale, tx({ tradeDate: '2024-10-11', quantity: 6 })],
      disposals: [disposal()],
    })

    expect(WINDOW_DAYS).toBe(30)
    expect(onBoundary).toHaveLength(1)
    expect(pastBoundary).toEqual([])
  })

  it('counts a reinvested distribution as buying the property back', () => {
    const transactions = [
      tx({ tradeDate: '2024-03-01', quantity: 10 }),
      tx({ tradeDate: '2024-09-10', action: 'SELL', quantity: -6 }),
      tx({ tradeDate: '2024-09-25', action: 'REINVEST', quantity: 2 }),
    ]

    const [candidate] = detectSuperficialLosses({ transactions, disposals: [disposal()] })

    expect(candidate.deniedQuantity).toBe(2)
    expect(candidate.deniedMinor).toBe(4807) // round(14420 x 2 / 6)
  })

  it('says on every candidate what it cannot see', () => {
    // The caveat rides on the number rather than sitting once in the UI: the
    // window also covers a spouse's accounts and any brokerage never connected.
    const transactions = [
      tx({ tradeDate: '2024-03-01', quantity: 10 }),
      tx({ tradeDate: '2024-09-10', action: 'SELL', quantity: -6 }),
      tx({ tradeDate: '2024-09-20', quantity: 3 }),
    ]

    const [candidate] = detectSuperficialLosses({ transactions, disposals: [disposal()] })

    expect(candidate.reviewRequired).toBe(true)
    expect(candidate.unseenAccountsCaveat).toMatch(/spouse/i)
  })

  it('is a pure read that never alters the pool it was given', () => {
    const transactions = [
      tx({ tradeDate: '2024-03-01', quantity: 10, amountMinor: 100000 }),
      tx({ tradeDate: '2024-09-10', action: 'SELL', quantity: -6, amountMinor: 40000 }),
      tx({ tradeDate: '2024-09-20', quantity: 3, amountMinor: 30000 }),
    ]
    const pooled = poolCostBase(transactions)
    const before = pooled.bySecurity[0].acbMinor

    detectSuperficialLosses({ transactions, disposals: pooled.disposals })

    expect(pooled.bySecurity[0].acbMinor).toBe(before)
    expect(poolCostBase(transactions).bySecurity[0].acbMinor).toBe(before)
  })

  it('works end to end from a pooled ledger', () => {
    const transactions = [
      tx({ tradeDate: '2024-03-01', quantity: 10, amountMinor: 100000 }),
      tx({ tradeDate: '2024-09-10', action: 'SELL', quantity: -4, amountMinor: 30000 }),
      tx({ tradeDate: '2024-09-15', accountId: 'rrsp-1', accountType: 'RRSP', quantity: 4, amountMinor: 30000 }),
    ]

    const pooled = poolCostBase(transactions)
    // 10 bought for 100000; 4 sold for 30000 against cost 40000 -> -10000.
    expect(pooled.bySecurity[0].realizedGainMinor).toBe(-10000)

    const [candidate] = detectSuperficialLosses({ transactions, disposals: pooled.disposals })
    expect(candidate.deniedMinor).toBe(10000)
    expect(candidate.repurchases[0].accountType).toBe('RRSP')
  })
})
