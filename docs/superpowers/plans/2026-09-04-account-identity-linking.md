# Account Identity & Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `AuthContext.jsx` the identity primitives a second sign-in provider needs — email/password sign-up and sign-in, and linking a password credential onto an already-authenticated Google user — so the same person never ends up with two `uid`s and two empty portfolios.

**Architecture:** All new logic lives in `src/context/AuthContext.jsx`, following the file's existing pattern (a thin wrapper around the `firebase/auth` SDK functions, with a `MOCK_AUTH` bypass branch on every method). A new exported `getAuthErrorMessage(err, context)` helper centralizes neutral, non-enumerating copy for the Firebase error codes this feature can hit. Nothing in `src/pages/Login.jsx` changes — the screens (one card, two states, keyboard/autofill polish) are issue #49's job and depend on this work, not the other way around. This plan does not write a data migration: investigation (documented in Task 4) confirms none is needed today.

**Tech Stack:** React 18, Firebase JS SDK 10.12 (`firebase/auth`), Vitest 4 + `@testing-library/react` 16 (`renderHook`/`act`), jsdom.

**Spec:** GitHub issues on `antoinemansour7/wallet` — [#48](https://github.com/antoinemansour7/wallet/issues/48) (this plan's scope), decision recorded in [#47](https://github.com/antoinemansour7/wallet/issues/47#issuecomment) (closing comment), sibling epic [#46](https://github.com/antoinemansour7/wallet/issues/46). Current Firebase behavior verified live against https://firebase.google.com/docs/auth/web/account-linking and https://cloud.google.com/identity-platform/docs/admin/email-enumeration-protection on 2026-09-04 rather than assumed from training data.

## Global Constraints

- Ship email/password alongside the existing Google popup provider — decided in #47, not re-argued here.
- "One account per email address" is the hard guard against duplicate identities. It is a Firebase Console setting, not code — Task 4 verifies it, this plan does not change it.
- Do not use `fetchSignInMethodsForEmail`. It is deprecated and, with Email Enumeration Protection enabled, returns an empty list unconditionally — it cannot be used to detect an existing account. (Confirmed live against Firebase's docs 2026-09-04.)
- Offer provider linking only *after* the person has authenticated with their existing account. Never probe an email address pre-auth to decide what to offer.
- Error copy must never reveal which of email/password was wrong (`auth/wrong-password` vs `auth/user-not-found`), nor which provider an existing account uses.
- `createUserWithEmailAndPassword` still returns `auth/email-already-in-use` on a duplicate even with Email Enumeration Protection on — that channel is intentionally left honest by Firebase. Sign-*in* failures (`auth/invalid-credential`, replacing the old `auth/wrong-password`/`auth/user-not-found` pair) are the ones Enumeration Protection flattens.
- No data migration: only Google accounts exist today (single provider in production), so no user can already have two `uid`s. Task 4 records this in writing on #48 rather than building a migration speculatively.
- Run tests via `npm run test:run` (or `npm test` for watch mode) — never raw `npx vitest`. The project's `test` scripts set `VITE_MOCK_AUTH=false` and `NODE_ENV=test`; invoking vitest directly skips that and loads the production React build, producing phantom failures unrelated to the code under test.
- Do not touch `src/pages/Login.jsx` or `src/pages/Login.test.jsx` — that surface belongs to #49.

---

## File Structure

- **Modify:** `src/context/AuthContext.jsx` — add `signUpWithEmail`, `signInWithEmail`, `linkPasswordToCurrentUser`, and the exported `getAuthErrorMessage` helper. All follow the existing `MOCK_AUTH` bypass pattern already used by `signInWithGoogle`/`signOut`.
- **Create:** `src/context/AuthContext.test.jsx` — unit tests for the four additions above, mocking `firebase/auth` and `../firebase/config` the same way `src/pages/Login.test.jsx` mocks its dependencies.

No other files change. `portfolioHistory.js:87`'s `setDoc(..., entry, { merge: true })` was audited while reading this spec: `entry` is always written as a complete flat object (every field defaulted with `?? 0`), so unlike #13's `accounts` map there is no key that can be silently left behind by the merge — it's safe as-is, and Task 4's write-up notes this so it isn't re-investigated later.

---

## Task 1: Email/password sign-up and sign-in

**Files:**
- Modify: `src/context/AuthContext.jsx`
- Test: `src/context/AuthContext.test.jsx` (new file, created in this task)

**Interfaces:**
- Produces: `signUpWithEmail(email: string, password: string): Promise<UserCredential>`, `signInWithEmail(email: string, password: string): Promise<UserCredential>` — both exposed on the `AuthContext` value alongside the existing `signInWithGoogle`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

Create `src/context/AuthContext.test.jsx`:

```jsx
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

import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/context/AuthContext.test.jsx`
Expected: FAIL — `result.current.signUpWithEmail is not a function` (and the same for `signInWithEmail`).

- [ ] **Step 3: Implement `signUpWithEmail` and `signInWithEmail`**

In `src/context/AuthContext.jsx`, add the two new imports to the existing `firebase/auth` import on line 2:

```js
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth'
```

Add the two functions next to `signInWithGoogle` (after line 63):

```js
  const signUpWithEmail = (email, password) => (
    MOCK_AUTH ? Promise.resolve(setUser(MOCK_USER)) : createUserWithEmailAndPassword(auth, email, password)
  )

  const signInWithEmail = (email, password) => (
    MOCK_AUTH ? Promise.resolve(setUser(MOCK_USER)) : signInWithEmailAndPassword(auth, email, password)
  )
```

Add both to the context value (the `<AuthContext.Provider value={{ ... }}>` on line 78):

```js
    <AuthContext.Provider value={{ user, signInWithGoogle, signUpWithEmail, signInWithEmail, signOut, isMockAuth: MOCK_AUTH }}>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/context/AuthContext.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/context/AuthContext.jsx src/context/AuthContext.test.jsx
git commit -m "feat(auth): add email/password sign-up and sign-in"
```

---

## Task 2: Link a password credential onto the current session

**Files:**
- Modify: `src/context/AuthContext.jsx`
- Test: `src/context/AuthContext.test.jsx`

**Interfaces:**
- Consumes: the `firebase/auth` and `../firebase/config` mocks set up in Task 1.
- Produces: `linkPasswordToCurrentUser(password: string): Promise<UserCredential>` on the `AuthContext` value. Rejects with a plain `Error` (message: `'No signed-in user to link a password to.'`) when `auth.currentUser` is falsy — this is the "only after authenticated" guard from #48, enforced in code rather than left to the caller.

- [ ] **Step 1: Write the failing tests**

Append to `src/context/AuthContext.test.jsx`:

```jsx
import { linkWithCredential, EmailAuthProvider } from 'firebase/auth'

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
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/context/AuthContext.test.jsx`
Expected: FAIL — `result.current.linkPasswordToCurrentUser is not a function`

- [ ] **Step 3: Implement `linkPasswordToCurrentUser`**

Add `linkWithCredential` and `EmailAuthProvider` to the `firebase/auth` import block from Task 1:

```js
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  linkWithCredential,
  EmailAuthProvider,
} from 'firebase/auth'
```

Add the function next to `signInWithEmail`:

```js
  const linkPasswordToCurrentUser = (password) => {
    if (MOCK_AUTH) return Promise.resolve(setUser(MOCK_USER))
    if (!auth.currentUser) return Promise.reject(new Error('No signed-in user to link a password to.'))
    const credential = EmailAuthProvider.credential(auth.currentUser.email, password)
    return linkWithCredential(auth.currentUser, credential)
  }
```

Add it to the context value:

```js
    <AuthContext.Provider value={{ user, signInWithGoogle, signUpWithEmail, signInWithEmail, linkPasswordToCurrentUser, signOut, isMockAuth: MOCK_AUTH }}>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/context/AuthContext.test.jsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/context/AuthContext.jsx src/context/AuthContext.test.jsx
git commit -m "feat(auth): link a password credential onto the current session"
```

---

## Task 3: Neutral-copy error mapping

**Files:**
- Modify: `src/context/AuthContext.jsx`
- Test: `src/context/AuthContext.test.jsx`

**Interfaces:**
- Produces: `export function getAuthErrorMessage(err, context = 'signin')` where `context` is one of `'signup' | 'signin' | 'link'`. Exported as a named export (not on the context value) so #49 can import it directly into `Login.jsx` without instantiating a provider.
- Consumes: nothing from Tasks 1–2; standalone, but grouped here because it exists to give those two tasks' callers safe copy.

- [ ] **Step 1: Write the failing tests**

Append to `src/context/AuthContext.test.jsx`:

```jsx
import { getAuthErrorMessage } from './AuthContext'

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

  it('falls back to the raw Firebase message for an unrecognized code', () => {
    expect(getAuthErrorMessage({ code: 'auth/something-new', message: 'raw message' })).toBe('raw message')
  })

  it('falls back to a generic sentence when there is no message at all', () => {
    expect(getAuthErrorMessage({})).toBe('Could not complete the request. Please try again.')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/context/AuthContext.test.jsx`
Expected: FAIL — `getAuthErrorMessage is not a function` (or not exported)

- [ ] **Step 3: Implement `getAuthErrorMessage`**

Add above `export function useAuth()` at the bottom of `src/context/AuthContext.jsx`:

```js
const EXISTING_ACCOUNT_MESSAGE = 'An account with this email already exists. Try signing in instead.'
const LINK_COLLISION_MESSAGE = 'This email is already linked to a different account.'

export function getAuthErrorMessage(err, context = 'signin') {
  switch (err?.code) {
    case 'auth/email-already-in-use':
      return context === 'link' ? LINK_COLLISION_MESSAGE : EXISTING_ACCOUNT_MESSAGE
    case 'auth/account-exists-with-different-credential':
      return EXISTING_ACCOUNT_MESSAGE
    case 'auth/credential-already-in-use':
      return LINK_COLLISION_MESSAGE
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.'
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/weak-password':
      return 'Choose a password with at least 6 characters.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/requires-recent-login':
      return 'Please sign in again, then try adding a password.'
    default:
      return err?.message || 'Could not complete the request. Please try again.'
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/context/AuthContext.test.jsx`
Expected: PASS (all tests in the file — 12 total)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm run test:run`
Expected: PASS — including the pre-existing `src/pages/Login.test.jsx`, which this plan does not touch.

- [ ] **Step 6: Commit**

```bash
git add src/context/AuthContext.jsx src/context/AuthContext.test.jsx
git commit -m "feat(auth): neutral, non-enumerating copy for identity errors"
```

---

## Task 4: Firebase Console guard check + written migration decision

This task has no automated test — it verifies an external setting and records a decision, per #48's own "Done when: whether a migration is required is answered in writing" criterion. Do this after Tasks 1–3 land, since the written decision references the code that now exists.

**Files:** none (GitHub issue comment only)

- [ ] **Step 1: Verify the Firebase Console guard**

In Firebase Console → Authentication → Settings → User account linking, confirm **"One account per email address"** is selected (not "Multiple accounts per email address"). This was decided in #47; this step only confirms it was actually applied, since #47 was a decision record, not a change log. This is manual — Claude Code has no Firebase Console access. If it is not set correctly, stop and flag it back rather than proceeding.

- [ ] **Step 2: Post the migration determination to #48**

```bash
gh issue comment 48 --repo antoinemansour7/wallet --body "$(cat <<'EOF'
## Migration decision: none needed

Production currently has exactly one sign-in provider (Google), so no user can already hold two `uid`s for the same identity — that failure mode requires a second provider to have existed, and it hasn't yet. There is nothing to migrate.

Going forward, duplicate identities are prevented at the point they'd be created, not cleaned up after: "One account per email address" is enabled in Firebase Console (verified against this issue), and `linkPasswordToCurrentUser` (added in this branch) is the only path that attaches a password credential to an account — it requires an authenticated session first, so a password can only ever be added to the Google account that's already signed in, never to a fresh one.

If a duplicate-identity user is ever discovered in production despite the guard, that is a new, narrowly-scoped bug report against this reasoning — not evidence a migration should have been written speculatively here.

## portfolioHistory.js merge:true audit

Flagged as worth checking while identity code changes: `saveDailySnapshot` in `src/utils/portfolioHistory.js:87` writes `setDoc(doc(db, 'users', uid, 'portfolio-history', entry.date), entry, { merge: true })`. Unlike #13's `accounts` map, `entry` is a flat object with every field defaulted (`?? 0`) before the write — there is no field that can be silently left stale by the merge, because every field is always present in the payload. No change needed.

## What landed here (AuthContext.jsx)

- `signUpWithEmail` / `signInWithEmail` — the email/password provider itself.
- `linkPasswordToCurrentUser` — links a password credential onto the signed-in user's existing `uid`; rejects if nobody is signed in, enforcing "offer linking only after authentication" in code.
- `getAuthErrorMessage(err, context)` — neutral copy for every error code this flow can hit, including the Google/password collision case, ready for #49 to wire into the sign-in/sign-up card.

Not done here, by design: no UI changes (#49's scope), no fetchSignInMethodsForEmail anywhere (deprecated and unreliable under Email Enumeration Protection — confirmed against current Firebase docs), no speculative migration.
EOF
)"
```

- [ ] **Step 3: Confirm with the user before closing anything**

Do not close #48. Two of its "done when" items — proving the linked flow in a live test project, and the address-already-exists explanation reaching an actual screen — depend on #49's UI. Leave #48 open with the comment as a checkpoint, and let the user decide whether to also open the still-uncreated "implement the chosen provider" epic line item or fold that into #49.
