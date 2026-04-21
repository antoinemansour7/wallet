import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const BENEFITS = [
  'Saved portfolio reloads instantly on return.',
  'CDR-aware pricing — Canadian listings stay in CAD.',
  'Live FX conversion for USD stocks in CAD accounts.',
  'Prices refreshed every 5 min via Yahoo Finance.',
]

export default function Login() {
  const { user, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [error, setError]         = useState('')
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
      setError('Could not complete Google sign-in. Please try again.')
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-wall-bg">

      {/* ── Ambient background ─────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 bg-dot-grid opacity-40" />
      <div className="pointer-events-none absolute -top-32 left-1/3 h-[480px] w-[480px] rounded-full bg-wall-green/[0.07] blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-20 right-0 h-[400px] w-[400px] rounded-full bg-amber-100/50 blur-[90px]" />

      <div className="relative mx-auto max-w-7xl px-5 py-10 lg:px-10">

        {/* ── Top nav ────────────────────────────────────────────── */}
        <nav className="mb-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-wall-green shadow-glow-green">
              <LogoMark />
            </div>
            <div className="leading-none">
              <p className="text-sm font-bold tracking-tight text-stone-900">WallAI</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">Portfolio OS</p>
            </div>
          </div>
          <span className="rounded-full border border-wall-green/20 bg-wall-green-light px-3 py-1 text-xs font-semibold text-wall-green">
            Private beta
          </span>
        </nav>

        {/* ── Main layout ────────────────────────────────────────── */}
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_400px] lg:gap-16">

          {/* ── Left: Hero ──────────────────────────────────────── */}
          <div className="animate-fade-in">

            {/* Badge */}
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-black/[0.07] bg-white px-3.5 py-1.5 text-xs font-semibold text-stone-500 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-wall-green" />
              Your brokerage spreadsheet, turned into a living dashboard.
            </div>

            {/* Headline */}
            <h1 className="mb-5 font-serif text-[clamp(2.8rem,5.5vw,5.2rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-stone-950">
              See what your<br />portfolio is really doing.
            </h1>

            <p className="mb-10 max-w-md text-[1.05rem] leading-relaxed text-stone-500">
              Upload holdings once, sign back in anytime. WallAI maps your broker's columns, fetches live prices, and gives you clean P&L with account-level context.
            </p>
          </div>

          {/* ── Right: Sign-in card ─────────────────────────────── */}
          <div className="lg:sticky lg:top-10">
            <div className="relative overflow-hidden rounded-[2rem] border border-black/[0.07] bg-white p-8 shadow-[0_20px_70px_rgba(28,28,28,0.1)]">

              {/* Decorative corner */}
              <div className="pointer-events-none absolute right-0 top-0 h-28 w-28 rounded-bl-[2rem] bg-wall-green-light opacity-70" />

              <div className="relative">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-wall-green">Sign in</p>
                <h2 className="mb-2 text-2xl font-bold tracking-[-0.03em] text-stone-950">
                  Continue to your workspace.
                </h2>
                <p className="mb-7 text-sm leading-relaxed text-stone-500">
                  Your portfolio, saved uploads, and refreshed quote cache are tied to your Google account.
                </p>

                {/* Google button */}
                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                  className="flex w-full items-center justify-center gap-3 rounded-2xl bg-stone-950 px-4 py-[14px] text-sm font-bold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-wall-green hover:shadow-glow-green disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white">
                    <GoogleIcon />
                  </span>
                  {isSigningIn ? 'Opening Google…' : 'Continue with Google'}
                </button>

                {error && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                {/* Benefits */}
                <div className="mt-7 space-y-3 border-t border-black/[0.06] pt-6">
                  {BENEFITS.map((b) => (
                    <div key={b} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-wall-green-light text-wall-green">
                        <CheckIcon />
                      </span>
                      <span className="text-sm leading-snug text-stone-600">{b}</span>
                    </div>
                  ))}
                </div>

                {/* Security note */}
                <div className="mt-6 flex items-start gap-2.5 rounded-xl bg-wall-elevated px-3.5 py-3">
                  <span className="mt-px shrink-0 text-stone-400"><LockIcon /></span>
                  <p className="text-xs leading-relaxed text-stone-400">
                    Authentication via Firebase. API keys and market data providers stay server-side only.
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-4 text-center text-xs leading-relaxed text-stone-400">
              By continuing, you agree to use WallAI for tracking only — not financial advice.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
      <path d="M2 16L7 9L11 13L15 6L20 10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 19h18" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
    </svg>
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
