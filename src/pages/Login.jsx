import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Logo } from '../components/Navbar'

const BENEFITS = [
  'Portfolio syncs across all your devices.',
  'CDR-aware pricing — Canadian listings stay in CAD.',
  'Live FX conversion for USD stocks in CAD accounts.',
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
  const [error, setError] = useState('')
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
    <main className="login-shell relative min-h-screen overflow-hidden">
      <div className="login-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="login-orbit login-orbit-one pointer-events-none absolute" aria-hidden="true" />
      <div className="login-orbit login-orbit-two pointer-events-none absolute" aria-hidden="true" />

      <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6 sm:px-10 lg:px-12">
        <Logo size={38} inverted />
        <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-white/65 dark:text-white/45">
          <span className="live-dot size-1.5 rounded-full bg-gain" />
          Private beta
        </div>
      </nav>

      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-92px)] max-w-7xl items-center gap-14 px-6 pb-14 pt-8 sm:px-10 lg:grid-cols-[minmax(0,1fr)_430px] lg:gap-20 lg:px-12 lg:pb-20 lg:pt-10">
        <section className="animate-fade-in max-w-2xl" aria-labelledby="login-heading">
          <div className="mb-8 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8fd7ba] dark:text-accent">
            <span className="h-px w-8 bg-[#8fd7ba] dark:bg-accent" />
            Intelligent portfolio tracking
          </div>
          <h1 id="login-heading" className="max-w-xl font-display text-[clamp(3.1rem,7vw,6.4rem)] font-semibold leading-[0.95] tracking-[-0.055em] text-white">
            Your money,<br />made <span className="text-gradient">legible.</span>
          </h1>
          <p className="mt-8 max-w-lg text-base leading-7 text-white/70 dark:text-white/48 sm:text-lg">
            WallAI turns scattered brokerage data into one calm, considered view of your wealth.
          </p>

          <div className="mt-12 max-w-xl border-y border-white/[0.16] py-5 dark:border-white/[0.10]">
            <div className="mb-4 flex items-center justify-between text-xs text-white/60 dark:text-white/40">
              <span>Portfolio performance</span>
              <span className="font-mono text-gain">+18.42% <span className="text-white/45 dark:text-white/25">YTD</span></span>
            </div>
            <PerformanceChart />
          </div>

          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-xs text-white/60 dark:text-white/38">
            <span>CAD native</span><span>Live pricing</span><span>Privacy first</span>
          </div>
        </section>

        <section className="animate-fade-in rounded-[2rem] border border-[#dce7e0] bg-[#f3f6f2] p-6 text-ink shadow-2xl shadow-black/25 [animation-delay:150ms] [animation-fill-mode:backwards] dark:border-white/[0.12] dark:bg-wall-surface/90 dark:text-white dark:shadow-black/20 dark:backdrop-blur-xl sm:p-8" aria-labelledby="sign-in-title">
          <div className="mb-9 flex items-start justify-between gap-4">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-ink/65 dark:text-white/35">Welcome back</p>
              <h2 id="sign-in-title" className="font-display text-3xl font-semibold tracking-[-0.04em] text-ink">Continue to WallAI</h2>
            </div>
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent dark:border-white/10 dark:bg-white/[0.05]" aria-hidden="true"><SparkIcon /></div>
          </div>

          <button type="button" onClick={handleSignIn} disabled={isSigningIn} className="flex w-full items-center justify-center gap-3 rounded-xl bg-ink px-4 py-3.5 text-sm font-semibold text-white transition-all duration-300 hover:bg-ink/90 hover:shadow-[0_12px_32px_rgba(23,33,29,0.20)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand dark:hover:shadow-[0_12px_32px_rgba(255,255,255,0.12)] dark:focus-visible:ring-offset-0">
            <GoogleIcon />
            {isSigningIn ? 'Opening Google…' : 'Continue with Google'}
          </button>

          {error && <div role="alert" className="mt-4 rounded-xl border border-loss/20 bg-loss-bg px-4 py-3 text-sm leading-5 text-loss dark:border-loss/30 dark:bg-loss/10">{error}</div>}

          <div className="mt-8 flex flex-col gap-4 border-t border-ink/10 pt-7 dark:border-white/[0.09]">
            {BENEFITS.map((benefit) => <div key={benefit} className="flex items-start gap-3 text-sm leading-5 text-ink/70 dark:text-white/52"><span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent dark:bg-gain/15 dark:text-gain"><CheckIcon /></span>{benefit}</div>)}
          </div>

          <div className="mt-8 flex gap-3 rounded-xl bg-ink/[0.045] px-4 py-3.5 text-xs leading-5 text-ink/65 dark:bg-white/[0.045] dark:text-white/35"><LockIcon /><span>Your data is encrypted and your credentials never leave Google.</span></div>
          <p className="mt-5 text-center text-[11px] leading-4 text-ink/65 dark:text-white/22">For portfolio tracking only — not financial advice.</p>
        </section>
      </div>
    </main>
  )
}

function PerformanceChart() {
  return <div className="relative h-24 w-full overflow-hidden"><svg className="h-full w-full" viewBox="0 0 600 96" preserveAspectRatio="none" role="img" aria-label="Rising portfolio performance chart"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#34d399" stopOpacity="0.18" /><stop offset="1" stopColor="#34d399" stopOpacity="0" /></linearGradient></defs><path d="M0 79 C45 76 50 65 88 68 S130 56 160 61 S204 48 240 54 S278 39 316 44 S360 31 396 36 S438 21 470 27 S520 8 600 12 V96 H0Z" fill="url(#chart-fill)" className="fade-in-late" /><path d="M0 79 C45 76 50 65 88 68 S130 56 160 61 S204 48 240 54 S278 39 316 44 S360 31 396 36 S438 21 470 27 S520 8 600 12" fill="none" pathLength="1" stroke="#34d399" strokeWidth="2" vectorEffect="non-scaling-stroke" className="draw-line" /></svg><span className="absolute right-0 top-8 z-10 rounded-md border border-gain/30 bg-[#203229] px-2 py-1 font-mono text-[10px] text-gain shadow-sm dark:border-gain/20 dark:bg-wall-surface">$84,291</span></div>
}

function CheckIcon() { return <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M10 3L4.75 8.25L2 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function LockIcon() { return <svg className="mt-0.5 size-4 shrink-0 text-ink/55 dark:text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> }
function SparkIcon() { return <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></svg> }
function GoogleIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg> }

