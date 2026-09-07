import { describe, it, expect } from 'vitest'
import { dedupeTransactions, duplicateCount } from './dedupeTransactions'
const trade = { id: 'first', source: 'plaid', sourceId: 'source-first', accountId: 'tfsa', action: 'BUY', tradeDate: '2026-08-12', symbol: 'RKLB', quantity: 8, amountMinor: 91856, currency: 'USD' }
describe('safe transaction identity', () => {
  it('removes repeated source identities within the same account', () => {
    const rows = [trade, { ...trade, id: 'another-document' }]
    expect(dedupeTransactions(rows)).toEqual([trade])
    expect(duplicateCount(rows)).toBe(1)
  })
  it('retains identical trades in different accounts', () => {
    expect(dedupeTransactions([trade, { ...trade, accountId: 'rrsp' }])).toHaveLength(2)
  })
  it('retains repeated same-day purchases with different source identities', () => {
    expect(dedupeTransactions([trade, { ...trade, id: 'second', sourceId: 'source-second' }])).toHaveLength(2)
  })
  it('does not invent identities for records without identifiers', () => {
    const row = { amountMinor: 10000, accountId: 'tfsa' }
    expect(dedupeTransactions([row, { ...row }, null])).toHaveLength(2)
  })
})
