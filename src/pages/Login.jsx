import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const FEATURE_CARDS = [
  {
    label: 'Upload once',
    text: 'Your CSV is saved to your account, so the dashboard is ready when you return.',
  },
  {
    label: 'Live-aware pricing',
    text: 'US stocks, Canadian CDRs, and FX quotes are refreshed through cached market data.',
  },
  {
    label: 'Built for holdings',
    text: 'Portfolio value, all-time P&L, account allocation, and position-level movement.',
  },
]

const METRICS = [
  { value: '5 min', label: 'quote cache window' },
  { value: 'CDR', label: 'aware symbol routing' },
  { value: 'CSV', label: 'source of truth' },
]

export default function Login() {
  const { user, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)

  useEffect(() => {
    if (user) navigate('/portfolio', { replace: true })
  }, [user, navigate])

  const handleSignIn = async () => {
    setError('')
    setIsSigningIn(true)

    try {
      await signInWithGoogle()
    } catch (err) {
      console.error('Sign-in failed:', err)
      setError('Could not complete Google sign-in. Please try again.')
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-wall-bg text-stone-900">
      <div className="absolute inset-0 bg-dot-grid opacity-70" />
      <div className="absolute -left-28 top-10 h-80 w-80 rounded-full bg-wall-green/10 blur-3xl" />
      <div className="absolute bottom-[-120px] right-[-80px] h-[420px] w-[420px] rounded-full bg-amber-200/40 blur-3xl" />

      <div className="relative mx-auto grid min-h-screen max-w-7xl grid-cols-1 px-5 py-6 lg:grid-cols-[1.08fr_0.92fr] lg:px-8">
        <section className="flex min-h-[52vh] flex-col justify-between rounded-[2rem] border border-black/[0.06] bg-white/50 p-6 shadow-card glass sm:p-8 lg:min-h-0 lg:p-10">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-wall-green text-white shadow-glow-green">
                <LogoIcon />
              </div>
              <div>
                <p className="text-sm font-bold tracking-tight">WallAI</p>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-stone-400">Portfolio OS</p>
              </div>
            </div>
            <span className="hidden rounded-full border border-wall-green/15 bg-wall-green-light px-3 py-1 text-xs font-semibold text-wall-green sm:inline-flex">
              Private beta
            </span>
          </nav>

          <div className="my-12 max-w-3xl lg:my-0">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-black/[0.07] bg-white px-3 py-1.5 text-xs font-semibold text-stone-500 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-wall-green" />
              Your brokerage spreadsheet, turned into a living dashboard.
            </div>

            <h1 className="max-w-4xl font-serif text-[clamp(3rem,8vw,6.8rem)] font-semibold leading-[0.9] tracking-[-0.07em] text-stone-950">
              See what your portfolio is really doing.
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-stone-600 sm:text-lg">
              Upload holdings once, sign back in anytime, and WallAI rebuilds your dashboard with refreshed market prices,
              cleaner P&L, and account-level context.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {METRICS.map((metric) => (
                <div key={metric.label} className="rounded-2xl border border-black/[0.07] bg-white/70 p-4 shadow-card">
                  <p className="font-mono text-xl font-bold tracking-tight text-wall-green">{metric.value}</p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-stone-400">{metric.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {FEATURE_CARDS.map((feature) => (
              <article key={feature.label} className="rounded-2xl border border-black/[0.06] bg-white/65 p-4">
                <p className="text-sm font-bold text-stone-800">{feature.label}</p>
                <p className="mt-2 text-sm leading-6 text-stone-500">{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center px-0 py-8 lg:px-10 lg:py-0">
          <div className="w-full max-w-md">
            <div className="relative overflow-hidden rounded-[2rem] border border-black/[0.08] bg-white p-6 shadow-[0_24px_80px_rgba(28,28,28,0.12)] sm:p-8">
              <div className="absolute right-0 top-0 h-32 w-32 rounded-bl-full bg-wall-green-light" />

              <div className="relative">
                <div className="mb-8 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-wall-green">Sign in</p>
                    <h2 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-stone-950">
                      Continue to your workspace.
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-stone-500">
                      Your portfolio, saved uploads, and refreshed quote cache are tied to your Google account.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                  className="group flex w-full items-center justify-center gap-3 rounded-2xl border border-black/[0.08] bg-stone-950 px-4 py-4 text-sm font-bold text-white shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:bg-wall-green hover:shadow-card-hover disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
                    <GoogleIcon />
                  </span>
                  {isSigningIn ? 'Opening Google...' : 'Continue with Google'}
                </button>

                {error && (
                  <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <div className="my-7 flex items-center gap-3">
                  <div className="h-px flex-1 bg-black/[0.08]" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">What you get</span>
                  <div className="h-px flex-1 bg-black/[0.08]" />
                </div>

                <ul className="space-y-3 text-sm text-stone-600">
                  <LoginBenefit>Saved portfolio reloads after sign-in.</LoginBenefit>
                  <LoginBenefit>Redis-backed quote cache for faster refreshes.</LoginBenefit>
                  <LoginBenefit>CDR-aware pricing so Canadian listings stay in CAD.</LoginBenefit>
                </ul>

                <div className="mt-8 rounded-2xl border border-black/[0.06] bg-wall-elevated p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">Security</p>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    Authentication is handled by Firebase. API keys and market data providers stay server-side.
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-5 text-center text-xs leading-6 text-stone-400">
              By continuing, you agree to use WallAI for portfolio tracking and research support, not financial advice.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}

function LogoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M2 16L7 9L11 13L15 6L20 10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 19h18" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
    </svg>
  )
}

function LoginBenefit({ children }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-wall-green-light text-wall-green">
        <CheckIcon />
      </span>
      <span>{children}</span>
    </li>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M10 3L4.75 8.25L2 5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}
