import { afterEach, describe, expect, it, vi } from 'vitest'
import { contributionInputs, contributionView, saleReview, taxAccountType, taxOverview } from './taxModel'

const holding = (symbol = 'MSFT', currency = 'USD', value = 10000) => ({ SYMBOL: symbol, DESCRIPTION: 'Company', 'ACCOUNT CURRENCY': currency, 'MARKET VALUE': value })
const account = (number, type, positions) => ({ accountNumber: number, currency: 'USD', positions: positions.map((row) => ({ ...row, 'ACCOUNT TYPE': type })) })
const reference = { MSFT: { exchange: 'NMS', yieldPct: 2, isFund: false, resolvedAt: '2026-09-01T00:00:00Z' } }
export const trades = [
  { id: 'buy', accountId: 'plaid-1', accountType: 'NON_REGISTERED', securityKey: 'isin:msft', securityKeyBasis: 'isin', symbol: 'MSFT', action: 'BUY', quantity: 10, amountMinor: 80000, feesMinor: 0, currency: 'USD', fxRate: 1.3, tradeDate: '2025-01-01' },
  { id: 'sell', accountId: 'plaid-1', accountType: 'NON_REGISTERED', securityKey: 'isin:msft', securityKeyBasis: 'isin', symbol: 'MSFT', action: 'SELL', quantity: -10, amountMinor: 100000, feesMinor: 100, currency: 'USD', fxRate: 1.4, tradeDate: '2026-01-01' },
]
afterEach(() => vi.useRealTimers())
describe('shared tax adapters', () => {
  it('uses manual registration over imported settings, including Plaid’s Non-Registered spelling', () => {
    expect(taxAccountType(account('A', 'TFSA', [holding()]), { accountTypes: { A: 'RRSP' } })).toBe('RRSP')
    expect(taxAccountType(account('A', 'Non-Registered', [holding()]))).toBe('NON_REGISTERED')
    expect(taxAccountType(account('A', '', [holding()]), { accountTypes: { A: 'RRSP' } })).toBe('RRSP')
    expect(taxAccountType(account('A', 'TFSA', [holding()]))).toBe('TFSA')
    expect(taxAccountType(account('A', 'TFSA', [holding()]), { accountTypes: { A: 'invalid' } })).toBe('TFSA')
    expect(taxAccountType(account('A', 'unrecognized', [holding()]))).toBeNull()
  })
  it('treats an explicit Unknown override exactly like an unset type for withholding', () => {
    const accounts = [account('A', 'TFSA', [holding()])]
    expect(taxAccountType(accounts[0], { accountTypes: { A: 'UNKNOWN' } })).toBeNull()
    expect(taxOverview(accounts, { accountTypes: { A: 'UNKNOWN' } }, 'USD', { reference }))
      .toEqual(taxOverview([account('A', '', [holding()])], {}, 'USD', { reference }))
  })
  it('reclassifies contributions by account even when the ledger retains an imported type', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    const accounts = [account('A', 'TFSA', [{ ...holding(), __plaidAccountId: 'plaid-id' }])]
    const transactions = ['A', 'plaid-id'].map((accountId) => ({ accountId, accountType: 'TFSA', action: 'CONTRIBUTION', amountMinor: 100000, currency: 'CAD', tradeDate: '2026-03-01' }))
    const record = { limitMinor: 1000000, asOf: '2026-01-01' }
    const settings = { accountTypes: { A: 'RRSP' } }
    expect(contributionView('TFSA', record, accounts, transactions, {}).result.depositedMinor).toBe(200000)
    expect(contributionView('TFSA', record, accounts, transactions, settings).result.depositedMinor).toBe(0)
    expect(contributionView('RRSP', record, accounts, transactions, settings).result.depositedMinor).toBe(200000)
    expect(contributionView('TFSA', record, accounts, transactions, { accountTypes: { A: 'UNKNOWN' } }).result.depositedMinor).toBe(0)
  })
  it('uses resolved listing rather than CAD valuation to classify a US holding', () => {
    const accounts = [account('A', 'TFSA', [holding()]), account('B', 'RRSP', [holding()]), account('C', 'NON_REGISTERED', [holding()]), account('D', 'TFSA', [holding('MSFT', 'CAD', 20000)])]
    expect(taxOverview(accounts, {}, 'USD', { reference })).toMatchObject({ annualMinor: 6000, creditMinor: 3000, covered: 3 })
    const result = taxOverview(accounts, {}, 'CAD', { reference })
    expect(result).toMatchObject({ annualMinor: 6000, creditMinor: 0, covered: 1 })
    expect(result.rows[3].holdings[0].projection.provenance).toMatchObject({ source: 'security-reference', yieldBasis: 'trailing-dividends', resolvedAt: reference.MSFT.resolvedAt })
  })
  it('names missing reference and composition instead of treating them as zero', () => {
    const accounts = [account('A', 'TFSA', [holding()]), account('B', 'RRSP', [holding('XEQT.TO')])]
    const result = taxOverview(accounts, {}, 'USD', { reference: { 'XEQT.TO': { exchange: 'TOR', isFund: true } } })
    expect(result).toMatchObject({ covered: 0, gaps: [{ reason: 'Listing reference unavailable' }, { reason: 'Fund composition unavailable' }] })
  })
  it('joins measured withholding to Plaid IDs and requires a complete year of metadata', () => {
    const accounts = [account('display-label', 'TFSA', [{ ...holding(), __plaidAccountId: 'plaid-id' }])]
    const data = { reference, now: Date.parse('2026-09-06'), transactions: [{ action: 'TAX', accountId: 'plaid-id', accountType: 'TFSA', amountMinor: -777, currency: 'USD', tradeDate: '2026-01-01' }], historyStarts: { 'plaid-id': '2025-01-01' } }
    expect(taxOverview(accounts, {}, 'USD', data)).toMatchObject({ annualMinor: 777, basis: 'measured' })
    expect(taxOverview(accounts, {}, 'USD', { ...data, historyStarts: {} })).toMatchObject({ annualMinor: 3000, basis: 'projected' })
    expect(taxOverview(accounts, {}, 'USD', { ...data, historyStarts: { 'plaid-id': '2026-01-01' } })).toMatchObject({ basis: 'projected' })
  })
  it('counts deposits across account IDs in CAD and preserves shared staleness and exclusions', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    const accounts = [account('A', 'TFSA', [{ ...holding(), __plaidAccountId: 'plaid-id' }])]
    const transactions = [{ accountId: 'plaid-id', action: 'TRANSFER', amountMinor: 100000, quantity: 0, currency: 'USD', fxRate: 1.4, tradeDate: '2026-03-01' }]
    const record = { limitMinor: 1000000, asOf: '2026-01-01' }
    expect(contributionView('TFSA', record, accounts, transactions, {}, '9000')).toMatchObject({ result: { remainingMinor: 860000, depositedMinor: 140000, excludesTfsaRecontribution: true }, check: { exceeds: true, excessMinor: 40000, excludesTfsaRecontribution: true } })
    expect(contributionView('TFSA', { ...record, asOf: '2025-01-01' }, accounts, transactions, {}, '9000')).toMatchObject({ result: { stale: true, overByMinor: 0 }, check: { status: 'unknown', exceeds: false } })
    expect(contributionView('TFSA', record, accounts, [{ ...transactions[0], fxRate: null }], {}, '9000')).toMatchObject({ missingFx: true, result: null })
    expect(contributionView('TFSA', { room: '10000', contributed: '1000', asOf: record.asOf }, accounts, transactions, {})).toMatchObject({ needsMigration: true, result: null })
  })
  it('feeds complete cost-base disposals into FX-aware comparisons with provenance and limitations', () => {
    const review = saleReview(trades, { 'plaid-1': '2024-01-01' }, { MSFT: { price: 110, currency: 'USD' } }, 1.5)
    expect(review.comparisons[0]).toMatchObject({ proceedsMinor: 139860, wouldBeWorthMinor: 165000, differenceMinor: 25140, provenance: 'derived', securityKeyBasis: 'isin' })
    expect(review.summary.excludesReinvestment).toBe(true)
    expect(saleReview(trades, {}, { MSFT: { price: 50, currency: 'USD' } }, 1.5).comparisons[0].differenceMinor).toBeLessThan(0)
    expect(saleReview([trades[1]], {}, { MSFT: { price: 110, currency: 'USD' } }, 1.5).comparisons).toEqual([])
    expect(saleReview(trades, {}, { MSFT: { price: 110, currency: 'USD' } }, null).comparisons).toEqual([])
    expect(saleReview(trades, {}, { MSFT: { price: 110, currency: 'USD', cacheStatus: 'stale' } }, 1.5).comparisons).toEqual([])
  })
})

// Incoming brokerage transfers are not evidence of a fresh contribution.
it('withholds contribution room for an unreviewed broker transfer', () => {
  const input = contributionInputs('TFSA', { limitMinor: 700000, asOf: '2026-01-01' }, [], [
    { accountType: 'TFSA', accountId: 'broker', source: 'plaid', action: 'TRANSFER', providerSubtype: 'transfer', cashDirection: 'in', amountMinor: -3980000, currency: 'CAD', tradeDate: '2026-09-03' },
  ])
  expect(input.room).toBeNull()
  expect(input.unreviewedTransfers).toHaveLength(1)
})
