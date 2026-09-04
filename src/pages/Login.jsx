import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, getAuthErrorMessage } from '../context/AuthContext'
import { Logo } from '../components/Navbar'

const BENEFITS = [
  'Portfolio syncs across all your devices.',
  'CDR-aware pricing — Canadian listings stay in CAD.',
  'Live FX conversion for USD stocks in CAD accounts.',
]

/**
 * Sign in and sign up are one surface, not two routes.
 *
 * The only thing that differs between them is a label, an autocomplete hint and
 * which function the submit handler calls — so they share a card and swap state
 * in place. Navigating a whole page to change two words reads as heavier than
 * it is, and it throws away whatever the person already typed.
 */
const MODES = {
  signin: {
    eyebrow: 'Welcome back',
    heading: 'Continue to WallAI',
    submit: 'Sign in',
    pending: 'Signing in…',
    passwordAutoComplete: 'current-password',
    switchPrompt: 'New here?',
    switchAction: 'Create an account',
    other: 'signup',
  },
  signup: {
    eyebrow: 'Get started',
    heading: 'Create your account',
    submit: 'Create account',
    pending: 'Creating account…',
    passwordAutoComplete: 'new-password',
    switchPrompt: 'Already have an account?',
    switchAction: 'Sign in',
    other: 'signin',
  },
}

export default function Login() {
  const { user, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState('')
  const emailRef = useRef(null)

  const copy = MODES[mode]

  useEffect(() => {
    if (user) navigate('/portfolio', { replace: true })
  }, [user, navigate])

  const switchMode = () => {
    setMode(copy.other)
    // The password does not survive the switch: a value typed as "the password I
    // already have" is not the one being chosen for a new account, and carrying
    // it over invites submitting the wrong one by reflex. The email does survive
    // — it is the same address either way, and retyping it is pure friction.
    setPassword('')
    setShowPassword(false)
    setError('')
    setNotice('')
  }

  const run = async (kind, action) => {
    setError('')
    setNotice('')
    setPending(kind)
    try {
      await action()
    } catch (err) {
      setError(getAuthErrorMessage(err, kind === 'reset' ? 'signin' : mode))
    } finally {
      setPending('')
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    run(mode, () => (
      mode === 'signin' ? signInWithEmail(email, password) : signUpWithEmail(email, password)
    ))
  }

  const handleReset = () => {
    if (!email.trim()) {
      setError('Enter your email address first, then choose Forgot password.')
      emailRef.current?.focus()
      return
    }
    run('reset', async () => {
      await resetPassword(email.trim())
      // Neutral by necessity: Firebase does not say whether the address exists,
      // and a message that did would confirm who has an account here.
      setNotice('If that address has an account, a reset link is on its way.')
    })
  }

  const busy = Boolean(pending)

  return (
    <main className="login-shell relative min-h-screen overflow-hidden">
      <div className="login-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="login-orbit login-orbit-one pointer-events-none absolute" aria-hidden="true" />
      <div className="login-orbit login-orbit-two pointer-events-none absolute" aria-hidden="true" />

      <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6 sm:px-10 lg:px-12">
        <Logo size={38} inverted />
        <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-white/65 dark:text-white/45">
          <span className="size-1.5 rounded-full bg-gain" />
          Private beta
        </div>
      </nav>

      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-92px)] max-w-7xl items-center gap-14 px-6 pb-14 pt-8 sm:px-10 lg:grid-cols-[minmax(0,1fr)_430px] lg:gap-20 lg:px-12 lg:pb-20 lg:pt-10">
        {/* On a phone the card comes first: the pitch is worth reading, but not
            worth a full screen of scrolling before you can reach the thing you
            came to do. On desktop both fit side by side and the order reverts. */}
        <section className="order-2 max-w-2xl lg:order-1" aria-labelledby="login-heading">
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

          {/* The benefits moved out of the card when the card gained a form —
              three reassurances stacked under a password field push the submit
              button below the fold on a phone. */}
          <div className="mt-7 flex flex-col gap-3">
            {BENEFITS.map((benefit) => (
              <div key={benefit} className="flex items-start gap-3 text-sm leading-5 text-white/60 dark:text-white/45">
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[#8fd7ba] dark:bg-gain/15 dark:text-gain"><CheckIcon /></span>
                {benefit}
              </div>
            ))}
          </div>
        </section>

        <section className="order-1 rounded-[2rem] border border-[#dce7e0] bg-[#f3f6f2] p-6 text-ink shadow-2xl shadow-black/25 dark:border-white/[0.12] dark:bg-wall-surface/90 dark:text-white dark:shadow-black/20 dark:backdrop-blur-xl sm:p-8 lg:order-2" aria-labelledby="sign-in-title">
          <div className="mb-7">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-ink/65 dark:text-white/35">{copy.eyebrow}</p>
            <h2 id="sign-in-title" className="font-display text-[2rem] font-semibold leading-[1.1] tracking-[-0.04em] text-ink dark:text-white">{copy.heading}</h2>
          </div>

          <button
            type="button"
            onClick={() => run('google', signInWithGoogle)}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-ink/15 bg-white px-4 py-3.5 text-sm font-semibold text-ink transition-all duration-motion-long hover:border-ink/30 hover:shadow-[0_8px_24px_rgba(23,33,29,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.06] dark:text-white dark:hover:border-white/30 dark:hover:bg-white/[0.10] dark:focus-visible:ring-offset-0"
          >
            <GoogleIcon />
            {pending === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </button>

          <div className="my-6 flex items-center gap-4" aria-hidden="true">
            <span className="h-px flex-1 bg-ink/10 dark:bg-white/10" />
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink/45 dark:text-white/30">or</span>
            <span className="h-px flex-1 bg-ink/10 dark:bg-white/10" />
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-4">
              <Field label="Email" htmlFor="login-email">
                <input
                  ref={emailRef}
                  id="login-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={INPUT_CLASS}
                />
              </Field>

              <Field
                label="Password"
                htmlFor="login-password"
                action={mode === 'signin' ? (
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={busy}
                    className="rounded text-xs font-medium text-ink/60 underline-offset-4 transition-colors duration-motion-short hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 dark:text-white/45 dark:hover:text-white"
                  >
                    {pending === 'reset' ? 'Sending…' : 'Forgot password?'}
                  </button>
                ) : null}
              >
                <div className="relative">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={copy.passwordAutoComplete}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                    className={`${INPUT_CLASS} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-ink/45 transition-colors duration-motion-short hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-white/35 dark:hover:text-white"
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </Field>
            </div>

            {/* Feedback sits directly above the button that produced it, so it is
                read on the way back to trying again. */}
            {error && (
              <div role="alert" className="mt-5 rounded-xl border border-loss/20 bg-loss-bg px-4 py-3 text-sm leading-5 text-loss dark:border-loss/30 dark:bg-loss/10">
                {error}
              </div>
            )}
            {notice && (
              <div role="status" className="mt-5 rounded-xl border border-gain/25 bg-gain/[0.08] px-4 py-3 text-sm leading-5 text-ink/80 dark:text-white/70">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-5 w-full rounded-xl bg-ink px-4 py-3.5 text-sm font-semibold text-white transition-all duration-motion-long hover:bg-ink/90 hover:shadow-[0_12px_32px_rgba(23,33,29,0.20)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-brand dark:hover:bg-white/90 dark:hover:shadow-[0_12px_32px_rgba(255,255,255,0.12)] dark:focus-visible:ring-offset-0"
            >
              {pending === mode ? copy.pending : copy.submit}
            </button>
          </form>

          <div className="mt-6 flex gap-3 rounded-xl bg-ink/[0.045] px-4 py-3.5 text-xs leading-5 text-ink/65 dark:bg-white/[0.045] dark:text-white/35">
            <LockIcon />
            <span>Your connection is encrypted, and your password is stored only by Firebase Authentication.</span>
          </div>

          <div className="-mx-6 mt-6 border-t border-ink/10 px-6 pt-5 text-center text-sm text-ink/65 dark:border-white/[0.09] dark:text-white/45 sm:-mx-8 sm:px-8">
            {copy.switchPrompt}{' '}
            <button
              type="button"
              onClick={switchMode}
              className="rounded font-semibold text-ink underline-offset-4 transition-colors duration-motion-short hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-white"
            >
              {copy.switchAction}
            </button>
          </div>

          <p className="mt-5 text-center text-[11px] leading-4 text-ink/65 dark:text-white/22">For portfolio tracking only — not financial advice.</p>
        </section>
      </div>
    </main>
  )
}

const INPUT_CLASS = 'w-full rounded-xl border border-ink/15 bg-ink/[0.03] px-3.5 py-3 text-sm text-ink outline-none transition-colors duration-motion-short placeholder:text-ink/30 focus:border-ink/35 focus:ring-2 focus:ring-accent/25 dark:border-white/12 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-white/25 dark:focus:border-white/30'

function Field({ label, htmlFor, action, children }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-xs font-medium text-ink/70 dark:text-white/50">{label}</label>
        {action}
      </div>
      {children}
    </div>
  )
}

function PerformanceChart() {
  return <div className="relative h-24 w-full overflow-hidden"><svg className="h-full w-full" viewBox="0 0 600 96" preserveAspectRatio="none" role="img" aria-label="Rising portfolio performance chart"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#34d399" stopOpacity="0.18" /><stop offset="1" stopColor="#34d399" stopOpacity="0" /></linearGradient></defs><path d="M0 79 C45 76 50 65 88 68 S130 56 160 61 S204 48 240 54 S278 39 316 44 S360 31 396 36 S438 21 470 27 S520 8 600 12 V96 H0Z" fill="url(#chart-fill)" /><path d="M0 79 C45 76 50 65 88 68 S130 56 160 61 S204 48 240 54 S278 39 316 44 S360 31 396 36 S438 21 470 27 S520 8 600 12" fill="none" stroke="#34d399" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><span className="absolute right-0 top-8 z-10 rounded-md border border-gain/30 bg-[#203229] px-2 py-1 font-mono text-[10px] text-gain shadow-sm dark:border-gain/20 dark:bg-wall-surface">$84,291</span></div>
}

function CheckIcon() { return <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M10 3L4.75 8.25L2 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function LockIcon() { return <svg className="mt-0.5 size-4 shrink-0 text-ink/55 dark:text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> }
function EyeIcon() { return <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg> }
function EyeOffIcon() { return <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c6.4 0 10 7 10 7a17 17 0 0 1-2.9 3.8M6.2 6.7A17 17 0 0 0 2 13s3.6 7 10 7a9.3 9.3 0 0 0 4.3-1" /><path d="m3 3 18 18" /><path d="M9.9 10.1a3 3 0 0 0 4.1 4.2" /></svg> }
function GoogleIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg> }
