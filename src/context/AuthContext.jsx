import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
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

  useEffect(() => {
    if (MOCK_AUTH) return undefined
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setLoading(false)
    })
  }, [])

  const signInWithGoogle = () => (
    MOCK_AUTH ? Promise.resolve(setUser(MOCK_USER)) : signInWithPopup(auth, googleProvider)
  )

  const signUpWithEmail = (email, password) => (
    MOCK_AUTH ? Promise.resolve(setUser(MOCK_USER)) : createUserWithEmailAndPassword(auth, email, password)
  )

  const signInWithEmail = (email, password) => (
    MOCK_AUTH ? Promise.resolve(setUser(MOCK_USER)) : signInWithEmailAndPassword(auth, email, password)
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
    <AuthContext.Provider value={{ user, signInWithGoogle, signUpWithEmail, signInWithEmail, signOut, isMockAuth: MOCK_AUTH }}>
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
