import { auth } from '../firebase/config.js'

/**
 * The one way to reach /api/plaid.
 *
 * The route now derives who is calling from a Firebase ID token rather than
 * from whatever `userId` the request body claims — a body value could name
 * anyone, and the server used to trust it outright, which let a caller read
 * another person's brokerage holdings or disconnect their bank just by
 * knowing their Firebase UID. `getIdToken()` returns the current session's
 * token, refreshing it first if it is close to expiry, so this is always a
 * token the server will accept for as long as the person is actually signed
 * in.
 *
 * Every caller should go through this rather than calling fetch directly —
 * that is what makes "every request carries a token" true by construction
 * instead of by remembering to add a header five separate times.
 */
export async function callPlaid(body) {
  const token = await auth.currentUser?.getIdToken()
  if (!token) {
    throw new Error('Not signed in')
  }
  return fetch('/api/plaid', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    // Initial transaction imports can use the route’s full five-minute budget.
    signal: AbortSignal.timeout(body.action === 'sync-transactions' ? 300000 : 30000),
  })
}
