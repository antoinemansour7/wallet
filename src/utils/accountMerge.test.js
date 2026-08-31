import { describe, expect, it } from 'vitest'
import {
  SOURCE_KEY,
  LEGACY_SOURCE,
  sourceIdFor,
  positionSource,
  tagPositions,
  previewMerge,
  applyMerge,
  accountSources,
  sourceLabel,
} from './accountMerge'
import { buildAccountPortfolio, flattenAccountRows, getAccountEntries } from './accountPortfolio'

const row = (symbol, quantity, value, extra = {}) => ({
  SYMBOL: symbol,
  QUANTITY: String(quantity),
  'MARKET VALUE': String(value),
  'BOOK VALUE': String(value),
  'MARKET PRICE': '10',
  ...extra,
})

const account = (accountNumber, positions, extra = {}) => ({
  accountNumber, positions, cash: 0, cashSource: 'none', realizedPnl: 0, currency: 'CAD', ...extra,
})

describe('source ids', () => {
  it('is stable for the same file', () => {
    expect(sourceIdFor({ kind: 'file', name: 'MULTI_20260830.csv' }))
      .toBe(sourceIdFor({ kind: 'file', name: 'MULTI_20260830.csv' }))
  })

  it('separates different files and different kinds', () => {
    expect(sourceIdFor({ kind: 'file', name: 'a.csv' })).not.toBe(sourceIdFor({ kind: 'file', name: 'b.csv' }))
    expect(sourceIdFor({ kind: 'file', name: 'a' })).not.toBe(sourceIdFor({ kind: 'plaid', name: 'a' }))
  })

  it('ignores the extension, so a re-export of the same statement matches', () => {
    expect(sourceIdFor({ kind: 'file', name: 'statement.csv' }))
      .toBe(sourceIdFor({ kind: 'file', name: 'statement.xlsx' }))
  })

  it('treats untagged positions as one implicit legacy feed', () => {
    expect(positionSource(row('NVDA', 1, 10))).toBe(LEGACY_SOURCE)
    expect(positionSource(tagPositions([row('NVDA', 1, 10)], 'file:x')[0])).toBe('file:x')
  })
})

// The bug that motivated all of this: uploading brokerage B wiped brokerage A's
// positions and credited cash for the sale that never happened.
describe('other accounts and other feeds are never touched', () => {
  const accounts = {
    111: account('111', tagPositions([row('NVDA', 10, 1000)], 'file:a')),
  }

  it('leaves an untouched account exactly as it was', () => {
    const next = applyMerge({
      accounts, accountNumber: '222', sourceId: 'file:b', rows: [row('SHOP', 5, 500)],
    })
    const a = getAccountEntries(next).find((x) => x.accountNumber === '111')
    expect(a.positions).toHaveLength(1)
    expect(a.cash).toBe(0)
    expect(a.realizedPnl).toBe(0)
  })

  it('adds the new account alongside rather than instead', () => {
    const next = applyMerge({
      accounts, accountNumber: '222', sourceId: 'file:b', rows: [row('SHOP', 5, 500)],
    })
    expect(getAccountEntries(next).map((x) => x.accountNumber)).toEqual(['111', '222'])
  })

  it('keeps other feeds when merging into the same account', () => {
    const combined = {
      111: account('111', [
        ...tagPositions([row('NVDA', 10, 1000)], 'file:a'),
        ...tagPositions([row('SHOP', 5, 500)], 'file:b'),
      ]),
    }
    const next = applyMerge({
      accounts: combined, accountNumber: '111', sourceId: 'file:a', rows: [row('NVDA', 12, 1200)],
    })
    const symbols = next['111'].positions.map((p) => p.SYMBOL).sort()
    expect(symbols).toEqual(['NVDA', 'SHOP'])
    expect(next['111'].positions.find((p) => p.SYMBOL === 'NVDA').QUANTITY).toBe('12')
  })
})

describe('a new feed adds, a known feed replaces', () => {
  const tfsa = { T1: account('T1', tagPositions([row('VFV', 10, 1000)], 'file:broker-a')) }

  it('adds a second brokerage holding the same ticker', () => {
    const next = applyMerge({
      accounts: tfsa, accountNumber: 'T1', sourceId: 'file:broker-b', rows: [row('VFV', 4, 400)],
    })
    // Both lots are held — one at each brokerage.
    expect(next.T1.positions).toHaveLength(2)
    expect(next.T1.positions.map((p) => p.QUANTITY).sort()).toEqual(['10', '4'])
  })

  it('replaces when the same brokerage sends a fresher statement', () => {
    const next = applyMerge({
      accounts: tfsa, accountNumber: 'T1', sourceId: 'file:broker-a', rows: [row('VFV', 14, 1400)],
    })
    expect(next.T1.positions).toHaveLength(1)
    expect(next.T1.positions[0].QUANTITY).toBe('14')
  })

  it('never invents realized P&L from an import', () => {
    const next = applyMerge({
      accounts: tfsa, accountNumber: 'T1', sourceId: 'file:broker-a', rows: [],
    })
    expect(next.T1.realizedPnl).toBe(0)
    expect(next.T1.cash).toBe(0)
  })

  it('rewrites the account number so the row agrees with its destination', () => {
    const next = applyMerge({
      accounts: {}, accountNumber: 'MY-TFSA', sourceId: 'file:x',
      rows: [row('VFV', 1, 100, { 'ACCOUNT NUMBER': 'whatever-the-file-said' })],
    })
    expect(next['MY-TFSA'].positions[0]['ACCOUNT NUMBER']).toBe('MY-TFSA')
  })
})

describe('previewMerge states the effect before it happens', () => {
  const tfsa = { T1: account('T1', tagPositions([row('VFV', 10, 1000), row('XEQT', 5, 500)], 'file:a')) }

  it('flags a brand new account', () => {
    const p = previewMerge({ accounts: {}, accountNumber: 'NEW', sourceId: 'file:a', rows: [row('VFV', 1, 100)] })
    expect(p.isNewAccount).toBe(true)
    expect(p.isKnownSource).toBe(false)
    expect(p.added).toHaveLength(1)
  })

  it('classifies added, updated and removed against the same feed', () => {
    const p = previewMerge({
      accounts: tfsa, accountNumber: 'T1', sourceId: 'file:a',
      rows: [row('VFV', 12, 1200), row('TDB', 3, 300)],
    })
    expect(p.isKnownSource).toBe(true)
    expect(p.added.map((x) => x.symbol)).toEqual(['TDB'])
    expect(p.updated.map((x) => x.symbol)).toEqual(['VFV'])
    expect(p.removed.map((x) => x.symbol)).toEqual(['XEQT'])
  })

  it('reports nothing removed when the feed is new — it is a merge, not a replace', () => {
    const p = previewMerge({
      accounts: tfsa, accountNumber: 'T1', sourceId: 'file:b', rows: [row('VFV', 4, 400)],
    })
    expect(p.removed).toHaveLength(0)
    expect(p.keptFromOtherSources).toBe(2)
    expect(p.added.map((x) => x.symbol)).toEqual(['VFV'])
  })

  it('states the value before and after', () => {
    const p = previewMerge({
      accounts: tfsa, accountNumber: 'T1', sourceId: 'file:b', rows: [row('VFV', 4, 400)],
    })
    expect(p.beforeTotal).toBe(1500)
    expect(p.afterTotal).toBe(1900)
    expect(p.delta).toBe(400)
  })

  it('agrees with what applyMerge actually does', () => {
    const args = { accounts: tfsa, accountNumber: 'T1', sourceId: 'file:b', rows: [row('VFV', 4, 400)] }
    const p = previewMerge(args)
    const next = applyMerge(args)
    const actual = next.T1.positions.reduce((s, x) => s + Number(x['MARKET VALUE']), 0)
    expect(actual).toBe(p.afterTotal)
  })

  it('does not mutate the accounts it was given', () => {
    const before = JSON.stringify(tfsa)
    previewMerge({ accounts: tfsa, accountNumber: 'T1', sourceId: 'file:b', rows: [row('X', 1, 1)] })
    applyMerge({ accounts: tfsa, accountNumber: 'T1', sourceId: 'file:b', rows: [row('X', 1, 1)] })
    expect(JSON.stringify(tfsa)).toBe(before)
  })
})

describe('describing what an account is made of', () => {
  it('counts positions per feed', () => {
    const a = account('T1', [
      ...tagPositions([row('VFV', 10, 1000), row('XEQT', 5, 500)], 'file:broker-a'),
      ...tagPositions([row('VFV', 4, 400)], 'plaid:ins_3'),
    ])
    expect(accountSources(a)).toEqual([
      { id: 'file:broker-a', positions: 2 },
      { id: 'plaid:ins_3', positions: 1 },
    ])
  })

  it('labels legacy and connected feeds readably', () => {
    expect(sourceLabel(LEGACY_SOURCE)).toBe('Imported earlier')
    expect(sourceLabel('file:questrade-tfsa')).toBe('File · questrade tfsa')
    expect(sourceLabel('plaid:wealthsimple')).toBe('Connected · wealthsimple')
  })

  it('tags positions without touching the original rows', () => {
    const original = row('VFV', 1, 100)
    const tagged = tagPositions([original], 'file:a')
    expect(original[SOURCE_KEY]).toBeUndefined()
    expect(tagged[0][SOURCE_KEY]).toBe('file:a')
  })
})

describe('source tags survive the price-refresh path', () => {
  it('keeps sourceId through buildAccountPortfolio and flatten', () => {
    let accounts = applyMerge({ accounts: {}, accountNumber: 'T1', sourceId: 'file:a', rows: [row('VFV', 10, 1000)] })
    accounts = applyMerge({ accounts, accountNumber: 'T1', sourceId: 'file:b', rows: [row('XEQT', 5, 500)] })

    // Simulate a live-price refresh: flatten, "reprice", rebuild.
    const flat = flattenAccountRows(accounts).map((r) => ({ ...r, 'MARKET VALUE': String(Number(r['MARKET VALUE']) * 1.1) }))
    const rebuilt = buildAccountPortfolio({ rows: flat, previousAccounts: accounts })

    const sources = rebuilt.T1.positions.map(positionSource).sort()
    expect(sources).toEqual(['file:a', 'file:b'])
    expect(sources).not.toContain(LEGACY_SOURCE)
  })

  it('a refresh does not fabricate cash or realized P&L', () => {
    const accounts = applyMerge({ accounts: {}, accountNumber: 'T1', sourceId: 'file:a', rows: [row('VFV', 10, 1000)] })
    const flat = flattenAccountRows(accounts)
    const rebuilt = buildAccountPortfolio({ rows: flat, previousAccounts: accounts })
    expect(rebuilt.T1.cash).toBe(0)
    expect(rebuilt.T1.realizedPnl).toBe(0)
  })
})
