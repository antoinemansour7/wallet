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
    <main className="login-shell relative min-h-screen overflow-hidden bg-wall-bg">
      <div className="login-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="login-halo login-halo-primary pointer-events-none absolute" aria-hidden="true" />
      <div className="login-halo login-halo-secondary pointer-events-none absolute" aria-hidden="true" />

      <nav className="relative z-10 mx-auto flex max-w-[1240px] items-center justify-between px-6 py-6 sm:px-10 lg:px-12">
        <Logo size={34} />
        <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-gain" />
          Private beta
        </div>
      </nav>

      <div className="relative z-10 mx-auto grid max-w-[1240px] items-center gap-12 px-6 pb-14 pt-12 sm:px-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-20 lg:px-12 lg:pb-24 lg:pt-20">
        <section className="login-reveal max-w-2xl" aria-labelledby="login-title">
          <div className="mb-8 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.2em] text-white/35">
            <span className="h-px w-8 bg-gain" />
            Intelligent portfolio visibility
          </div>
          <h1 id="login-title" className="max-w-xl font-display text-[clamp(3.4rem,7vw,6.8rem)] font-semibold leading-[0.92] tracking-[-0.055em] text-white">
            Make your money<br />feel <span className="text-gradient">legible.</span>
          </h1>
          <p className="mt-8 max-w-lg text-base leading-7 text-white/45 sm:text-lg">
            WallAI turns scattered holdings into a clear, living view of your portfolio — with the context to understand what moves it.
          </p>

          <div className="mt-12 max-w-xl border-y border-white/[0.09] py-5">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-white/30">
              <span>Illustrative portfolio view</span>
              <span className="flex items-center gap-2 text-gain"><span className="h-1.5 w-1.5 rounded-full bg-gain" />Live data</span>
            </div>
            <div className="mt-6 flex items-end justify-between gap-8">
              <div>
                <p className="font-mono text-3xl tracking-[-0.05em] text-white sm:text-4xl">$128,420<span className="text-white/30">.68</span></p>
                <p className="mt-2 text-xs text-gain">+$12,804.32 <span className="text-white/30">· 11.07% all time</span></p>
              </div>
              <div className="hidden w-1/2 sm:block" aria-label="Illustrative upward portfolio performance chart">
                <svg viewBox="0 0 320 92" className="h-auto w-full overflow-visible" role="img">
                  <path d="M2 78 C28 73 34 58 58 65 S90 54 111 60 S139 42 160 48 S183 51 201 34 S231 43 248 27 S282 20 318 4" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gain draw-line" pathLength="1" />
                  <path d="M2 78 C28 73 34 58 58 65 S90 54 111 60 S139 42 160 48 S183 51 201 34 S231 43 248 27 S282 20 318 4 V92 H2Z" className="text-gain/10 fade-in-late" fill="currentColor" />
                </svg>
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-xs text-white/35">
            {BENEFITS.map((benefit) => <span key={benefit} className="flex items-center gap-2"><CheckIcon />{benefit}</span>)}
          </div>
        </section>

        <section className="login-card login-reveal rounded-2xl border border-white/[0.12] bg-wall-surface p-7 shadow-2xl shadow-black/20 sm:p-9" style={{ animationDelay: '140ms' }} aria-labelledby="sign-in-heading">
          <div className="mb-10 flex items-start justify-between gap-4">
            <div>
              <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-gain">Welcome back</p>
              <h2 id="sign-in-heading" className="font-display text-3xl font-semibold tracking-[-0.04em] text-white">Enter your workspace.</h2>
            </div>
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/50"><LockIcon /></div>
          </div>
          <p className="mb-8 text-sm leading-6 text-white/40">Your portfolio, saved uploads, and price cache are tied to your Google account.</p>

          <button type="button" onClick={handleSignIn} disabled={isSigningIn} className="group flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-brand transition-all duration-300 hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-gain focus:ring-offset-2 focus:ring-offset-wall-surface disabled:cursor-not-allowed disabled:opacity-50">
            <GoogleIcon />
            <span>{isSigningIn ? 'Opening Google…' : 'Continue with Google'}</span>
            {!isSigningIn && <span className="ml-auto text-brand/35 transition-transform group-hover:translate-x-0.5">→</span>}
          </button>

          {error && <div role="alert" className="mt-4 rounded-xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm leading-5 text-loss">{error}</div>}

          <div className="mt-8 flex items-center gap-3 text-[11px] text-white/25"><span className="h-px flex-1 bg-white/[0.09]" /><span>SECURE ACCESS</span><span className="h-px flex-1 bg-white/[0.09]" /></div>
          <div className="mt-7 flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3.5">
            <span className="mt-0.5 shrink-0 text-gain"><ShieldIcon /></span>
            <p className="text-xs leading-5 text-white/35">Auth via Firebase. API keys and market data providers stay server-side only.</p>
          </div>
          <p className="mt-6 text-center text-[11px] leading-5 text-white/20">For portfolio tracking only — not financial advice.</p>
        </section>
      </div>
    </main>
  )
}

function CheckIcon() { return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M10 3L4.75 8.25L2 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function LockIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> }
function ShieldIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></svg> }
function GoogleIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg> }
