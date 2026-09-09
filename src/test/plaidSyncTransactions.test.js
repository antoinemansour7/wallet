import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A small in-memory Firestore double covering what this endpoint touches:
 * the `plaid` connection subcollection (read), `plaidTokens` (read, for the
 * access token), and `transactions`/`accounts` (written via batch by
 * plaidTransactions.js, which is already unit-tested against its own doubles
 * — this only has to prove the writes actually land somewhere real).
 */
function makeFirestore(seed = {}) {
  const store = { ...seed }

  function docRef(path) {
    return {
      id: path.split('/').pop(),
      path,
      parent: { parent: { id: path.split('/')[1] } },
      update: async (data) => { if (!(path in store)) throw Error('Missing document'); store[path] = { ...store[path], ...data } },
      get: async () => ({ exists: path in store, data: () => store[path], id: path.split('/').pop() }),
      set: async (data, opts) => { store[path] = opts?.merge ? { ...(store[path] || {}), ...data } : data },
      delete: async () => { delete store[path] },
    }
  }

  function collectionRef(prefix) {
    return {
      doc: (id) => ({
        ...docRef(`${prefix}/${id}`),
        collection: (sub) => collectionRef(`${prefix}/${id}/${sub}`),
      }),
      get: async () => {
        const ids = Object.keys(store)
          .filter((path) => path.startsWith(`${prefix}/`) && path.slice(prefix.length + 1).split('/').length === 1)
          .map((path) => path.slice(prefix.length + 1))
        return {
          empty: ids.length === 0,
          docs: ids.map((id) => { const data = structuredClone(store[`${prefix}/${id}`]); return { id, data: () => data, ref: docRef(`${prefix}/${id}`) } }),
        }
      },
    }
  }

  return {
    store,
    db: {
      collection: (name) => collectionRef(name),
      collectionGroup: (name) => ({ get: async () => {
        const paths = Object.keys(store).filter((p) => p.split('/').length === 4 && p.split('/')[2] === name)
        return { empty: paths.length === 0, size: paths.length, docs: paths.map((p) => ({ id: p.split('/').pop(), data: () => store[p], ref: docRef(p) })) }
      } }),
      runTransaction: async (fn) => {
        const pending = []
        const result = await fn({ get: (ref) => ref.get(), delete: (ref) => pending.push(() => ref.delete()), set: (ref, data, opts) => pending.push(() => ref.set(data, opts)) })
        for (const op of pending) await op()
        return result
      },
      batch: () => {
        const ops = []
        return {
          delete(ref) { ops.push({ path: ref.path, remove: true }) },
          set(ref, data, opts) {
            ops.push({ path: ref.path, data, opts })
          },
          async commit() {
            for (const op of ops) {
              if (op.remove) { delete store[op.path]; continue }
              store[op.path] = op.opts?.merge ? { ...(store[op.path] || {}), ...op.data } : op.data
            }
          },
        }
      },
    },
  }
}

const mocks = vi.hoisted(() => ({ investmentsTransactionsGet: vi.fn() }))

vi.mock('../server/runLog.js', () => ({ withRunLog: (_name, handler) => handler }))
vi.mock('../server/marketQuotes.js', () => ({ fetchMarketQuotes: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: async () => ({ uid: 'u1' }) }) }))
vi.mock('plaid', () => ({
  Configuration: class {},
  PlaidApi: class { investmentsTransactionsGet = mocks.investmentsTransactionsGet },
  PlaidEnvironments: { sandbox: 'https://sandbox.plaid.com' },
  Products: {},
  CountryCode: {},
}))

let firestore
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => firestore.db }))

import handler from '../../api/plaid.js'

const response = () => ({ code: null, body: null, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } })
const request = (body) => ({ method: 'POST', headers: { authorization: 'Bearer test' }, body: { action: 'sync-transactions', ...body } })

const txnPage = (overrides = {}) => ({
  data: {
    investment_transactions: [{
      investment_transaction_id: 'tx1', account_id: 'acct1', security_id: 'sec1',
      date: '2026-03-12', type: 'buy', subtype: 'buy', quantity: 10, price: 100, amount: 1000, fees: 5,
      iso_currency_code: 'USD',
    }],
    securities: [{ security_id: 'sec1', isin: 'US9229087690', ticker_symbol: 'VTI', iso_currency_code: 'USD' }],
    accounts: [{ account_id: 'acct1', subtype: 'tfsa' }],
    total_investment_transactions: 1,
    ...overrides,
  },
})

describe('sync-transactions action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PLAID_ENV', 'sandbox')
    vi.stubEnv('PLAID_CLIENT_ID', 'test-client')
    vi.stubEnv('PLAID_SECRET', 'test-secret')
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    // Redis is unconfigured in this test, so historicalFxCache() returns
    // null and getRatesForDates falls through to a real fetch — stubbed here
    // so no test in this suite makes a live network call.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ observations: [{ d: '2026-03-12', FXUSDCAD: { v: '1.3542' } }] }) })))
    mocks.investmentsTransactionsGet.mockResolvedValue(txnPage())
    firestore = makeFirestore({
      'users/u1/plaid/item1': { itemId: 'item1', accounts: [], enabledAccountIds: null, institution: 'Questrade' },
      'plaidTokens/item1': { accessToken: 'sandbox-token', uid: 'u1', itemId: 'item1' },
    })
  })

  it('imports transactions for the caller’s connection and writes them to the ledger', async () => {
    const res = response()
    await handler(request({}), res)

    expect(res.code).toBe(200)
    expect(res.body).toMatchObject({ written: 1, fetched: 1, skipped: 0, errors: [] })
    expect(firestore.store['users/u1/transactions/plaid:tx1']).toMatchObject({
      accountId: 'acct1', securityKey: 'isin:US9229087690', action: 'BUY',
    })
  })

  it('resolves the historical FX rate through the real Bank of Canada call path', async () => {
    await handler(request({}), response())
    const written = firestore.store['users/u1/transactions/plaid:tx1']
    expect(written.fxRate).toBe(1.3542)
    expect(written.fxRateSource).toBe('boc')
  })

  it('records where the account’s history begins', async () => {
    await handler(request({}), response())
    expect(firestore.store['users/u1/accounts/acct1']).toMatchObject({ historyStartsAt: expect.any(String), latestImport: { fetched: 1, imported: 1, complete: true } })
  })

  it('returns zeros for a user with no Plaid connections at all', async () => {
    firestore = makeFirestore()
    const res = response()
    await handler(request({}), res)
    expect(res.body).toEqual({ written: 0, fetched: 0, skipped: 0, errors: [] })
    expect(mocks.investmentsTransactionsGet).not.toHaveBeenCalled()
  })

  it('404s for an itemId naming a connection this caller does not have', async () => {
    const res = response()
    await handler(request({ itemId: 'not-mine' }), res)
    expect(res.code).toBe(404)
  })

  it('reports one connection’s failure without losing another connection’s import (#55)', async () => {
    firestore.store['users/u1/plaid/item2'] = { itemId: 'item2', institution: 'Wealthsimple', enabledAccountIds: null }
    firestore.store['plaidTokens/item2'] = { accessToken: 'sandbox-token-2', uid: 'u1', itemId: 'item2' }

    mocks.investmentsTransactionsGet
      .mockResolvedValueOnce(txnPage())
      .mockRejectedValueOnce(new Error('Plaid unavailable'))

    const res = response()
    await handler(request({}), res)

    expect(res.code).toBe(200)
    expect(res.body.written).toBe(1)
    expect(res.body.errors).toHaveLength(1)
    expect(res.body.errors[0]).toMatchObject({ institution: 'Wealthsimple' })
  })

  it('rejects a request with no session token before touching Plaid or Firestore', async () => {
    const res = response()
    await handler({ method: 'POST', headers: {}, body: { action: 'sync-transactions' } }, res)
    expect(res.code).toBe(401)
    expect(mocks.investmentsTransactionsGet).not.toHaveBeenCalled()
  })
  it('keeps another connection and manual records when syncing only one item', async () => {
    Object.assign(firestore.store, {
      'users/u1/plaid/item1': { enabledAccountIds: ['acct1'], institution: 'A' },
      'users/u1/plaid/item2': { enabledAccountIds: ['acct2'], institution: 'B' },
      'users/u1/transactions/other': { source: 'plaid', accountId: 'acct2' },
      'users/u1/transactions/manual': { source: 'manual', accountId: 'csv-account' },
      'users/u1/transactions/orphan': { source: 'plaid', accountId: 'removed' },
    })
    await handler(request({ itemId: 'item1' }), response())
    expect(firestore.store['users/u1/transactions/other']).toBeDefined()
    expect(firestore.store['users/u1/transactions/manual']).toBeDefined()
    expect(firestore.store['users/u1/transactions/orphan']).toBeUndefined()
  })

  it('scheduled and manual sync share account ownership and remain idempotent', async () => {
    Object.assign(firestore.store, {
      'users/u1/plaid/item1': { enabledAccountIds: ['acct1'], institution: 'Broker', accounts: [{ id: 'acct1', mask: '1234', subtype: 'tfsa' }] },
      'users/u1/plaid/item2': { enabledAccountIds: ['z-copy'], institution: 'Broker', accounts: [{ id: 'z-copy', mask: '1234', subtype: 'tfsa' }] },
      'plaidTokens/item2': { uid: 'u1', accessToken: 'duplicate-token' },
    })
    vi.stubEnv('CRON_SECRET', 'test-cron')
    for (let i = 0; i < 2; i++) {
      const res = response()
      await handler({ method: 'GET', query: { mode: 'scheduled-sync' }, headers: { authorization: 'Bearer test-cron' } }, res)
      expect(res.code).toBe(200)
      expect(res.body.errors).toEqual([])
    }
    await handler(request({}), response())
    expect(mocks.investmentsTransactionsGet).toHaveBeenCalledTimes(3)
    expect(Object.keys(firestore.store).filter((p) => p.includes('/transactions/'))).toEqual(['users/u1/transactions/plaid:tx1'])
  })

  it('does not write or claim coverage after a disconnect during the fetch', async () => {
    mocks.investmentsTransactionsGet.mockImplementationOnce(async () => {
      delete firestore.store['users/u1/plaid/item1']
      return txnPage()
    })
    const res = response()
    await handler(request({}), res)
    expect(res.body.errors).toHaveLength(1)
    expect(Object.keys(firestore.store).some((p) => p.includes('/transactions/') || p.includes('/accounts/'))).toBe(false)
  })

  it('reconnect replaces orphaned provider IDs without accumulating a second ledger', async () => {
    firestore.store['users/u1/transactions/old-id'] = { source: 'plaid', accountId: 'old-account' }
    firestore.store['users/u1/plaid/item1'].enabledAccountIds = ['acct1']
    for (let i = 0; i < 2; i++) await handler(request({}), response())
    expect(Object.keys(firestore.store).filter((p) => p.includes('/transactions/'))).toEqual(['users/u1/transactions/plaid:tx1'])
  })

  it('does not prune a connection linked while the provider request was in flight', async () => {
    firestore.store['users/u1/plaid/item1'].enabledAccountIds = ['acct1']
    mocks.investmentsTransactionsGet.mockImplementationOnce(async () => {
      firestore.store['users/u1/plaid/new-link'] = { enabledAccountIds: ['new-account'] }
      firestore.store['users/u1/transactions/new-trade'] = { source: 'plaid', accountId: 'new-account' }
      return txnPage()
    })
    await handler(request({ itemId: 'item1' }), response())
    expect(firestore.store['users/u1/transactions/new-trade']).toBeDefined()
  })

  it('records skipped normalization as incomplete import coverage', async () => {
    mocks.investmentsTransactionsGet.mockResolvedValueOnce(txnPage({ investment_transactions: [{ investment_transaction_id: 'unmapped', account_id: 'acct1', date: '2026-03-12', type: 'cancel', subtype: 'cancel' }] }))
    const res = response()
    await handler(request({}), res)
    expect(res.body.skipped).toBe(1)
    expect(firestore.store['users/u1/accounts/acct1']).toMatchObject({ importComplete: false, latestImport: { fetched: 1, imported: 0, skipped: 1, complete: false } })
  })

})
