import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  linkWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { auth, googleProvider } from '../firebase/config'

const AuthContext = createContext(null)

/**
 * Sign-in bypass for hosts Firebase will never authorize.
 *
 * Firebase Auth checks the domain the app is served from against an exact-match
 * allowlist — no wildcards, and subdomains are not inherited. Preview sandboxes
 * (v0, Codespaces, ngrok) mint a fresh random hostname per session, so there is
 * no domain to add: it is different every time you open the tool. That makes
 * real sign-in impossible there, not merely inconvenient.
 *
 * Two conditions, and BOTH must hold:
 *   · VITE_MOCK_AUTH is set
 *   · import.meta.hot exists — the dev server's HMR client, which only the dev
 *     server injects and `vite build` strips, taking this branch with it
 *
 * The second half is the safety property: the flag cannot be turned on in a
 * built bundle even by setting the variable, because there is no branch left to
 * enable. Authentication that an environment variable can switch off is not
 * authentication.
 *
 * import.meta.hot rather than import.meta.env.DEV on purpose. DEV is derived
 * from the mode, which NODE_ENV can override — a shell exporting
 * NODE_ENV=production makes DEV false even under `vite dev`, and the bypass
 * then silently fails to engage in precisely the sandbox it exists for. HMR
 * presence answers "is this the dev server" directly rather than by inference.
 */
const MOCK_AUTH = Boolean(import.meta.hot) && import.meta.env.VITE_MOCK_AUTH === 'true'

const MOCK_USER = {
  uid: 'mock-preview-user',
  displayName: 'Preview User',
  email: 'preview@example.com',
  photoURL: null,
}

function MockAuthBanner() {
  return (
    <div className="fixed bottom-3 left-1/2 z-[100] -translate-x-1/2 rounded-full border border-warning/30 bg-warning/[0.12] px-3.5 py-1.5 text-[11px] font-medium text-warning backdrop-blur-sm">
      Mock sign-in — not a real session
    </div>
  )
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(MOCK_AUTH ? MOCK_USER : null)
  const [loading, setLoading] = useState(!MOCK_AUTH)
  const [isResearchOwner, setIsResearchOwner] = useState(false)

  useEffect(() => {
    if (MOCK_AUTH) return undefined
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setLoading(false)
    })
  }, [])

  // A cheap, storage-free check so the account menu can decide whether to show
  // any research-owner navigation at all, without shipping the owner's
  // identity into the public bundle. Every signed-in session may call it; only
  // the actual owner gets back true.
  useEffect(() => {
    if (!user?.getIdToken) { setIsResearchOwner(false); return undefined }
    let cancelled = false
    user.getIdToken()
      .then((token) => fetch('/api/get-research?owner=1', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }))
      .then((response) => { if (!cancelled) setIsResearchOwner(response.ok) })
      .catch(() => { if (!cancelled) setIsResearchOwner(false) })
    return () => { cancelled = true }
  }, [user])

  const signInWithGoogle = () => (
    MOCK_AUTH ? Promise.resolve(setUser(MOCK_USER)) : signInWithPopup(auth, googleProvider)
  )

  const signUpWithEmail = (email, password) => (
    MOCK_AUTH ? Promise.resolve(setUser(MOCK_USER)) : createUserWithEmailAndPassword(auth, email, password)
  )

  const signInWithEmail = (email, password) => (
    MOCK_AUTH ? Promise.resolve(setUser(MOCK_USER)) : signInWithEmailAndPassword(auth, email, password)
  )

  const linkPasswordToCurrentUser = (password) => {
    if (MOCK_AUTH) return Promise.resolve(setUser(MOCK_USER))
    if (!auth.currentUser) return Promise.reject(new Error('No signed-in user to link a password to.'))
    const credential = EmailAuthProvider.credential(auth.currentUser.email, password)
    return linkWithCredential(auth.currentUser, credential)
  }

  /**
   * Firebase resolves this whether or not the address has an account — Email
   * Enumeration Protection deliberately removes the "no such user" error, so
   * there is nothing here to distinguish the two cases and nothing the caller
   * can leak. The confirmation copy has to be neutral for the same reason.
   */
  const resetPassword = (email) => (
    MOCK_AUTH ? Promise.resolve() : sendPasswordResetEmail(auth, email)
  )

  const signOut = () => (
    MOCK_AUTH ? Promise.resolve(setUser(null)) : firebaseSignOut(auth)
  )

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-wall-bg">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500/30 border-t-blue-500" />
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, signInWithGoogle, signUpWithEmail, signInWithEmail, linkPasswordToCurrentUser, resetPassword, signOut, isMockAuth: MOCK_AUTH, isResearchOwner }}>
      {children}
      {/* Always visible while mocked. A bypass you can forget is running is the
          one that ends up demoed to someone as if it were real. */}
      {MOCK_AUTH && <MockAuthBanner />}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
