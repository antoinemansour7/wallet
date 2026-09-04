import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
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

import { createUserWithEmailAndPassword, signInWithEmailAndPassword, linkWithCredential, EmailAuthProvider } from 'firebase/auth'
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
