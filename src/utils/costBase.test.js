import { describe, it, expect } from 'vitest'
import { poolCostBase, isRegisteredAccount, PROVENANCE, INCOMPLETE_REASONS } from './costBase'

/** A ledger record, with the fields the pool actually reads. */
const tx = (overrides) => ({
  id: `t-${Math.random().toString(36).slice(2)}`,
  accountId: 'questrade-1',
  accountType: 'NON_REGISTERED',
  securityKey: 'isin:US67066G1040',
  securityKeyBasis: 'isin',
  symbol: 'NVDA',
  action: 'BUY',
  tradeDate: '2024-01-01',
  quantity: 1,
  priceMinor: 0,
  amountMinor: 0,
  feesMinor: 0,
  currency: 'CAD',
  fxRate: null,
  ...overrides,
})

describe('isRegisteredAccount', () => {
  it('recognises the registered types', () => {
    for (const type of ['TFSA', 'RRSP', 'RRIF', 'FHSA', 'RESP', 'LIRA', 'lif']) {
      expect(isRegisteredAccount(type)).toBe(true)
    }
  })

  it('treats an unknown or absent type as non-registered', () => {
    // An unmapped Plaid type or a statement import is far more likely to be a
    // cash account, and dropping real trades out of the pool understates the
    // cost base — the direction that costs someone money.
    expect(isRegisteredAccount('NON_REGISTERED')).toBe(false)
    expect(isRegisteredAccount(null)).toBe(false)
    expect(isRegisteredAccount('margin')).toBe(false)
  })
})

describe('poolCostBase — the multi-brokerage, multi-currency scenario', () => {
  // Hand-verified. NVDA in USD across two brokerages, VFV in CAD at one, and a
  // TFSA buy that must not reach either pool.
  //
  //  NVDA, converted at each trade's own rate:
  //    2024-03-01 Questrade    BUY  10 @ $800.00 USD + $4.95 fee, fx 1.35
  //                            80000 x 1.35 = 108000 ; 495 x 1.35 = 668.25 -> 668
  //                            ACB 108668, qty 10
  //    2024-06-15 Wealthsimple BUY   5 @ $500.00 USD, no fee,      fx 1.37
  //                            50000 x 1.37 = 68500
  //                            ACB 177168, qty 15
  //    2024-09-10 Questrade    SELL  6 @ $420.00 USD + $4.95 fee,  fx 1.36
  //                            42000 x 1.36 = 57120 ; 495 x 1.36 = 673.2 -> 673
  //                            proceeds 57120 - 673      = 56447
  //                            cost out  177168 x 6 / 15 = 70867.2 -> 70867
  //                            gain      56447 - 70867   = -14420
  //                            ACB 106301, qty 9
  //
  //  VFV, all CAD:
  //    2024-02-01 BUY 20 @ $2400.00 + $9.95 -> ACB 240995, qty 20
  //    2024-07-01 REINVEST 0.5 @ $60.00     -> ACB 246995, qty 20.5
  //    2024-08-01 ROC $25.00                -> ACB 244495, qty 20.5
  //                            per unit 244495 / 20.5 = 11926.58 -> 11927
  const ledger = [
    tx({
      id: 'n1', accountId: 'questrade-1', tradeDate: '2024-03-01', action: 'BUY',
      quantity: 10, amountMinor: 80000, feesMinor: 495, currency: 'USD', fxRate: 1.35,
    }),
    tx({
      id: 'n2', accountId: 'wealthsimple-1', tradeDate: '2024-06-15', action: 'BUY',
      quantity: 5, amountMinor: 50000, currency: 'USD', fxRate: 1.37,
    }),
    tx({
      id: 'n3', accountId: 'questrade-1', tradeDate: '2024-09-10', action: 'SELL',
      quantity: -6, amountMinor: 42000, feesMinor: 495, currency: 'USD', fxRate: 1.36,
    }),
    tx({
      id: 'n4', accountId: 'tfsa-1', accountType: 'TFSA', tradeDate: '2024-09-20', action: 'BUY',
      quantity: 3, amountMinor: 21600, currency: 'USD', fxRate: 1.36,
    }),
    tx({
      id: 'v1', accountId: 'questrade-1', securityKey: 'isin:CA92206K1066', symbol: 'VFV',
      tradeDate: '2024-02-01', action: 'BUY', quantity: 20, amountMinor: 240000, feesMinor: 995,
    }),
    tx({
      id: 'v2', accountId: 'questrade-1', securityKey: 'isin:CA92206K1066', symbol: 'VFV',
      tradeDate: '2024-07-01', action: 'REINVEST', quantity: 0.5, amountMinor: 6000,
    }),
    tx({
      id: 'v3', accountId: 'questrade-1', securityKey: 'isin:CA92206K1066', symbol: 'VFV',
      tradeDate: '2024-08-01', action: 'ROC', quantity: 0, amountMinor: 2500,
    }),
  ]

  const result = poolCostBase(ledger)
  const nvda = result.bySecurity.find((p) => p.symbol === 'NVDA')
  const vfv = result.bySecurity.find((p) => p.symbol === 'VFV')

  it('pools one security across two brokerages', () => {
    expect(nvda.quantity).toBe(9)
    expect(nvda.acbMinor).toBe(106301)
    expect(nvda.provenance).toBe(PROVENANCE.DERIVED)
  })

  it('converts each trade at the rate on its own trade date', () => {
    // Three different rates on three transactions. One rate applied to all of
    // them gives 106181 here, which is the number this test exists to reject.
    expect(nvda.acbMinor).toBe(108000 + 668 + 68500 - 70867)
  })

  it('reports the realised loss net of commission on both sides', () => {
    expect(nvda.realizedGainMinor).toBe(-14420)
    expect(nvda.disposals).toHaveLength(1)
    expect(nvda.disposals[0]).toMatchObject({
      quantity: 6, proceedsMinor: 56447, costRemovedMinor: 70867, gainMinor: -14420,
    })
  })

  it('keeps the TFSA buy out of the pool entirely', () => {
    // 3 more shares and $293.76 more cost, if registration were ignored.
    expect(nvda.quantity).toBe(9)
    expect(nvda.acbMinor).toBe(106301)
  })

  it('adds reinvested distributions and subtracts return of capital', () => {
    expect(vfv.acbMinor).toBe(244495)
    expect(vfv.quantity).toBe(20.5)
    expect(vfv.acbPerUnitMinor).toBe(11927)
  })

  it('reports every pool in Canadian dollars', () => {
    expect(result.currency).toBe('CAD')
    expect(nvda.currency).toBe('CAD')
  })
})

describe('poolCostBase — provenance', () => {
  it('refuses to compute a gain when more was sold than the ledger ever saw bought', () => {
    const result = poolCostBase([
      tx({ id: 's1', tradeDate: '2024-05-01', action: 'SELL', quantity: -5, amountMinor: 50000 }),
    ])

    expect(result.bySecurity[0].provenance).toBe(PROVENANCE.INCOMPLETE)
    expect(result.bySecurity[0].incompleteReasons).toContain(INCOMPLETE_REASONS.SOLD_MORE_THAN_SEEN)
    expect(result.bySecurity[0].realizedGainMinor).toBeNull()
  })

  it('refuses a foreign trade whose rate never resolved, rather than defaulting to 1', () => {
    // Treating an unresolved rate as 1 reports US dollars as Canadian ones —
    // a plausible number that is wrong by roughly a third.
    const result = poolCostBase([
      tx({ id: 'f1', action: 'BUY', quantity: 4, amountMinor: 40000, currency: 'USD', fxRate: null }),
    ])

    expect(result.bySecurity[0].provenance).toBe(PROVENANCE.INCOMPLETE)
    expect(result.bySecurity[0].incompleteReasons).toContain(INCOMPLETE_REASONS.UNRESOLVED_FX)
    expect(result.bySecurity[0].acbMinor).toBe(0)
  })

  it('marks a transferred-in position, whose cost base was never observed', () => {
    const result = poolCostBase([
      tx({ id: 'x1', action: 'TRANSFER', quantity: 12, amountMinor: 0 }),
      tx({ id: 'x2', tradeDate: '2024-06-01', action: 'SELL', quantity: -2, amountMinor: 30000 }),
    ])

    expect(result.bySecurity[0].incompleteReasons).toContain(INCOMPLETE_REASONS.TRANSFER_IN)
    expect(result.bySecurity[0].realizedGainMinor).toBeNull()
  })

  it('marks a pool whose security was already held when the account history began', () => {
    const result = poolCostBase(
      [tx({ id: 'h1', tradeDate: '2023-01-05', action: 'BUY', quantity: 3, amountMinor: 30000 })],
      { historyStartsAt: { 'questrade-1': '2024-09-04' } },
    )

    expect(result.bySecurity[0].incompleteReasons).toContain(INCOMPLETE_REASONS.PREDATES_HISTORY)
  })

  it('keeps an incomplete pool out of the portfolio realised-gain total', () => {
    const result = poolCostBase([
      tx({ id: 'g1', tradeDate: '2024-01-01', action: 'BUY', quantity: 10, amountMinor: 100000 }),
      tx({ id: 'g2', tradeDate: '2024-02-01', action: 'SELL', quantity: -10, amountMinor: 120000 }),
      tx({ id: 'b1', securityKey: 'sym:XYZ:TSX:CAD', symbol: 'XYZ', tradeDate: '2024-03-01', action: 'SELL', quantity: -1, amountMinor: 5000 }),
    ])

    expect(result.realizedGainMinor).toBe(20000)
  })

  it('records a symbol-based join as the weaker key it is', () => {
    const result = poolCostBase([
      tx({ id: 'k1', securityKey: 'sym:ABC:TSX:CAD', securityKeyBasis: 'isin', symbol: 'ABC', quantity: 1, amountMinor: 1000 }),
      tx({ id: 'k2', securityKey: 'sym:ABC:TSX:CAD', securityKeyBasis: 'symbol', symbol: 'ABC', tradeDate: '2024-02-01', quantity: 1, amountMinor: 1000 }),
    ])

    expect(result.bySecurity[0].securityKeyBasis).toBe('symbol')
  })
})

describe('poolCostBase — ordering', () => {
  it('applies a same-day buy before the sale it funded', () => {
    // Ordered the other way this trips the sold-more-than-seen guard and
    // reports no gain at all on a perfectly ordinary same-day round trip.
    const result = poolCostBase([
      tx({ id: 'z2', tradeDate: '2024-04-01', action: 'SELL', quantity: -5, amountMinor: 60000 }),
      tx({ id: 'z1', tradeDate: '2024-04-01', action: 'BUY', quantity: 5, amountMinor: 50000 }),
    ])

    expect(result.bySecurity[0].provenance).toBe(PROVENANCE.DERIVED)
    expect(result.bySecurity[0].realizedGainMinor).toBe(10000)
    expect(result.bySecurity[0].quantity).toBe(0)
  })

  it('leaves cost unchanged and lowers cost per unit on a split', () => {
    const result = poolCostBase([
      tx({ id: 'p1', action: 'BUY', quantity: 10, amountMinor: 100000 }),
      tx({ id: 'p2', tradeDate: '2024-02-01', action: 'SPLIT', quantity: 10, amountMinor: 0 }),
    ])

    expect(result.bySecurity[0].acbMinor).toBe(100000)
    expect(result.bySecurity[0].quantity).toBe(20)
    expect(result.bySecurity[0].acbPerUnitMinor).toBe(5000)
  })

  it('ignores dividends and standalone fees, which are not cost-base events', () => {
    const result = poolCostBase([
      tx({ id: 'd0', action: 'BUY', quantity: 10, amountMinor: 100000 }),
      tx({ id: 'd1', tradeDate: '2024-02-01', action: 'DIVIDEND', quantity: 0, amountMinor: 4200 }),
      tx({ id: 'd2', tradeDate: '2024-03-01', action: 'FEE', quantity: 0, amountMinor: 995 }),
    ])

    expect(result.bySecurity[0].acbMinor).toBe(100000)
  })
})
