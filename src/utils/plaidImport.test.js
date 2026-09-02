import { describe, it, expect } from 'vitest'
import {
  previewMerge, applyMerge, removeAccount, plaidItemIdFor, PLAID_ITEM_KEY,
} from './accountMerge'
import { buildAccountPortfolio } from './accountPortfolio'
import { applyLivePrices, inferRowCurrency } from './livePrices'
import { parseNum } from './portfolioStats'

// Three defects reported from a real Plaid import on 2026-09-01: holdings
// appeared twice, a USD position was summed as though it were Canadian, and an
// account lost every position while gaining cash that was never deposited.
// These pin the behaviour so none of them can come back quietly.

const plaidRow = (over = {}) => ({
  SYMBOL: 'RKLB',
  DESCRIPTION: 'Rocket Lab USA Inc',
  QUANTITY: 17,
  'MARKET PRICE': 62.54,
  'MARKET VALUE': 1063.18,
  'BOOK VALUE': 1375.5,
  'UNREALIZED GAIN/LOSS': -312.32,
  'ACCOUNT NUMBER': '17K9',
  ...over,
})

describe('Plaid import', () => {
  describe('the same holding arriving twice', () => {
    // Plaid reports holdings per account. Two selected accounts that both hold
    // RKLB produce two rows, and they all land in the one destination account
    // the person picked.
    const rows = [plaidRow(), plaidRow()]

    it('previews one line for it', () => {
      const preview = previewMerge({ accounts: {}, accountNumber: '17K9', sourceId: 'plaid:ws', rows })
      expect(preview.added).toHaveLength(1)
    })

    it('stores what it previewed', () => {
      const preview = previewMerge({ accounts: {}, accountNumber: '17K9', sourceId: 'plaid:ws', rows })
      const merged = applyMerge({ accounts: {}, accountNumber: '17K9', sourceId: 'plaid:ws', rows })
      const positions = merged['17K9'].positions

      expect(positions).toHaveLength(preview.added.length)
      expect(positions.filter((p) => p.SYMBOL === 'RKLB')).toHaveLength(1)
    })

    it('adds the quantities up rather than keeping one and dropping the other', () => {
      const merged = applyMerge({ accounts: {}, accountNumber: '17K9', sourceId: 'plaid:ws', rows })
      const rklb = merged['17K9'].positions.find((p) => p.SYMBOL === 'RKLB')

      expect(parseNum(rklb.QUANTITY)).toBe(34)
      expect(parseNum(rklb['MARKET VALUE'])).toBeCloseTo(2126.36, 2)
      expect(parseNum(rklb['BOOK VALUE'])).toBeCloseTo(2751, 2)
    })

    it('agrees with the total the preview promised', () => {
      const preview = previewMerge({ accounts: {}, accountNumber: '17K9', sourceId: 'plaid:ws', rows })
      const merged = applyMerge({ accounts: {}, accountNumber: '17K9', sourceId: 'plaid:ws', rows })
      const stored = merged['17K9'].positions.reduce((s, p) => s + parseNum(p['MARKET VALUE']), 0)

      expect(stored).toBeCloseTo(preview.afterTotal, 2)
    })
  })

  describe('a US-listed holding in a Canadian account', () => {
    // api/plaid.js used to emit the security currency as CURRENCY only, while
    // every consumer reads ACCOUNT CURRENCY — so the gate never opened and USD
    // was added to CAD at face value.
    const usdRow = {
      SYMBOL: 'RKLB',
      DESCRIPTION: 'Rocket Lab USA Inc',
      QUANTITY: 17,
      'BOOK VALUE': 1375.5,
      'ACCOUNT CURRENCY': 'CAD',
    }
    const quote = { symbol: 'RKLB', price: 62.54, currency: 'USD', previousClose: 61.0 }

    it('converts the quote into the account currency', () => {
      const { rows } = applyLivePrices([usdRow], [quote], 1.37)
      expect(parseNum(rows[0]['MARKET PRICE'])).toBeCloseTo(62.54 * 1.37, 2)
      expect(parseNum(rows[0]['MARKET VALUE'])).toBeCloseTo(62.54 * 1.37 * 17, 2)
    })

    it('converts when the stored price shows the row is already Canadian', () => {
      // No recorded currency, but the price it was imported with sits at the
      // converted level — so the book value beside it is Canadian too.
      const row = { ...usdRow, 'ACCOUNT CURRENCY': undefined, 'MARKET PRICE': 62.54 * 1.37 }
      const { rows } = applyLivePrices([row], [quote], 1.37)
      expect(parseNum(rows[0]['MARKET PRICE'])).toBeCloseTo(62.54 * 1.37, 2)
    })

    it('leaves a row alone when its stored price shows it is still in dollars', () => {
      // The case that reported a profit on a losing position: a connected US
      // holding whose cost basis never left USD. Converting only the market
      // value made the P&L the exchange rate.
      const row = { ...usdRow, 'ACCOUNT CURRENCY': undefined, 'MARKET PRICE': 62.54 }
      const { rows } = applyLivePrices([row], [quote], 1.37)
      expect(parseNum(rows[0]['MARKET PRICE'])).toBeCloseTo(62.54, 2)
    })

    it('does not turn a loss into a profit when no currency was recorded', () => {
      // 17 shares bought at $80.91 USD, now $62.54 USD — a real loss either way.
      const row = {
        SYMBOL: 'RKLB', DESCRIPTION: 'Rocket Lab USA Inc', QUANTITY: 17,
        'MARKET PRICE': 62.54, 'MARKET VALUE': 1063.18, 'BOOK VALUE': 1375.5,
      }
      const { rows } = applyLivePrices([row], [quote], 1.37)
      expect(parseNum(rows[0]['UNREALIZED GAIN/LOSS'])).toBeLessThan(0)
    })

    it('does not overwrite the account currency with the quote currency', () => {
      // Doing so poisoned every later refresh: the row then claimed to be a USD
      // account and the conversion stopped firing.
      const { rows } = applyLivePrices([{ ...usdRow, 'ACCOUNT CURRENCY': undefined }], [quote], 1.37)
      expect(rows[0]['ACCOUNT CURRENCY']).not.toBe('USD')
    })

    it('leaves a CDR alone, because it already trades in CAD', () => {
      const cdr = {
        SYMBOL: 'NVDA', DESCRIPTION: 'NVIDIA CORP CDR', QUANTITY: 4.91,
        'BOOK VALUE': 246.0, 'ACCOUNT CURRENCY': 'CAD',
      }
      const { rows } = applyLivePrices([cdr], [{ symbol: 'NVDA.NE', price: 48.47, currency: 'CAD' }], 1.37)
      expect(parseNum(rows[0]['MARKET PRICE'])).toBeCloseTo(48.47, 2)
    })
  })

  describe('a refresh that cannot see every position', () => {
    // The failure that emptied an account: rows arrive without one holding, and
    // the rebuild reads the gap as a sale — crediting proceeds nobody received
    // and marking the balance "inferred".
    const previousAccounts = {
      '17K9': {
        accountNumber: '17K9',
        currency: 'CAD',
        positions: [plaidRow(), plaidRow({ SYMBOL: 'NVDA', DESCRIPTION: 'NVIDIA CORP CDR', QUANTITY: 4.91, 'MARKET VALUE': 238.2 })],
        cash: 0,
        cashSource: 'none',
        realizedPnl: 0,
      },
    }

    it('does not invent cash when a holding is missing from the new rows', () => {
      const next = buildAccountPortfolio({ rows: [], previousAccounts })
      expect(next['17K9']?.cash ?? 0).toBe(0)
      expect(next['17K9']?.cashSource ?? 'none').not.toBe('inferred')
    })

    it('does not book a realized gain for a holding that merely went missing', () => {
      const next = buildAccountPortfolio({ rows: [], previousAccounts })
      expect(next['17K9']?.realizedPnl ?? 0).toBe(0)
    })

    it('keeps the positions it already had rather than emptying the account', () => {
      const next = buildAccountPortfolio({ rows: [], previousAccounts })
      expect(next['17K9']?.positions ?? []).toHaveLength(2)
    })
  })

  describe('an account with no imports left', () => {
    // Imports are counted from positions, so a cash-only account has none and
    // the detail sheet had nothing to offer removing. That stranded the account
    // the phantom-cash bug emptied: no holdings, a balance nobody deposited.
    const accounts = {
      '17K9': {
        accountNumber: '17K9',
        currency: 'CAD',
        positions: [],
        cash: 1301.38,
        cashSource: 'inferred',
        realizedPnl: 0,
      },
    }

    it('can be removed outright', () => {
      expect(removeAccount({ accounts, accountNumber: '17K9' })).toEqual({})
    })

    it('leaves every other account alone', () => {
      const withOther = { ...accounts, '8830': { accountNumber: '8830', positions: [plaidRow()], cash: 0 } }
      const next = removeAccount({ accounts: withOther, accountNumber: '17K9' })

      expect(Object.keys(next)).toEqual(['8830'])
      expect(next['8830'].positions).toHaveLength(1)
    })
  })

  describe('disconnecting the connection an import came from', () => {
    // The source id is `plaid:<institution>` — a label. Sending it as Plaid's
    // item id looked up a document that never existed, so the disconnect failed
    // quietly and the connection kept syncing after its holdings were gone.
    it('recovers the item id from the rows it imported', () => {
      const merged = applyMerge({
        accounts: {},
        accountNumber: '17K9',
        sourceId: 'plaid:wealthsimple',
        rows: [{ ...plaidRow(), [PLAID_ITEM_KEY]: 'item-abc-123' }],
      })

      expect(plaidItemIdFor(merged['17K9'], 'plaid:wealthsimple')).toBe('item-abc-123')
    })

    it('survives the collapse of two rows for one symbol', () => {
      const row = { ...plaidRow(), [PLAID_ITEM_KEY]: 'item-abc-123' }
      const merged = applyMerge({
        accounts: {}, accountNumber: '17K9', sourceId: 'plaid:ws', rows: [row, row],
      })

      expect(merged['17K9'].positions).toHaveLength(1)
      expect(plaidItemIdFor(merged['17K9'], 'plaid:ws')).toBe('item-abc-123')
    })

    it('reports nothing rather than a guess when the rows predate the id', () => {
      const merged = applyMerge({
        accounts: {}, accountNumber: '17K9', sourceId: 'plaid:wealthsimple', rows: [plaidRow()],
      })

      expect(plaidItemIdFor(merged['17K9'], 'plaid:wealthsimple')).toBeNull()
    })
  })

  describe('working out what currency a row is stated in', () => {
    const quote = { symbol: 'RKLB', price: 62.54, currency: 'USD' }

    it('believes the row when it says so', () => {
      expect(inferRowCurrency({ 'ACCOUNT CURRENCY': 'usd' }, quote, 1.37)).toBe('USD')
      expect(inferRowCurrency({ 'ACCOUNT CURRENCY': 'CAD' }, quote, 1.37)).toBe('CAD')
    })

    it('reads a stored price at the quoted level as the quote currency', () => {
      expect(inferRowCurrency({ 'MARKET PRICE': 62.54 }, quote, 1.37)).toBe('USD')
    })

    it('reads a stored price at the converted level as Canadian', () => {
      expect(inferRowCurrency({ 'MARKET PRICE': 85.68 }, quote, 1.37)).toBe('CAD')
    })

    it('says nothing when neither reading is close', () => {
      // A price this far from both is no evidence, and acting on no evidence is
      // what produced the wrong sign in the first place.
      expect(inferRowCurrency({ 'MARKET PRICE': 400 }, quote, 1.37)).toBe('')
    })

    it('says nothing without a stored price or a rate', () => {
      expect(inferRowCurrency({}, quote, 1.37)).toBe('')
      expect(inferRowCurrency({ 'MARKET PRICE': 62.54 }, quote, null)).toBe('')
    })
  })
})
