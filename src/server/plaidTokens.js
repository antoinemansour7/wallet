/**
 * Plaid access tokens, kept out of the user's own subtree.
 *
 * A Plaid access token is a live credential: it authorises reads of that
 * item's accounts, balances, holdings and transactions for as long as the
 * connection exists. It was stored at `users/{uid}/plaid/{itemId}` alongside
 * the connection's harmless metadata, which put it inside the one subtree a
 * user is most likely to be granted. A Firestore rule as ordinary as
 *
 *     match /users/{uid}/{document=**} { allow read: if request.auth.uid == uid }
 *
 * hands a signed-in browser its own Plaid credential. Nothing in the client
 * ever asked for it; it was simply within reach.
 *
 * Rules alone would close that, and `firestore.rules` does. This module is the
 * second control: the token moves to a top-level collection that sits under no
 * user, so the permissive rule above cannot reach it even if it is what the
 * project is running today. Two independent things now have to be wrong before
 * a credential leaks, rather than one.
 *
 * Nothing client-side reads either location — only `api/plaid.js`, through the
 * Admin SDK, which bypasses rules entirely.
 */

const TOKENS = 'plaidTokens'

function tokenDoc(db, itemId) {
  return db.collection(TOKENS).doc(itemId)
}

function legacyDoc(db, uid, itemId) {
  return db.collection('users').doc(uid).collection('plaid').doc(itemId)
}

export async function writeAccessToken({ db, uid, itemId, accessToken }) {
  if (!itemId) throw new Error('writeAccessToken requires an itemId')
  if (!accessToken) throw new Error('writeAccessToken requires an accessToken')

  // `uid` is stored so a token can be traced back to its owner for revocation
  // and cleanup. It is not used for access control — nothing but the server
  // reads this collection at all.
  await tokenDoc(db, itemId).set({ accessToken, uid: uid || null, itemId, updatedAt: new Date().toISOString() })
}

/**
 * Reads the token, preferring the safe location and falling back to the
 * connection document for anything created before this split.
 *
 * A legacy hit is migrated in passing: the token is copied to the new
 * collection and cleared from the old one. Doing it lazily rather than as a
 * batch migration means no connection is touched until something already needs
 * its token, and a half-finished migration cannot leave a user unable to
 * refresh — either location still answers.
 */
export async function readAccessToken({ db, uid, itemId, legacyData = null, migrate = true }) {
  if (!itemId) return null

  const snapshot = await tokenDoc(db, itemId).get()
  if (snapshot.exists) {
    const token = snapshot.data()?.accessToken
    if (token) return token
  }

  const legacy = legacyData ?? (uid ? (await legacyDoc(db, uid, itemId).get()).data() : null)
  const legacyToken = legacy?.accessToken
  if (!legacyToken) return null

  if (migrate && uid) {
    await writeAccessToken({ db, uid, itemId, accessToken: legacyToken })
    // Clearing the field rather than deleting the document: the rest of it —
    // accounts, enabledAccountIds, institution — is the connection itself and
    // is still read on every refresh.
    await clearLegacyAccessToken({ db, uid, itemId })
  }

  return legacyToken
}

export async function clearLegacyAccessToken({ db, uid, itemId, FieldValue }) {
  const remove = FieldValue?.delete ? FieldValue.delete() : null
  // Firestore's delete sentinel removes the field outright. Without it, an
  // explicit null at least stops the credential being readable, which is the
  // property that matters.
  await legacyDoc(db, uid, itemId).set({ accessToken: remove ?? null }, { merge: true })
}

export async function deleteAccessToken({ db, itemId }) {
  if (!itemId) return
  await tokenDoc(db, itemId).delete()
}
