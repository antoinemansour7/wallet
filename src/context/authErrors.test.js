import { describe, it, expect } from 'vitest'
import { getAuthErrorMessage } from './authErrors'

describe('getAuthErrorMessage', () => {
  it('never says which of email or password was wrong on sign-in', () => {
    const message = 'Incorrect email or password.'
    expect(getAuthErrorMessage({ code: 'auth/invalid-credential' }, 'signin')).toBe(message)
    expect(getAuthErrorMessage({ code: 'auth/wrong-password' }, 'signin')).toBe(message)
    expect(getAuthErrorMessage({ code: 'auth/user-not-found' }, 'signin')).toBe(message)
  })

  it('tells a sign-up attempt the address is taken, without naming the other provider', () => {
    expect(getAuthErrorMessage({ code: 'auth/email-already-in-use' }, 'signup')).toBe(
      'An account with this email already exists. Try signing in instead.',
    )
  })

  it('gives the same neutral copy when Google collides with an existing password account', () => {
    expect(getAuthErrorMessage({ code: 'auth/account-exists-with-different-credential' }, 'signin')).toBe(
      'An account with this email already exists. Try signing in instead.',
    )
  })

  it('flags a linking collision without naming the other provider', () => {
    const message = 'This email is already linked to a different account.'
    expect(getAuthErrorMessage({ code: 'auth/credential-already-in-use' }, 'link')).toBe(message)
    expect(getAuthErrorMessage({ code: 'auth/email-already-in-use' }, 'link')).toBe(message)
  })

  it('covers weak password, invalid email, rate limiting, and stale sessions', () => {
    expect(getAuthErrorMessage({ code: 'auth/weak-password' })).toBe(
      'Choose a password with at least 6 characters.',
    )
    expect(getAuthErrorMessage({ code: 'auth/invalid-email' })).toBe('Enter a valid email address.')
    expect(getAuthErrorMessage({ code: 'auth/too-many-requests' })).toBe(
      'Too many attempts. Wait a few minutes and try again.',
    )
    expect(getAuthErrorMessage({ code: 'auth/requires-recent-login' }, 'link')).toBe(
      'Please sign in again, then try adding a password.',
    )
  })

  it('falls back to the raw message for a non-Firebase error', () => {
    expect(getAuthErrorMessage({ code: 'something-else', message: 'raw message' })).toBe('raw message')
  })

  it('falls back to a generic sentence when there is no message at all', () => {
    expect(getAuthErrorMessage({})).toBe('Could not complete the request. Please try again.')
  })

  it('does not leak the raw Firebase message for an unmapped auth/* code, e.g. user-disabled', () => {
    expect(
      getAuthErrorMessage({ code: 'auth/user-disabled', message: 'The user account has been disabled by an administrator.' }),
    ).toBe('Could not complete the request. Please try again.')
  })

  it('covers the domain, API key, provider configuration, and popup errors carried over from Login.jsx', () => {
    expect(getAuthErrorMessage({ code: 'auth/unauthorized-domain' })).toBe(
      'This domain is not allowed in Firebase Auth. Add the Vercel domain to Firebase Authentication authorized domains.',
    )
    expect(getAuthErrorMessage({ code: 'auth/invalid-api-key' })).toBe(
      'Firebase API key is missing or invalid in Vercel environment variables.',
    )
    expect(getAuthErrorMessage({ code: 'auth/api-key-not-valid' })).toBe(
      'Firebase API key is missing or invalid in Vercel environment variables.',
    )
    expect(getAuthErrorMessage({ code: 'auth/configuration-not-found' })).toBe(
      'This sign-in provider is not enabled for this Firebase project.',
    )
    expect(getAuthErrorMessage({ code: 'auth/operation-not-allowed' })).toBe(
      'This sign-in provider is not enabled for this Firebase project.',
    )
    expect(getAuthErrorMessage({ code: 'auth/popup-blocked' })).toBe(
      'The Google sign-in popup was blocked by your browser.',
    )
    expect(getAuthErrorMessage({ code: 'auth/popup-closed-by-user' })).toBe(
      'The Google sign-in popup was closed before sign-in finished.',
    )
  })
})
