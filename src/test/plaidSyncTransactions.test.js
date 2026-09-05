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
          docs: ids.map((id) => ({ id, data: () => store[`${prefix}/${id}`], ref: docRef(`${prefix}/${id}`) })),
        }
      },
    }
  }

  return {
    store,
    db: {
      collection: (name) => collectionRef(name),
      batch: () => {
        const ops = []
        return {
          set(ref, data, opts) {
            ops.push({ path: ref.path, data, opts })
          },
          async commit() {
            for (const op of ops) {
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
    expect(firestore.store['users/u1/accounts/acct1']).toEqual({ historyStartsAt: expect.any(String) })
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
})
