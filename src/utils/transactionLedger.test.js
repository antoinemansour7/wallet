import { describe, it, expect } from 'vitest'
import { ACTIONS, transactionIdFor, normalizeTransaction } from './transactionLedger'

const plaidRaw = {
  investment_transaction_id: 'abc123',
  account_id: 'plaidAcct1',
  date: '2026-03-14',
  type: 'buy',
  quantity: 10,
  price: 143.29,
  amount: 1432.9,
  fees: 4.95,
  iso_currency_code: 'USD',
}

const security = { isin: 'US9229087690', symbol: 'VTI', exchange: 'NYSE', currency: 'USD' }

describe('transactionIdFor', () => {
  it('uses Plaid’s own id, which is stable across pulls', () => {
    expect(transactionIdFor({ source: 'plaid', sourceId: 'abc123' })).toBe('plaid:abc123')
  })

  it('content-addresses a manual entry so re-importing the same row is a no-op', () => {
    const row = {
      source: 'manual',
      accountId: 'acct1',
      tradeDate: '2026-03-14',
      securityKey: 'isin:US9229087690',
      action: ACTIONS.BUY,
      quantity: 10,
      amountMinor: 143290,
    }

    expect(transactionIdFor(row)).toBe(transactionIdFor({ ...row }))
    expect(transactionIdFor(row)).toMatch(/^manual:[0-9a-f]+$/)
  })

  it('gives different ids to entries that differ in any identifying field', () => {
    const base = {
      source: 'manual',
      accountId: 'acct1',
      tradeDate: '2026-03-14',
      securityKey: 'isin:US9229087690',
      action: ACTIONS.BUY,
      quantity: 10,
      amountMinor: 143290,
    }
    const id = transactionIdFor(base)

    expect(transactionIdFor({ ...base, accountId: 'acct2' })).not.toBe(id)
    expect(transactionIdFor({ ...base, tradeDate: '2026-03-15' })).not.toBe(id)
    expect(transactionIdFor({ ...base, action: ACTIONS.SELL })).not.toBe(id)
    expect(transactionIdFor({ ...base, quantity: 11 })).not.toBe(id)
    expect(transactionIdFor({ ...base, amountMinor: 143291 })).not.toBe(id)
  })

  it('does not collide two same-day trades that differ only in quantity', () => {
    // Buying twice in one day at the same price is ordinary, and the two rows
    // must not content-address to the same document.
    const base = { source: 'manual', accountId: 'a', tradeDate: '2026-03-14', securityKey: 'k', action: ACTIONS.BUY }
    expect(transactionIdFor({ ...base, quantity: 5, amountMinor: 100 }))
      .not.toBe(transactionIdFor({ ...base, quantity: 6, amountMinor: 120 }))
  })
})

describe('normalizeTransaction', () => {
  it('turns a Plaid investment transaction into a ledger record', () => {
    const record = normalizeTransaction(plaidRaw, { source: 'plaid', security, accountId: 'acct1', accountType: 'NON_REGISTERED' })

    expect(record).toMatchObject({
      id: 'plaid:abc123',
      accountId: 'acct1',
      accountType: 'NON_REGISTERED',
      securityKey: 'isin:US9229087690',
      securityKeyBasis: 'isin',
      symbol: 'VTI',
      action: ACTIONS.BUY,
      tradeDate: '2026-03-14',
      quantity: 10,
      priceMinor: 14329,
      amountMinor: 143290,
      feesMinor: 495,
      currency: 'USD',
      source: 'plaid',
    })
  })

  it('leaves the FX rate null rather than defaulting it to 1', () => {
    // Defaulting to 1 silently reports a USD trade as if it were CAD. The
    // gap has to stay visible so the figure downstream can be labelled.
    const record = normalizeTransaction(plaidRaw, { source: 'plaid', security, accountId: 'acct1' })
    expect(record.fxRate).toBeNull()
    expect(record.fxRateSource).toBeNull()
  })

  it('keeps a supplied FX rate and its provenance', () => {
    const record = normalizeTransaction(plaidRaw, {
      source: 'plaid',
      security,
      accountId: 'acct1',
      fx: { rate: 1.3542, source: 'boc-noon', asOf: '2026-03-14' },
    })
    expect(record).toMatchObject({ fxRate: 1.3542, fxRateSource: 'boc-noon', fxAsOf: '2026-03-14' })
  })

  describe('action mapping', () => {
    const cases = [
      ['buy', ACTIONS.BUY],
      ['sell', ACTIONS.SELL],
      ['dividend', ACTIONS.DIVIDEND],
      ['cash', ACTIONS.DIVIDEND],
      ['fee', ACTIONS.FEE],
      ['transfer', ACTIONS.TRANSFER],
      // Withholding arrives as its own record. Before TAX existed these failed
      // to classify and were dropped, so the ledger kept the gross dividend and
      // no trace of the tax — the one figure #17 stage 2 has to measure.
      ['tax', ACTIONS.TAX],
      ['tax withholding', ACTIONS.TAX],
    ]

    it.each(cases)('maps Plaid subtype %s', (subtype, expected) => {
      const record = normalizeTransaction({ ...plaidRaw, subtype }, { source: 'plaid', security, accountId: 'a' })
      expect(record.action).toBe(expected)
    })

    it('rejects a transaction whose action it cannot classify', () => {
      // Guessing here would book an unknown movement as a buy and corrupt the
      // cost base for that security.
      const record = normalizeTransaction({ ...plaidRaw, type: 'wat', subtype: 'wat' }, { source: 'plaid', security, accountId: 'a' })
      expect(record).toBeNull()
    })
  })

  describe('sign conventions', () => {
    it('records a sale with negative quantity regardless of how the source signed it', () => {
      const sold = normalizeTransaction({ ...plaidRaw, type: 'sell', quantity: 10 }, { source: 'plaid', security, accountId: 'a' })
      expect(sold.quantity).toBe(-10)
    })

    it('does not double-negate a source that already signed the sale', () => {
      const sold = normalizeTransaction({ ...plaidRaw, type: 'sell', quantity: -10 }, { source: 'plaid', security, accountId: 'a' })
      expect(sold.quantity).toBe(-10)
    })

    it('keeps a purchase positive', () => {
      const bought = normalizeTransaction({ ...plaidRaw, type: 'buy', quantity: -10 }, { source: 'plaid', security, accountId: 'a' })
      expect(bought.quantity).toBe(10)
    })
  })

  describe('refusals', () => {
    it('refuses a transaction with no identifiable security', () => {
      expect(normalizeTransaction(plaidRaw, { source: 'plaid', security: {}, accountId: 'a' })).toBeNull()
    })

    it('refuses a transaction with no usable trade date', () => {
      // Every Canadian rule in this epic keys off the trade date. Without one
      // the record cannot participate in any calculation it exists for.
      expect(normalizeTransaction({ ...plaidRaw, date: '' }, { source: 'plaid', security, accountId: 'a' })).toBeNull()
      expect(normalizeTransaction({ ...plaidRaw, date: 'not-a-date' }, { source: 'plaid', security, accountId: 'a' })).toBeNull()
    })

    it('refuses a transaction with no account', () => {
      expect(normalizeTransaction(plaidRaw, { source: 'plaid', security })).toBeNull()
    })

    it('defaults missing fees to zero, which is a real value here', () => {
      const record = normalizeTransaction({ ...plaidRaw, fees: null }, { source: 'plaid', security, accountId: 'a' })
      expect(record.feesMinor).toBe(0)
    })
  })

  it('is idempotent: normalising the same Plaid row twice yields the same id', () => {
    const first = normalizeTransaction(plaidRaw, { source: 'plaid', security, accountId: 'acct1' })
    const second = normalizeTransaction(plaidRaw, { source: 'plaid', security, accountId: 'acct1' })
    expect(first.id).toBe(second.id)
  })
})

describe('cash rows carry no security', () => {
  // Withholding tax and a currency conversion are cash movements: Plaid sends
  // them with a null security_id. Requiring a resolvable security before
  // looking at the action dropped every one of them, which made the TAX and FX
  // actions unreachable and every figure measured from them permanently empty.
  const cash = (subtype) => ({
    investment_transaction_id: `t-${subtype}`,
    subtype,
    date: '2026-05-12',
    amount: 43.21,
    quantity: 0,
    iso_currency_code: 'USD',
  })

  it('keeps a withholding-tax row that names no security', () => {
    const record = normalizeTransaction(cash('tax'), { source: 'plaid', security: null, accountId: 'a1' })

    expect(record).not.toBeNull()
    expect(record.action).toBe(ACTIONS.TAX)
    expect(record.securityKey).toBeNull()
    expect(record.amountMinor).toBe(4321)
  })

  it('keeps a currency-conversion row that names no security', () => {
    const record = normalizeTransaction(cash('currency exchange'), { source: 'plaid', security: null, accountId: 'a1' })

    expect(record?.action).toBe(ACTIONS.FX)
    expect(record.securityKey).toBeNull()
  })

  it('still refuses a trade with no identifiable security', () => {
    // A buy without a security cannot be pooled and must not become a cost
    // base entry keyed on nothing.
    expect(normalizeTransaction(cash('buy'), { source: 'plaid', security: null, accountId: 'a1' })).toBeNull()
    expect(normalizeTransaction(cash('sell'), { source: 'plaid', security: null, accountId: 'a1' })).toBeNull()
  })

  it('keeps the security when a cash row does happen to name one', () => {
    const record = normalizeTransaction(cash('tax'), {
      source: 'plaid', accountId: 'a1', security: { isin: 'US67066G1040', symbol: 'NVDA' },
    })

    expect(record.securityKey).toBe('isin:US67066G1040')
  })
})
