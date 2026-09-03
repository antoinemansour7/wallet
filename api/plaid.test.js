import { describe, it, expect, vi, beforeEach } from 'vitest'

// Every handler in api/plaid.js reads `const { userId } = req.body`. Before
// this, that value came straight from whoever sent the request — a caller
// could name any Firebase UID and the route would act as that person. These
// tests are about that one property: identity comes from a verified token,
// never from the body, regardless of what the body claims.
//
// link-token is the handler under test because it is the only one that
// reaches into the caller's identity (`client_user_id: userId`) without also
// touching Firestore, so the mocking stays about auth rather than about
// reproducing the data layer.

const verifyIdToken = vi.fn()
const linkTokenCreate = vi.fn().mockResolvedValue({ data: { link_token: 'link-abc' } })
const investmentsHoldingsGet = vi.fn()
const getFirestore = vi.fn()

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken }),
}))

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn(),
  getApps: () => [{}], // already initialized, so getDb() never runs cert() against a real key
}))

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: (...args) => getFirestore(...args),
}))

vi.mock('plaid', () => ({
  Configuration: vi.fn(),
  // A regular function, not an arrow one: getPlaidClient() calls `new
  // PlaidApi(config)`, and an arrow function has no [[Construct]] — `new` on
  // one throws "is not a constructor" regardless of what vi.fn wraps it in.
  PlaidApi: vi.fn(function PlaidApiMock() { return { linkTokenCreate, investmentsHoldingsGet } }),
  PlaidEnvironments: { sandbox: 'https://sandbox.plaid.com' },
  Products: { Investments: 'investments' },
  CountryCode: { Ca: 'CA', Us: 'US' },
}))

vi.mock('../src/server/marketQuotes.js', () => ({
  fetchMarketQuotes: vi.fn().mockResolvedValue({ quotes: [] }),
}))

// plaid.js's default export is now wrapped in withRunLog (#56), which reaches
// real Upstash/Slack credentials leaked into process.env from .env via
// vite.config.js's loadEnv side effect. A passthrough keeps every test here
// from touching that real infrastructure.
vi.mock('../src/server/runLog.js', () => ({
  withRunLog: (job, handler) => handler,
}))

let handler

beforeEach(async () => {
  vi.clearAllMocks()
  process.env.PLAID_CLIENT_ID = 'test-client-id'
  process.env.PLAID_SECRET = 'test-secret'
  process.env.PLAID_ENV = 'sandbox'
  linkTokenCreate.mockResolvedValue({ data: { link_token: 'link-abc' } })
  // Re-imported per test so process.env changes above are always in effect —
  // the module reads them at call time, not at import time, but a fresh
  // import keeps this test file independent of import order.
  handler = (await import('./plaid.js')).default
})

/** A fake Firestore db exposing just the chain handleHoldings walks. */
function makeFirestoreDb(docs) {
  return {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          get: async () => ({ empty: docs.length === 0, docs }),
        }),
      }),
    }),
  }
}

/** A minimal stand-in for the (req, res) pair Vercel functions receive. */
function makeReqRes({ body, headers = {} } = {}) {
  const req = { method: 'POST', body, headers }
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
  return { req, res }
}

describe('POST /api/plaid — who is calling', () => {
  it('rejects a request with no Authorization header before touching Plaid', async () => {
    const { req, res } = makeReqRes({ body: { action: 'link-token', userId: 'someone' } })

    await handler(req, res)

    expect(res.statusCode).toBe(401)
    expect(linkTokenCreate).not.toHaveBeenCalled()
  })

  it('rejects a token that fails verification', async () => {
    verifyIdToken.mockRejectedValueOnce(new Error('expired'))
    const { req, res } = makeReqRes({
      body: { action: 'link-token', userId: 'someone' },
      headers: { authorization: 'Bearer stale-token' },
    })

    await handler(req, res)

    expect(res.statusCode).toBe(401)
    expect(linkTokenCreate).not.toHaveBeenCalled()
  })

  it('proceeds for a valid token, using the verified uid', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'real-user-abc' })
    const { req, res } = makeReqRes({
      body: { action: 'link-token', userId: 'real-user-abc' },
      headers: { authorization: 'Bearer good-token' },
    })

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user: { client_user_id: 'real-user-abc' } }),
    )
  })

  // The property that matters: a request naming someone else's uid does not
  // act as that person. It acts as whoever the token actually belongs to.
  it('ignores a crafted userId in the body and acts as the token holder instead', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'the-real-caller' })
    const { req, res } = makeReqRes({
      body: { action: 'link-token', userId: 'someone-elses-uid' },
      headers: { authorization: 'Bearer good-token' },
    })

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user: { client_user_id: 'the-real-caller' } }),
    )
    expect(linkTokenCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ user: { client_user_id: 'someone-elses-uid' } }),
    )
  })

  it('checks identity before checking the action is valid, so an unauthenticated probe learns nothing', async () => {
    const { req, res } = makeReqRes({ body: { action: 'not-a-real-action' } })

    await handler(req, res)

    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/plaid — holdings, partial failure', () => {
  beforeEach(() => {
    verifyIdToken.mockResolvedValue({ uid: 'user-1' })
  })

  it('reports a failed connection in the response instead of a bare 200', async () => {
    investmentsHoldingsGet.mockRejectedValue(new Error('ITEM_LOGIN_REQUIRED'))
    getFirestore.mockReturnValue(makeFirestoreDb([
      {
        id: 'item-1',
        data: () => ({
          accessToken: 'token-1',
          accounts: [],
          institution: 'Wealthsimple',
          enabledAccountIds: null,
        }),
      },
    ]))

    const { req, res } = makeReqRes({
      body: { action: 'holdings', userId: 'user-1', itemId: 'item-1' },
      headers: { authorization: 'Bearer good-token' },
    })

    await handler(req, res)

    // Not a 500 or a 404: the connection is real, the fetch for it just
    // failed, and the response still needs to name that plainly.
    expect(res.statusCode).toBe(200)
    expect(res.body.rows).toEqual([])
    expect(res.body.errors).toEqual([
      { itemId: 'item-1', institution: 'Wealthsimple', message: 'ITEM_LOGIN_REQUIRED' },
    ])
  })

  it('reports an empty errors array when every connection loads fine', async () => {
    investmentsHoldingsGet.mockResolvedValue({
      data: { holdings: [], securities: [], accounts: [] },
    })
    getFirestore.mockReturnValue(makeFirestoreDb([
      {
        id: 'item-1',
        data: () => ({
          accessToken: 'token-1',
          accounts: [],
          institution: 'Wealthsimple',
          enabledAccountIds: null,
        }),
      },
    ]))

    const { req, res } = makeReqRes({
      body: { action: 'holdings', userId: 'user-1', itemId: 'item-1' },
      headers: { authorization: 'Bearer good-token' },
    })

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.errors).toEqual([])
  })
})
