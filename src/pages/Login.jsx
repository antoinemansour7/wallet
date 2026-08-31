import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Logo } from '../components/Navbar'

const BENEFITS = [
  'Portfolio syncs across all your devices.',
  'CDR-aware pricing — Canadian listings stay in CAD.',
  'Live FX conversion for USD stocks in CAD accounts.',
  'Prices auto-refresh every 5 minutes.',
]

const FEATURE_CHIPS = [
  { color: '#34d399', label: 'Live market prices' },
  { color: '#a1a1aa', label: 'AI-parsed holdings' },
  { color: 'rgba(255,255,255,0.4)', label: 'CDR · CAD · FX support' },
]

function getSignInErrorMessage(err) {
  switch (err?.code) {
    case 'auth/unauthorized-domain':
      return 'This domain is not allowed in Firebase Auth. Add the Vercel domain to Firebase Authentication authorized domains.'
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
      return 'Firebase API key is missing or invalid in Vercel environment variables.'
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return 'This sign-in provider is not enabled for this Firebase project.'
    case 'auth/popup-blocked':
      return 'The Google sign-in popup was blocked by your browser.'
    case 'auth/popup-closed-by-user':
      return 'The Google sign-in popup was closed before sign-in finished.'
    default:
      return err?.message || 'Could not complete sign-in. Please try again.'
  }
}

export default function Login() {
  const { user, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [error, setError]           = useState('')
  const [isSigningIn, setSigningIn] = useState(false)

  useEffect(() => {
    if (user) navigate('/portfolio', { replace: true })
  }, [user, navigate])

  const handleSignIn = async () => {
    setError('')
    setSigningIn(true)
    try {
      await signInWithGoogle()
    } catch (err) {
      console.error('Sign-in failed:', err)
      setError(getSignInErrorMessage(err))
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-wall-bg">
      {/* Background glow — warm ambient blobs, WS style */}
      <div className="blob-drift pointer-events-none absolute -top-40 left-1/4 h-[700px] w-[700px] rounded-full bg-accent/[0.10] blur-[160px]" />
      <div className="blob-drift-late pointer-events-none absolute bottom-0 right-1/4 h-[400px] w-[400px] rounded-full bg-gain/[0.07] blur-[120px]" />

      {/* Nav */}
      <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-8 py-6">
        <Logo size={36} />
        <span className="rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-white/50">
          Private beta
        </span>
      </nav>

      {/* Main content */}
      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-16 px-8 pb-20 pt-16 lg:grid-cols-[1fr_420px]">

        {/* Left — hero */}
        <div className="animate-fade-in">
          <h1 className="mb-6 font-display text-[clamp(3rem,6vw,5.5rem)] font-semibold leading-[1.0] tracking-[-0.03em] text-white">
            See what your<br />portfolio is<br /><span className="text-gradient">really doing.</span>
          </h1>

          <p className="mb-10 max-w-md text-lg leading-relaxed text-white/45">
            Upload holdings from any broker, sign back in anytime. WallAI maps your columns, fetches live prices, and gives you clean P&amp;L with account-level context.
          </p>

          <div className="flex flex-wrap gap-3">
            {FEATURE_CHIPS.map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sm text-white/60">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right — sign-in card */}
        <div className="animate-fade-in rounded-card border border-white/10 bg-wall-surface p-8 [animation-delay:150ms] [animation-fill-mode:backwards]">
          <h2 className="mb-1.5 font-display text-2xl font-semibold leading-tight text-white">
            Continue to<br />your workspace.
          </h2>
          <p className="mb-8 text-sm leading-relaxed text-white/40">
            Your portfolio, saved uploads, and price cache are tied to your Google account.
          </p>

          <button
            type="button"
            onClick={handleSignIn}
            disabled={isSigningIn}
            className="flex w-full items-center justify-center gap-3 rounded-full bg-gradient-accent px-4 py-[14px] text-sm font-semibold text-brand shadow-glow-sm transition-all duration-ws ease-ws hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GoogleIcon />
            {isSigningIn ? 'Opening Google…' : 'Continue with Google'}
          </button>

          {error && (
            <div className="mt-4 rounded-xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
              {error}
            </div>
          )}

          <div className="mt-7 space-y-3 border-t border-white/[0.08] pt-6">
            {BENEFITS.map((b) => (
              <div key={b} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gain/20 text-gain">
                  <CheckIcon />
                </span>
                <span className="text-sm leading-snug text-white/50">{b}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.04] px-3.5 py-3">
            <span className="mt-px shrink-0 text-white/30"><LockIcon /></span>
            <p className="text-xs leading-relaxed text-white/30">
              Auth via Firebase. API keys and market data providers stay server-side only.
            </p>
          </div>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-white/20">
            For portfolio tracking only — not financial advice.
          </p>
        </div>

      </div>
    </main>
  )
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M10 3L4.75 8.25L2 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}
