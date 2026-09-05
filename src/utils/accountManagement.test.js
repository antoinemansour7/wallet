import { describe, it, expect } from 'vitest'
import { importAccountSummary, planAccountRemoval, prepareImportRows } from './accountManagement'
import { applyMergeByAccount, accountSources, plaidItemIdFor } from './accountMerge'
import { buildAccountPortfolio } from './accountPortfolio'

const row = (account, id, qty, value, item = 'item-1') => ({ SYMBOL: 'VFV.TO', QUANTITY: qty, 'MARKET VALUE': value, 'ACCOUNT NUMBER': account, 'ACCOUNT CURRENCY': 'CAD', __plaidAccountId: id, __plaidItemId: item, __sourceId: 'plaid:broker' })
const tfsa = row('TFSA', 'tfsa-id', 5, 750)
const rrsp = row('RRSP', 'rrsp-id', 10, 1500)
const accounts = { TFSA: { accountNumber: 'TFSA', positions: [tfsa], cash: 100 }, RRSP: { accountNumber: 'RRSP', positions: [rrsp], cash: 200 } }

describe('Account management', () => {
  it('keeps the same security separate across connected accounts during staging and saving', () => {
    const rows = prepareImportRows([tfsa, rrsp, { ...tfsa, QUANTITY: 2, 'MARKET VALUE': 300 }])
    const result = applyMergeByAccount({ rows, sourceId: 'plaid:broker' })
    expect(result.TFSA.positions[0].QUANTITY).toBe(7)
    expect(result.RRSP.positions[0].QUANTITY).toBe(10)
    expect(result.TFSA.positions[0]['MARKET VALUE']).toBe(1050)
    expect(result.RRSP.positions[0]['MARKET VALUE']).toBe(1500)
  })
  it('keeps sibling accounts enabled instead of disconnecting their shared item', () => {
    const plan = planAccountRemoval({ accounts, accountNumber: 'TFSA' })
    expect(plan.operations).toEqual([{ action: 'select-accounts', itemId: 'item-1', accountIds: ['rrsp-id'] }])
    expect(plan.nextAccounts.TFSA).toBeUndefined()
    expect(plan.nextAccounts.RRSP.positions).toEqual([rrsp])
  })
  it('disconnects an item when its last account is removed', () => {
    const plan = planAccountRemoval({ accounts: { TFSA: accounts.TFSA }, accountNumber: 'TFSA' })
    expect(plan.operations).toEqual([{ action: 'disconnect', itemId: 'item-1', institution: 'broker' }])
    expect(plan.nextAccounts).toEqual({})
  })
  it('does not confuse two independent connections at the same institution', () => {
    const separate = { ...accounts, RRSP: { ...accounts.RRSP, positions: [row('RRSP', 'rrsp-id', 10, 1500, 'item-2')] } }
    expect(planAccountRemoval({ accounts: separate, accountNumber: 'TFSA' }).operations[0].action).toBe('disconnect')
  })
  it('keeps file imports when a linked source is removed', () => {
    const imported = { ...tfsa, SYMBOL: 'AAPL', __sourceId: 'file:statement' }
    const mixed = { TFSA: { ...accounts.TFSA, positions: [tfsa, imported] } }
    const plan = planAccountRemoval({ accounts: mixed, accountNumber: 'TFSA', sourceId: 'plaid:broker' })
    expect(plan.nextAccounts.TFSA.positions).toEqual([imported])
    expect(plan.nextAccounts.TFSA.cash).toBe(100)
  })
  it('never revokes an ambiguous legacy connection still used by another account', () => {
    const legacy = { TFSA: { ...accounts.TFSA, positions: [{ ...tfsa, __plaidItemId: undefined }] }, RRSP: { ...accounts.RRSP, positions: [{ ...rrsp, __plaidItemId: undefined, __plaidAccountId: undefined }] } }
    expect(planAccountRemoval({ accounts: legacy, accountNumber: 'TFSA' }).operations[0].action).toBe('keep-connection')
  })
  it('includes cash-only connected accounts and preserves their connection through a price refresh', () => {
    const cashEntries = [{ accountNumber: 'CASH', amount: 500, currency: 'CAD' }]
    expect(importAccountSummary([], cashEntries, true)).toEqual([{ accountNumber: 'CASH', positions: 0, value: 0 }])
    const imported = applyMergeByAccount({ sourceId: 'plaid:broker', rows: [tfsa], cashByAccount: { CASH: 500 }, currencyByAccount: { CASH: 'CAD' }, sourceMetadataByAccount: { CASH: { plaidItemId: 'item-1', plaidAccountIds: ['cash-id'] } } })
    const refreshed = buildAccountPortfolio({ rows: [tfsa], previousAccounts: imported })
    expect(refreshed.CASH.cash).toBe(500)
    expect(refreshed.CASH.currency).toBe('CAD')
    expect(accountSources(refreshed.CASH)).toEqual([{ id: 'plaid:broker', positions: 0 }])
    expect(plaidItemIdFor(refreshed.CASH, 'plaid:broker')).toBe('item-1')
    expect(planAccountRemoval({ accounts: refreshed, accountNumber: 'TFSA' }).operations).toEqual([{ action: 'select-accounts', itemId: 'item-1', accountIds: ['cash-id'] }])
  })
})
