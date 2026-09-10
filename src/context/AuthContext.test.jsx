import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

vi.mock('../firebase/config', () => ({
  auth: { currentUser: null },
  googleProvider: {},
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth, cb) => {
    cb(null)
    return vi.fn()
  }),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  linkWithCredential: vi.fn(),
  EmailAuthProvider: {
    credential: vi.fn((email, password) => ({ email, password, providerId: 'password' })),
  },
}))

import { createUserWithEmailAndPassword, signInWithEmailAndPassword, linkWithCredential, EmailAuthProvider, onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/config'

function wrapper({ children }) {
  return <AuthProvider>{children}</AuthProvider>
}

describe('AuthContext email/password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.currentUser = null
  })

  it('signUpWithEmail calls createUserWithEmailAndPassword with the auth instance, email, and password', async () => {
    createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'new-uid' } })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.signUpWithEmail('a@b.com', 'secret1')
    })

    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(auth, 'a@b.com', 'secret1')
  })

  it('signInWithEmail calls signInWithEmailAndPassword with the auth instance, email, and password', async () => {
    signInWithEmailAndPassword.mockResolvedValue({ user: { uid: 'existing-uid' } })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.signInWithEmail('a@b.com', 'secret1')
    })

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(auth, 'a@b.com', 'secret1')
  })

  it('signUpWithEmail propagates a rejection instead of swallowing it', async () => {
    createUserWithEmailAndPassword.mockRejectedValue({ code: 'auth/email-already-in-use' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await expect(result.current.signUpWithEmail('a@b.com', 'secret1')).rejects.toMatchObject({
      code: 'auth/email-already-in-use',
    })
  })
})

describe('AuthContext linking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.currentUser = null
  })

  it('links a password credential to the signed-in user, built from their existing email', async () => {
    auth.currentUser = { uid: 'existing-uid', email: 'a@b.com' }
    linkWithCredential.mockResolvedValue({ user: { uid: 'existing-uid' } })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.linkPasswordToCurrentUser('secret1')
    })

    expect(EmailAuthProvider.credential).toHaveBeenCalledWith('a@b.com', 'secret1')
    expect(linkWithCredential).toHaveBeenCalledWith(
      auth.currentUser,
      { email: 'a@b.com', password: 'secret1', providerId: 'password' },
    )
  })

  it('refuses to link when nobody is signed in, without calling Firebase', async () => {
    auth.currentUser = null
    const { result } = renderHook(() => useAuth(), { wrapper })

    await expect(result.current.linkPasswordToCurrentUser('secret1')).rejects.toThrow(
      'No signed-in user to link a password to.',
    )
    expect(linkWithCredential).not.toHaveBeenCalled()
  })

  it('linkPasswordToCurrentUser propagates a rejection instead of swallowing it', async () => {
    auth.currentUser = { uid: 'existing-uid', email: 'a@b.com' }
    linkWithCredential.mockRejectedValue({ code: 'auth/credential-already-in-use' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await expect(result.current.linkPasswordToCurrentUser('secret1')).rejects.toMatchObject({
      code: 'auth/credential-already-in-use',
    })
  })
})

describe('AuthContext research-owner check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.currentUser = null
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    // Restore the default "signed out" behaviour so an override here can
    // never leak into another describe block's tests.
    onAuthStateChanged.mockImplementation((_auth, cb) => { cb(null); return vi.fn() })
  })

  it('flags the signed-in user as the research owner once the server confirms it', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => {
      cb({ uid: 'owner', getIdToken: async () => 'owner-token' })
      return vi.fn()
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))
    const { result } = renderHook(() => useAuth(), { wrapper })

    await waitFor(() => expect(result.current.isResearchOwner).toBe(true))
    expect(fetch).toHaveBeenCalledWith('/api/get-research?owner=1', expect.objectContaining({
      headers: { Authorization: 'Bearer owner-token' }, cache: 'no-store',
    }))
  })

  it('does not flag a regular signed-in user, since the server refused them', async () => {
    onAuthStateChanged.mockImplementation((_auth, cb) => {
      cb({ uid: 'someone-else', getIdToken: async () => 'a-token' })
      return vi.fn()
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const { result } = renderHook(() => useAuth(), { wrapper })

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(result.current.isResearchOwner).toBe(false)
  })

  it('never calls the owner check for a signed-out session', () => {
    vi.stubGlobal('fetch', vi.fn())
    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isResearchOwner).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})
