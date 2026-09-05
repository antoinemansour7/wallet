import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ remove: vi.fn(), deleteDoc: vi.fn(), get: vi.fn() }))
vi.mock('../server/runLog.js', () => ({ withRunLog: (_name, handler) => handler }))
vi.mock('../server/marketQuotes.js', () => ({ fetchMarketQuotes: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: async () => ({ uid: 'test-user' }) }) }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ get: mocks.get, delete: mocks.deleteDoc }) }) }) }) }) }))
vi.mock('plaid', () => ({ Configuration: class {}, PlaidApi: class { itemRemove = mocks.remove }, PlaidEnvironments: { sandbox: 'https://sandbox.plaid.com' }, Products: {}, CountryCode: {} }))
import handler from '../../api/plaid.js'
const response = () => ({ code: null, body: null, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } })
const request = { method: 'POST', headers: { authorization: 'Bearer test' }, body: { action: 'disconnect', itemId: 'item-1' } }

describe('Plaid disconnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PLAID_ENV', 'sandbox')
    vi.stubEnv('PLAID_CLIENT_ID', 'test-client')
    vi.stubEnv('PLAID_SECRET', 'test-secret')
    mocks.get.mockResolvedValue({ exists: true, data: () => ({ accessToken: 'sandbox-test-token' }) })
    mocks.remove.mockResolvedValue({})
    mocks.deleteDoc.mockResolvedValue()
  })
  it('retains the saved connection when Plaid cannot revoke access', async () => {
    mocks.remove.mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { response: { data: { error_code: 'INTERNAL_SERVER_ERROR' } } }))
    const res = response()
    await handler({ ...request, body: { ...request.body } }, res)
    expect(res.code).toBe(502)
    expect(mocks.deleteDoc).not.toHaveBeenCalled()
  })
  it('deletes the local token only after revocation succeeds', async () => {
    const res = response()
    await handler({ ...request, body: { ...request.body } }, res)
    expect(res.code).toBe(200)
    expect(mocks.remove).toHaveBeenCalledWith({ access_token: 'sandbox-test-token' })
    expect(mocks.deleteDoc).toHaveBeenCalledOnce()
  })
  it('allows retry after Plaid has already revoked the item', async () => {
    mocks.remove.mockRejectedValueOnce({ response: { data: { error_code: 'INVALID_ACCESS_TOKEN' } } })
    const res = response()
    await handler({ ...request, body: { ...request.body } }, res)
    expect(res.code).toBe(200)
    expect(mocks.deleteDoc).toHaveBeenCalledOnce()
  })
  it('does not fall back to a sibling connection when a known item was already removed', async () => {
    mocks.get.mockResolvedValueOnce({ exists: false })
    const res = response()
    await handler({ ...request, body: { ...request.body, institution: 'same-brokerage' } }, res)
    expect(res.code).toBe(404)
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.deleteDoc).not.toHaveBeenCalled()
  })
})
