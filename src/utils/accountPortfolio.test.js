import { describe, expect, it } from 'vitest'
import {
  buildAccountPortfolio,
  flattenAccountRows,
  getAccountEntries,
  hasAccountPortfolio,
} from './accountPortfolio'

const PREV_AVGO = {
  'ACCOUNT NUMBER': '68BB39W',
  'ACCOUNT CURRENCY': 'CAD',
  SYMBOL: 'AVGO',
  DESCRIPTION: 'BROADCOM INC CDR C$HDG',
  QUANTITY: '655',
  'AVERAGE UNIT COST': '13.50971',
  'BOOK VALUE': '8848.86',
  'MARKET PRICE': '15.30000',
  'MARKET VALUE': '10021.50',
  'DAY CHANGE': '-32.75',
  'UNREALIZED GAIN/LOSS': '1172.64',
}

const NEXT_AVGO = {
  ...PREV_AVGO,
  QUANTITY: '280',
  'BOOK VALUE': '3782.72',
  'MARKET PRICE': '16.05000',
  'MARKET VALUE': '4494.00',
  'DAY CHANGE': '176.40',
  'UNREALIZED GAIN/LOSS': '711.28',
}

describe('buildAccountPortfolio', () => {
  it('groups positions into accounts', () => {
    const accounts = buildAccountPortfolio({ rows: [PREV_AVGO] })
    const entry = getAccountEntries(accounts)[0]

    expect(entry.accountNumber).toBe('68BB39W')
    expect(entry.positions).toHaveLength(1)
    expect(entry.cash).toBe(0)
  })

  // These two used to assert the opposite: that a smaller quantity meant a
  // sale, and that rows arriving without a holding meant it had been
  // liquidated. That model predates positions knowing which feed they came
  // from. Importing a statement goes through applyMerge now, which infers
  // nothing, so the only caller left is the live price refresh — where
  // quantities never change and a short reply is a dropped fetch. Reading it as
  // a sale emptied a real account and credited it with proceeds nobody
  // received.
  it('does not read a smaller quantity as a sale', () => {
    const previousAccounts = buildAccountPortfolio({ rows: [PREV_AVGO] })
    const accounts = buildAccountPortfolio({
      rows: [NEXT_AVGO],
      previousAccounts,
    })
    const entry = getAccountEntries(accounts)[0]

    expect(entry.cash).toBe(0)
    expect(entry.cashSource).not.toBe('inferred')
    expect(entry.realizedPnl).toBe(0)
  })

  it('keeps the positions it already had when the new rows mention none', () => {
    const previousAccounts = buildAccountPortfolio({ rows: [PREV_AVGO] })
    const accounts = buildAccountPortfolio({
      rows: [],
      previousAccounts,
    })
    const entry = getAccountEntries(accounts)[0]

    expect(entry.positions).toHaveLength(1)
    expect(entry.cash).toBe(0)
    expect(hasAccountPortfolio(accounts)).toBe(true)
  })

  it('uses explicit cash from the file when provided', () => {
    const previousAccounts = buildAccountPortfolio({ rows: [PREV_AVGO] })
    const accounts = buildAccountPortfolio({
      rows: [NEXT_AVGO],
      previousAccounts,
      cashEntries: [{ accountNumber: '68BB39W', amount: '6420.25', currency: 'CAD' }],
    })
    const entry = getAccountEntries(accounts)[0]

    expect(entry.cashSource).toBe('explicit')
    expect(entry.cash).toBe(6420.25)
    expect(entry.realizedPnl).toBe(0)
  })

  it('reads a cash entry that names the figure `value`, as the Plaid route did', () => {
    const accounts = buildAccountPortfolio({
      rows: [PREV_AVGO],
      cashEntries: [{ accountNumber: '68BB39W', value: '1204.55', currency: 'CAD' }],
    })
    const entry = getAccountEntries(accounts)[0]

    expect(entry.cashSource).toBe('explicit')
    expect(entry.cash).toBe(1204.55)
  })
})

describe('flattenAccountRows', () => {
  it('rebuilds the flat rows array from stored accounts', () => {
    const accounts = buildAccountPortfolio({ rows: [PREV_AVGO] })
    const rows = flattenAccountRows(accounts)

    expect(rows).toHaveLength(1)
    expect(rows[0].SYMBOL).toBe('AVGO')
  })
})
