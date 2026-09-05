import { describe, it, expect, vi } from 'vitest'
import { writeAccessToken, readAccessToken, deleteAccessToken, clearLegacyAccessToken } from './plaidTokens'

/**
 * A Firestore double that records where things land, because *where* is the
 * whole point of this module — a token in the right place with the wrong
 * contents is a bug, and a token with the right contents in the user's subtree
 * is the vulnerability being fixed.
 */
function fakeDb(seed = {}) {
  const store = { ...seed }
  const deleted = []

  const docRef = (path) => ({
    path,
    get: async () => ({ exists: path in store, data: () => store[path] }),
    set: async (data, opts) => {
      store[path] = opts?.merge ? { ...(store[path] || {}), ...data } : data
    },
    delete: async () => { deleted.push(path); delete store[path] },
  })

  const db = {
    collection: (name) => ({
      doc: (id) => ({
        ...docRef(`${name}/${id}`),
        collection: (sub) => ({ doc: (subId) => docRef(`${name}/${id}/${sub}/${subId}`) }),
      }),
    }),
  }

  return { db, store, deleted }
}

describe('writeAccessToken', () => {
  it('stores the credential outside any user subtree', () => {
    const { db, store } = fakeDb()
    return writeAccessToken({ db, uid: 'u1', itemId: 'item1', accessToken: 'access-sandbox-123' }).then(() => {
      // The path must not begin with users/. That prefix is what a rule like
      // `match /users/{uid}/{document=**}` reaches, and reaching it is the
      // whole problem.
      const paths = Object.keys(store)
      expect(paths).toEqual(['plaidTokens/item1'])
      expect(paths[0].startsWith('users/')).toBe(false)
      expect(store['plaidTokens/item1']).toMatchObject({ accessToken: 'access-sandbox-123', uid: 'u1', itemId: 'item1' })
    })
  })

  it('refuses to write a token with nothing to key it on', async () => {
    const { db } = fakeDb()
    await expect(writeAccessToken({ db, uid: 'u1', accessToken: 't' })).rejects.toThrow(/itemId/)
    await expect(writeAccessToken({ db, uid: 'u1', itemId: 'i' })).rejects.toThrow(/accessToken/)
  })
})

describe('readAccessToken', () => {
  it('reads from the safe collection when the token is already there', async () => {
    const { db } = fakeDb({ 'plaidTokens/item1': { accessToken: 'new-token' } })
    expect(await readAccessToken({ db, uid: 'u1', itemId: 'item1' })).toBe('new-token')
  })

  it('falls back to a connection made before the split', async () => {
    const { db } = fakeDb({ 'users/u1/plaid/item1': { accessToken: 'legacy-token', institution: 'Questrade' } })
    expect(await readAccessToken({ db, uid: 'u1', itemId: 'item1' })).toBe('legacy-token')
  })

  it('migrates a legacy token in passing, and clears it from the old place', async () => {
    const { db, store } = fakeDb({ 'users/u1/plaid/item1': { accessToken: 'legacy-token', institution: 'Questrade' } })

    await readAccessToken({ db, uid: 'u1', itemId: 'item1' })

    expect(store['plaidTokens/item1'].accessToken).toBe('legacy-token')
    expect(store['users/u1/plaid/item1'].accessToken).toBeNull()
    // The rest of the connection is untouched — it is still read on every
    // refresh, so the migration must not take it with the token.
    expect(store['users/u1/plaid/item1'].institution).toBe('Questrade')
  })

  it('accepts already-loaded legacy data instead of re-reading it', async () => {
    const { db } = fakeDb()
    const token = await readAccessToken({
      db, uid: 'u1', itemId: 'item1', legacyData: { accessToken: 'from-caller' }, migrate: false,
    })
    expect(token).toBe('from-caller')
  })

  it('can skip the migration when the token is about to be revoked anyway', async () => {
    const { db, store } = fakeDb({ 'users/u1/plaid/item1': { accessToken: 'legacy-token' } })

    await readAccessToken({ db, uid: 'u1', itemId: 'item1', migrate: false })

    // Copying it to the safe collection first would only create something to
    // clean up a moment later.
    expect(store['plaidTokens/item1']).toBeUndefined()
    expect(store['users/u1/plaid/item1'].accessToken).toBe('legacy-token')
  })

  it('returns null when there is no token in either place', async () => {
    const { db } = fakeDb()
    expect(await readAccessToken({ db, uid: 'u1', itemId: 'missing' })).toBeNull()
    expect(await readAccessToken({ db, uid: 'u1' })).toBeNull()
  })
})

describe('clearLegacyAccessToken', () => {
  it('uses Firestore’s delete sentinel to remove the field outright when given one', async () => {
    const { db, store } = fakeDb({ 'users/u1/plaid/item1': { accessToken: 'legacy', institution: 'Questrade' } })
    const sentinel = { __delete: true }
    const FieldValue = { delete: vi.fn(() => sentinel) }

    await clearLegacyAccessToken({ db, uid: 'u1', itemId: 'item1', FieldValue })

    expect(FieldValue.delete).toHaveBeenCalled()
    expect(store['users/u1/plaid/item1'].accessToken).toBe(sentinel)
  })

  it('falls back to null, which still stops the credential being readable', async () => {
    const { db, store } = fakeDb({ 'users/u1/plaid/item1': { accessToken: 'legacy' } })
    await clearLegacyAccessToken({ db, uid: 'u1', itemId: 'item1' })
    expect(store['users/u1/plaid/item1'].accessToken).toBeNull()
  })
})

describe('deleteAccessToken', () => {
  it('removes the token so it does not outlive the connection', async () => {
    const { db, deleted } = fakeDb({ 'plaidTokens/item1': { accessToken: 't' } })
    await deleteAccessToken({ db, itemId: 'item1' })
    expect(deleted).toEqual(['plaidTokens/item1'])
  })

  it('does nothing without an item id', async () => {
    const { db, deleted } = fakeDb()
    await deleteAccessToken({ db })
    expect(deleted).toEqual([])
  })
})
