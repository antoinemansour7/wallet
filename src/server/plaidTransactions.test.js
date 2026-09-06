import { describe, it, expect, vi } from 'vitest'
import {
  PAGE_SIZE,
  defaultWindow,
  incrementalWindow,
  RESYNC_OVERLAP_DAYS,
  fetchAllInvestmentTransactions,
  securityContext,
  buildLedgerRecords,
  historyStartsAtFor,
  writeLedgerRecords,
  resolveFxForTransactions,
  syncInvestmentTransactions,
  dedupeEnabledAccounts,
} from './plaidTransactions'

describe('dedupeEnabledAccounts', () => {
  const acct = (id, mask, subtype = 'tfsa') => ({ id, mask, subtype })
  const item = (itemId, institution, accounts, enabledAccountIds) => ({ itemId, institution, accounts, enabledAccountIds })

  it('claims a real account (institution+mask+subtype) for a single item when a login is connected twice', () => {
    // The real bug: one Wealthsimple login connected through two Plaid items,
    // both reporting the same accounts under different ids (same masks).
    const items = [
      item('itemA', 'Wealthsimple', [acct('oNgq', '17K9'), acct('ps07A', 'PS07', 'brokerage')], ['oNgq', 'ps07A']),
      item('itemB', 'Wealthsimple', [acct('jrky', '17K9'), acct('ps07B', 'PS07', 'brokerage')], ['jrky', 'ps07B']),
    ]
    const map = dedupeEnabledAccounts(items)
    // smallest id wins deterministically: 'jrky' < 'oNgq', 'ps07A' < 'ps07B'
    expect(map.get('itemA')).toEqual(['ps07A'])
    expect(map.get('itemB')).toEqual(['jrky'])
    // every real account is now owned by exactly one item
    expect([...map.values()].flat().sort()).toEqual(['jrky', 'ps07A'])
  })

  it('does not collapse the same mask across different institutions', () => {
    const map = dedupeEnabledAccounts([
      item('i1', 'Wealthsimple', [acct('w', '17K9')], ['w']),
      item('i2', 'Questrade', [acct('q', '17K9')], ['q']),
    ])
    expect(map.get('i1')).toEqual(['w'])
    expect(map.get('i2')).toEqual(['q'])
  })

  it('only considers enabled accounts, and leaves a single connection untouched', () => {
    expect(dedupeEnabledAccounts([
      item('only', 'X', [acct('a', 'M1'), acct('b', 'M2', 'brokerage')], ['a', 'b']),
    ]).get('only')).toEqual(['a', 'b'])

    expect(dedupeEnabledAccounts([
      item('i', 'X', [acct('a', 'M1'), acct('b', 'M2')], ['a']),
    ]).get('i')).toEqual(['a'])
  })

  it('passes an untouched connection through unchanged, preserving null = "all accounts"', () => {
    // An item with no account metadata and enabledAccountIds null means "all
    // enabled"; dedupe must not rewrite that to an empty (none) selection.
    expect(dedupeEnabledAccounts([
      item('solo', 'Questrade', [], null),
    ]).get('solo')).toBeNull()
  })
})

const security = (overrides = {}) => ({
  security_id: 'sec1',
  ticker_symbol: 'VTI',
  isin: 'US9229087690',
  cusip: '922908769',
  iso_currency_code: 'USD',
  market_identifier_code: 'XNYS',
  ...overrides,
})

const txn = (overrides = {}) => ({
  investment_transaction_id: 'tx1',
  account_id: 'acct1',
  security_id: 'sec1',
  date: '2026-03-14',
  type: 'buy',
  subtype: 'buy',
  quantity: 10,
  price: 143.29,
  amount: 1432.9,
  fees: 4.95,
  iso_currency_code: 'USD',
  ...overrides,
})

const accountTypeFor = (account) => (account?.subtype === 'tfsa' ? 'TFSA' : 'NON_REGISTERED')

function fakeClient(pages) {
  const calls = []
  const client = {
    investmentsTransactionsGet: vi.fn(async (args) => {
      calls.push(args)
      const page = pages[calls.length - 1] || { investment_transactions: [] }
      return { data: page }
    }),
  }
  return { client, calls }
}

describe('defaultWindow', () => {
  it('asks for the 24 months Plaid actually serves', () => {
    const { startDate, endDate } = defaultWindow(new Date('2026-09-05T00:00:00Z'))
    expect(endDate).toBe('2026-09-05')
    expect(startDate).toBe('2024-09-05')
  })
})

describe('fetchAllInvestmentTransactions', () => {
  it('walks every page rather than stopping at the first', async () => {
    const { client, calls } = fakeClient([
      { investment_transactions: [txn({ investment_transaction_id: 'a' })], securities: [security()], accounts: [{ account_id: 'acct1' }], total_investment_transactions: 3 },
      { investment_transactions: [txn({ investment_transaction_id: 'b' })], securities: [], accounts: [], total_investment_transactions: 3 },
      { investment_transactions: [txn({ investment_transaction_id: 'c' })], securities: [], accounts: [], total_investment_transactions: 3 },
    ])

    const result = await fetchAllInvestmentTransactions({ client, accessToken: 't', startDate: '2024-09-05', endDate: '2026-09-05', pageSize: 1 })

    expect(result.transactions).toHaveLength(3)
    expect(result.pages).toBe(3)
    expect(calls.map((c) => c.options.offset)).toEqual([0, 1, 2])
  })

  it('accumulates securities and accounts across pages', async () => {
    const { client } = fakeClient([
      { investment_transactions: [txn()], securities: [security()], accounts: [{ account_id: 'acct1' }], total_investment_transactions: 2 },
      { investment_transactions: [txn({ investment_transaction_id: 'b', security_id: 'sec2' })], securities: [security({ security_id: 'sec2' })], accounts: [], total_investment_transactions: 2 },
    ])

    const result = await fetchAllInvestmentTransactions({ client, accessToken: 't', startDate: 'a', endDate: 'b', pageSize: 1 })
    expect([...result.securities.keys()]).toEqual(['sec1', 'sec2'])
  })

  it('stops on an empty page even when the total disagrees', async () => {
    // A total that overstates reality would otherwise spin forever.
    const { client, calls } = fakeClient([
      { investment_transactions: [txn()], total_investment_transactions: 999 },
      { investment_transactions: [], total_investment_transactions: 999 },
    ])

    const result = await fetchAllInvestmentTransactions({ client, accessToken: 't', startDate: 'a', endDate: 'b', pageSize: 1 })
    expect(result.transactions).toHaveLength(1)
    expect(calls).toHaveLength(2)
  })

  it('requests Plaid’s maximum page size by default', async () => {
    const { client, calls } = fakeClient([{ investment_transactions: [], total_investment_transactions: 0 }])
    await fetchAllInvestmentTransactions({ client, accessToken: 't', startDate: 'a', endDate: 'b' })
    expect(calls[0].options.count).toBe(PAGE_SIZE)
  })
})

describe('securityContext', () => {
  it('carries the identifiers that make pooling work across brokerages', () => {
    expect(securityContext(security())).toMatchObject({ isin: 'US9229087690', cusip: '922908769', symbol: 'VTI', exchange: 'XNYS' })
  })

  it('survives a security with no identifiers', () => {
    expect(securityContext({ security_id: 'x' })).toMatchObject({ isin: '', cusip: '', symbol: '' })
  })

  it('returns null for no security at all', () => {
    expect(securityContext(null)).toBeNull()
  })
})

describe('buildLedgerRecords', () => {
  const securities = new Map([['sec1', security()]])
  const accounts = new Map([['acct1', { account_id: 'acct1', subtype: 'tfsa' }]])

  it('produces a ledger record keyed on a real identifier', () => {
    const { records } = buildLedgerRecords({ transactions: [txn()], securities, accounts, accountTypeFor })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: 'plaid:tx1',
      accountId: 'acct1',
      accountType: 'TFSA',
      securityKey: 'isin:US9229087690',
      securityKeyBasis: 'isin',
    })
  })

  it('imports registered accounts too', () => {
    // Excluded from cost-base pooling, but the superficial-loss window needs
    // them: buying back in an RRSP denies a loss taken in a cash account.
    const { records } = buildLedgerRecords({ transactions: [txn()], securities, accounts, accountTypeFor })
    expect(records[0].accountType).toBe('TFSA')
  })

  it('skips accounts the user did not enable', () => {
    const { records } = buildLedgerRecords({ transactions: [txn()], securities, accounts, enabledAccountIds: ['other'], accountTypeFor })
    expect(records).toHaveLength(0)
  })

  it('reports what it could not classify instead of quietly taking less', () => {
    const undated = txn({ investment_transaction_id: 'bad', date: '' })
    const { records, skipped } = buildLedgerRecords({ transactions: [txn(), undated], securities, accounts, accountTypeFor })

    expect(records).toHaveLength(1)
    expect(skipped).toEqual([{ id: 'bad', reason: 'unclassifiable' }])
  })

  it('is idempotent — the same page twice yields the same ids', () => {
    const first = buildLedgerRecords({ transactions: [txn()], securities, accounts, accountTypeFor })
    const second = buildLedgerRecords({ transactions: [txn()], securities, accounts, accountTypeFor })
    expect(first.records[0].id).toBe(second.records[0].id)
  })

  it('attaches an FX rate when one is supplied, and leaves it null otherwise', () => {
    const withFx = buildLedgerRecords({
      transactions: [txn()], securities, accounts, accountTypeFor,
      fxFor: () => ({ rate: 1.3542, source: 'boc', asOf: '2026-03-14' }),
    })
    expect(withFx.records[0].fxRate).toBe(1.3542)

    const without = buildLedgerRecords({ transactions: [txn()], securities, accounts, accountTypeFor })
    expect(without.records[0].fxRate).toBeNull()
  })
})

describe('historyStartsAtFor', () => {
  it('dates coverage from the requested window, not the first trade seen', () => {
    // An account whose earliest trade is recent still has no history before
    // the window; dating it from that trade would claim coverage the import
    // does not have, and turn an incomplete cost base into a confident one.
    expect(historyStartsAtFor({ accountIds: ['a', 'b'], startDate: '2024-09-05' })).toEqual({
      a: '2024-09-05',
      b: '2024-09-05',
    })
  })
})

describe('writeLedgerRecords', () => {
  function fakeDb() {
    const writes = []
    const commits = []
    const doc = (id) => ({ id })
    const collection = (name) => ({ doc: (id) => ({ path: `${name}/${id}`, id }) })
    const userDoc = { collection }
    const db = {
      collection: () => ({ doc: () => userDoc }),
      batch: () => {
        const ops = []
        return {
          set: (ref, data, opts) => ops.push({ ref, data, opts }),
          commit: async () => { writes.push(...ops); commits.push(ops.length) },
        }
      },
    }
    return { db, writes, commits, doc }
  }

  it('writes each record under its derived id', async () => {
    const { db, writes } = fakeDb()
    const records = [{ id: 'plaid:tx1', accountId: 'acct1' }, { id: 'plaid:tx2', accountId: 'acct1' }]

    const result = await writeLedgerRecords({ db, uid: 'u1', records })

    expect(result.written).toBe(2)
    expect(writes.map((w) => w.ref.path)).toEqual(['transactions/plaid:tx1', 'transactions/plaid:tx2'])
  })

  it('splits into batches so a large import does not exceed Firestore’s limit', async () => {
    const { db, commits } = fakeDb()
    const records = Array.from({ length: 1100 }, (_, i) => ({ id: `plaid:tx${i}` }))

    await writeLedgerRecords({ db, uid: 'u1', records })

    expect(commits).toEqual([500, 500, 100])
  })

  it('records where each account’s history begins', async () => {
    const { db, writes } = fakeDb()
    await writeLedgerRecords({ db, uid: 'u1', records: [], historyStartsAt: { acct1: '2024-09-05' } })

    const accountWrite = writes.find((w) => w.ref.path.startsWith('accounts/'))
    expect(accountWrite.data).toEqual({ historyStartsAt: '2024-09-05' })
    expect(accountWrite.opts).toEqual({ merge: true })
  })

  it('refuses to write without a user', async () => {
    const { db } = fakeDb()
    await expect(writeLedgerRecords({ db, records: [] })).rejects.toThrow(/uid/)
  })
})

describe('resolveFxForTransactions', () => {
  it('resolves every trade date in one batched call, not one per transaction', async () => {
    const resolveFxRates = vi.fn(async (dates) => new Map(dates.map((d) => [d, { rate: 1.35, source: 'boc', asOf: d }])))
    const transactions = [txn({ date: '2026-03-12' }), txn({ date: '2026-03-13' }), txn({ date: '2026-03-12' })]

    const fxFor = await resolveFxForTransactions(transactions, resolveFxRates)

    expect(resolveFxRates).toHaveBeenCalledOnce()
    expect(resolveFxRates).toHaveBeenCalledWith(['2026-03-12', '2026-03-13'])
    expect(fxFor({ date: '2026-03-12' })).toEqual({ rate: 1.35, source: 'boc', asOf: '2026-03-12' })
  })

  it('passes through a null for a date the resolver could not cover', async () => {
    const resolveFxRates = async () => new Map([['2026-03-12', null]])
    const fxFor = await resolveFxForTransactions([txn({ date: '2026-03-12' })], resolveFxRates)
    expect(fxFor({ date: '2026-03-12' })).toBeNull()
  })

  it('does not call the resolver at all for an empty batch', async () => {
    const resolveFxRates = vi.fn(async () => new Map())
    await resolveFxForTransactions([], resolveFxRates)
    expect(resolveFxRates).not.toHaveBeenCalled()
  })
})

describe('syncInvestmentTransactions', () => {
  it('fetches, transforms and writes, reporting what it did', async () => {
    const { client } = fakeClient([
      {
        investment_transactions: [txn(), txn({ investment_transaction_id: 'tx2', date: '' })],
        securities: [security()],
        accounts: [{ account_id: 'acct1', subtype: 'tfsa' }],
        total_investment_transactions: 2,
      },
    ])

    const committed = []
    const db = {
      collection: () => ({ doc: () => ({ collection: (name) => ({ doc: (id) => ({ path: `${name}/${id}` }) }) }) }),
      batch: () => ({ set: (ref) => committed.push(ref.path), commit: async () => {} }),
    }

    const result = await syncInvestmentTransactions({
      client, accessToken: 't', db, uid: 'u1', accountTypeFor, now: new Date('2026-09-05T00:00:00Z'),
    })

    expect(result).toMatchObject({ written: 1, fetched: 2, skipped: 1, startDate: '2024-09-05', endDate: '2026-09-05' })
    expect(committed).toContain('transactions/plaid:tx1')
    expect(committed).toContain('accounts/acct1')
  })

  it('does not resolve FX rates unless resolveFxRates is explicitly given', async () => {
    // The default has to stay side-effect-free: a caller that does not pass
    // resolveFxRates gets fxRate: null, not a network call it never asked for.
    const { client } = fakeClient([{ investment_transactions: [txn()], securities: [security()], accounts: [{ account_id: 'acct1' }], total_investment_transactions: 1 }])
    const written = []
    const db = {
      collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ path: 'x', set: undefined }) }) }) }),
      batch: () => ({ set: (ref, data) => written.push(data), commit: async () => {} }),
    }

    await syncInvestmentTransactions({ client, accessToken: 't', db, uid: 'u1', accountTypeFor, now: new Date('2026-09-05T00:00:00Z') })

    const transactionRecord = written.find((d) => d?.id === 'plaid:tx1')
    expect(transactionRecord.fxRate).toBeNull()
  })

  it('resolves FX rates in one batch when resolveFxRates is given', async () => {
    const { client } = fakeClient([{ investment_transactions: [txn()], securities: [security()], accounts: [{ account_id: 'acct1' }], total_investment_transactions: 1 }])
    const written = []
    const db = {
      collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ path: 'x' }) }) }) }),
      batch: () => ({ set: (ref, data) => written.push(data), commit: async () => {} }),
    }
    const resolveFxRates = vi.fn(async (dates) => new Map(dates.map((d) => [d, { rate: 1.3542, source: 'boc', asOf: d }])))

    await syncInvestmentTransactions({
      client, accessToken: 't', db, uid: 'u1', accountTypeFor, resolveFxRates, now: new Date('2026-09-05T00:00:00Z'),
    })

    expect(resolveFxRates).toHaveBeenCalledOnce()
    const transactionRecord = written.find((d) => d?.id === 'plaid:tx1')
    expect(transactionRecord.fxRate).toBe(1.3542)
  })
})

describe('incrementalWindow (#87)', () => {
  const now = new Date('2026-09-06T00:00:00Z')

  it('reaches back from the last sync, with an overlap for late-arriving trades', () => {
    // A trade can appear in Plaid days after it happened. A window starting
    // exactly where the last one ended would step straight over it.
    const { startDate, endDate } = incrementalWindow('2026-09-01T00:00:00Z', now)

    expect(startDate).toBe('2026-08-27')
    expect(endDate).toBe('2026-09-06')
    expect(RESYNC_OVERLAP_DAYS).toBe(5)
  })

  it('falls back to the full window when nothing has synced yet', () => {
    expect(incrementalWindow(null, now)).toEqual(defaultWindow(now))
    expect(incrementalWindow('not a date', now)).toEqual(defaultWindow(now))
  })

  it('never reaches further back than the provider actually serves', () => {
    // A connection dormant for years must not ask for five years of history.
    expect(incrementalWindow('2019-01-01T00:00:00Z', now).startDate).toBe(defaultWindow(now).startDate)
  })
})

describe('syncInvestmentTransactions — incremental (#87)', () => {
  const client = (transactions = []) => ({
    investmentsTransactionsGet: vi.fn(async () => ({
      data: {
        investment_transactions: transactions,
        securities: [],
        accounts: [{ account_id: 'a1', name: 'TFSA', type: 'investment', subtype: 'tfsa' }],
        total_investment_transactions: transactions.length,
      },
    })),
  })

  const db = () => {
    const set = vi.fn()
    return {
      db: {
        collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
        batch: () => ({ set, commit: vi.fn(async () => {}) }),
      },
      set,
    }
  }

  it('does not move historyStartsAt forward on a re-sync', async () => {
    // The line before which no transactions exist is what makes a cost base
    // resolve to "incomplete" rather than to a wrong number. Writing an
    // incremental start date here would claim a two-year history began last
    // week — turning a complete cost base into an incomplete one.
    const { db: fake, set } = db()
    await syncInvestmentTransactions({
      client: client(), accessToken: 't', db: fake, uid: 'u1',
      accountTypeFor: () => 'TFSA', since: '2026-09-01T00:00:00Z', now: new Date('2026-09-06T00:00:00Z'),
    })

    const wroteHistoryStart = set.mock.calls.some(([, value]) => value && 'historyStartsAt' in value)
    expect(wroteHistoryStart).toBe(false)
  })

  it('still records where history begins on a full sync', async () => {
    const { db: fake, set } = db()
    await syncInvestmentTransactions({
      client: client(), accessToken: 't', db: fake, uid: 'u1',
      accountTypeFor: () => 'TFSA', now: new Date('2026-09-06T00:00:00Z'),
    })

    const wroteHistoryStart = set.mock.calls.some(([, value]) => value && 'historyStartsAt' in value)
    expect(wroteHistoryStart).toBe(true)
  })

  it('asks the provider only for the incremental window', async () => {
    const plaid = client()
    await syncInvestmentTransactions({
      client: plaid, accessToken: 't', db: db().db, uid: 'u1',
      accountTypeFor: () => 'TFSA', since: '2026-09-01T00:00:00Z', now: new Date('2026-09-06T00:00:00Z'),
    })

    expect(plaid.investmentsTransactionsGet.mock.calls[0][0]).toMatchObject({
      start_date: '2026-08-27', end_date: '2026-09-06',
    })
  })
})
