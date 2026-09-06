import { describe, expect, it } from 'vitest'
import { contributionRoom, recordedFees, saleScenario, taxAccountType, taxOverview } from './taxModel'

const holding = (symbol = 'MSFT', currency = 'USD', value = 10000) => ({ SYMBOL: symbol, DESCRIPTION: 'Company', 'ACCOUNT CURRENCY': currency, CURRENCY: 'USD', 'MARKET VALUE': value })
const account = (number, type, positions) => ({ accountNumber: number, currency: 'USD', positions: positions.map((row) => ({ ...row, 'ACCOUNT TYPE': type })) })

describe('portfolio tax scope', () => {
  it('keeps CAD and USD totals separate and applies account treatment to the same US holding', () => {
    const accounts = [account('A', 'TFSA', [holding()]), account('B', 'RRSP', [holding()]), account('C', 'NON_REGISTERED', [holding()]), account('D', 'TFSA', [holding('MSFT', 'CAD', 20000)])]
    expect(taxOverview(accounts, {}, 'USD')).toMatchObject({ annualMinor: 3900, creditMinor: 1950, covered: 3 })
    expect(taxOverview(accounts, {}, 'CAD')).toMatchObject({ annualMinor: 3900, creditMinor: 0, covered: 1 })
  })
  it('does not infer account registration or present unknown fund allocations as zero cost', () => {
    const accounts = [account('TFSA', '', [holding()]), account('B', 'RRSP', [{ ...holding('XEQT.TO', 'CAD'), CURRENCY: 'CAD', DESCRIPTION: 'ETF' }])]
    expect(taxAccountType(accounts[0])).toBeNull()
    expect(taxOverview(accounts, {}, 'USD')).toMatchObject({ covered: 0, gaps: [{ reason: 'Account type needed' }] })
    expect(taxOverview(accounts, {}, 'CAD')).toMatchObject({ covered: 0, gaps: [{ reason: 'Fund-level distributions needed' }] })
  })
  it('requires listing information when only a CAD valuation is known', () => {
    const accounts = [account('A', 'TFSA', [{ ...holding('MSFT', 'CAD'), CURRENCY: undefined }])]
    expect(taxOverview(accounts)).toMatchObject({ covered: 0, gaps: [{ reason: 'Listing currency needed' }] })
  })
  it('respects a confirmed account type and an explicitly zero yield', () => {
    const accounts = [account('A', '', [holding()])]
    expect(taxOverview(accounts, { accountTypes: { A: 'TFSA' }, yieldPct: 0 }, 'USD')).toMatchObject({ covered: 1, annualMinor: 0 })
  })
})

describe('contribution room', () => {
  it('subtracts entered contributions across accounts and warns before a planned excess', () => {
    const result = contributionRoom({ room: '10000', contributed: '2000', asOf: '2026-05-01' }, '2026-09-06', '9000')
    expect(result).toMatchObject({ status: 'current', remainingMinor: 800000, afterMinor: -100000 })
  })
  it('does not roll forward a prior-year room figure or accept a future date', () => {
    expect(contributionRoom({ room: '10000', contributed: '0', asOf: '2025-12-31' }, '2026-01-01', '1')).toEqual({ status: 'stale', asOf: '2025-12-31' })
    expect(contributionRoom({ room: '10000', contributed: '0', asOf: '2027-01-01' }, '2026-01-01')).toEqual({ status: 'unknown' })
    expect(contributionRoom({ room: '', contributed: '0', asOf: '2026-01-01' }, '2026-09-06')).toEqual({ status: 'unknown' })
  })
})

describe('recorded charges and sale scenarios', () => {
  it('deduplicates transactions, avoids fee double counting and excludes other years', () => {
    const fee = { id: 'fee', action: 'FEE', amountMinor: -500, feesMinor: 500, currency: 'CAD', tradeDate: '2026-04-01' }
    const transactions = [fee, fee, { id: 'trade', action: 'SELL', feesMinor: 995, currency: 'USD', tradeDate: '2026-04-02' }, { ...fee, id: 'prior', tradeDate: '2025-04-01' }]
    expect(recordedFees(transactions, 2026).totals).toEqual([{ currency: 'CAD', accountFeesMinor: 500, commissionsMinor: 0, count: 1 }, { currency: 'USD', accountFeesMinor: 0, commissionsMinor: 995, count: 1 }])
  })
  it('compares both a missed rise and an avoided decline without creating phantom sales', () => {
    const sale = { action: 'SELL', quantity: -40, priceMinor: 10000, currency: 'USD' }
    expect(saleScenario(sale, '110')).toMatchObject({ grossProceedsMinor: 400000, heldValueMinor: 440000, differenceMinor: 40000 })
    expect(saleScenario(sale, '90')).toMatchObject({ differenceMinor: -40000 })
    expect(saleScenario({ ...sale, action: 'TRANSFER' }, '110')).toBeNull()
    expect(saleScenario(sale, '')).toBeNull()
  })
})
