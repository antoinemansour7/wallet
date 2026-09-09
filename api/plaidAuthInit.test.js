// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Firebase Admin has to exist before the first thing that uses it.
 *
 * initializeApp() used to live inside getDb(), so the app was only created when
 * a handler asked for Firestore. verifyCaller runs *before* any handler — it is
 * the first thing the route does — so on a cold container getAuth() was reached
 * with no app and threw `app/no-app`, which the catch reported to the user as
 * "Invalid or expired session". A valid token, rejected because nothing had
 * touched the database yet.
 *
 * Deliberately standalone rather than added to plaid.test.js: this must run
 * against the real module with no Firestore mock in the way, since the mock is
 * what hid the ordering in the first place.
 */
const SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'wallai-9f983',
  client_email: 'x@wallai-9f983.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n',
})

const responseDouble = () => ({
  statusCode: 0, body: null,
  status(code) { this.statusCode = code; return this },
  json(payload) { this.body = payload; return this },
})

describe('Firebase Admin initialisation order', () => {
  beforeEach(() => {
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT', SERVICE_ACCOUNT)
    vi.stubEnv('PLAID_CLIENT_ID', 'id')
    vi.stubEnv('PLAID_SECRET', 'secret')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('creates the app before verifying a token, on a container that never touched Firestore', async () => {
    const { default: handler } = await import('./plaid.js')
    const res = responseDouble()

    await handler(
      { method: 'POST', headers: { authorization: 'Bearer not-a-real-token' }, body: { action: 'holdings' }, query: {} },
      res,
    )

    // Still a 401 — the token is junk — but for the right reason.
    expect(res.statusCode).toBe(401)

    const reasons = console.error.mock.calls.map((args) => args.join(' ')).join('\n')
    // app/no-app is the regression: it means getAuth() ran before initializeApp().
    expect(reasons).not.toContain('app/no-app')
    expect(reasons).toContain('[plaid:auth]')
  })

  it('rejects a request with no Authorization header before touching Firebase at all', async () => {
    const { default: handler } = await import('./plaid.js')
    const res = responseDouble()

    await handler({ method: 'POST', headers: {}, body: { action: 'holdings' }, query: {} }, res)

    expect(res.statusCode).toBe(401)
    expect(res.body.error).toMatch(/Authorization/i)
  })
})
