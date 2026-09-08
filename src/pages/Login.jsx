import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getAuthErrorMessage } from '../context/authErrors'
import Brand from '../components/landing/Brand'
import '../components/landing/tokens.css'
import './Login.css'

const MODES = {
  signin: {
    heading: 'Welcome back',
    subheading: 'Let’s check in on your investments.',
    submit: 'Log in',
    pending: 'Logging in…',
    passwordAutoComplete: 'current-password',
    switchPrompt: 'New to WallAI?',
    switchAction: 'Sign up',
    other: 'signup',
  },
  signup: {
    heading: 'Create your account',
    subheading: 'A home for all your investments. Free during beta.',
    submit: 'Create account',
    pending: 'Creating account…',
    passwordAutoComplete: 'new-password',
    switchPrompt: 'Already have an account?',
    switchAction: 'Log in',
    other: 'signin',
  },
}

export default function Login() {
  const { user, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword } = useAuth()
  const navigate = useNavigate()

  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState(() => searchParams.get('mode') === 'signup' ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState('')
  const inFlight = useRef(false)
  const emailRef = useRef(null)
  const headingRef = useRef(null)
  const previousMode = useRef(mode)

  const copy = MODES[mode]

  useEffect(() => {
    if (user) navigate('/portfolio', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    if (previousMode.current !== mode) {
      headingRef.current?.focus()
      previousMode.current = mode
    }
  }, [mode])

  const switchMode = () => {
    setMode(copy.other)
    // Keep the address, but never carry an existing password into sign-up.
    setPassword('')
    setShowPassword(false)
    setError('')
    setNotice('')
  }

  const run = async (kind, action) => {
    if (inFlight.current) return
    inFlight.current = true
    setError('')
    setNotice('')
    setPending(kind)
    try {
      await action()
    } catch (err) {
      setError(getAuthErrorMessage(err, kind === 'reset' ? 'signin' : mode))
    } finally {
      inFlight.current = false
      setPending('')
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (busy) return
    if (!emailRef.current?.validity.valid) {
      setError('Enter a valid email address.'); emailRef.current?.focus(); return
    }
    if (!password || (mode === 'signup' && password.length < 6)) {
      setError(mode === 'signup' ? 'Use at least 6 characters for your password.' : 'Enter your password.'); return
    }
    run(mode, () => (
      mode === 'signin' ? signInWithEmail(email.trim(), password) : signUpWithEmail(email.trim(), password)
    ))
  }

  const handleReset = () => {
    if (!email.trim()) {
      setError('Enter your email address first, then choose Forgot password.')
      emailRef.current?.focus()
      return
    }
    if (!emailRef.current?.validity.valid) {
      setError('Enter a valid email address.'); emailRef.current?.focus(); return
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
    <main className="wallai-system login-shell">
      <header className="login-brand">
        <Brand />
        <span className="login-beta"><span /> Beta</span>
      </header>

      <section className="login-access" aria-labelledby="sign-in-title">
        <div className="login-access-top"><span className="login-small-mark" /> Your portfolio, at a glance</div>
        <div className="login-form-wrap">
          <div key={mode} className="login-face">
            <div className="login-form-heading">
              <h1 id="sign-in-title" ref={headingRef} tabIndex={-1}>{copy.heading}</h1>
              <p>{copy.subheading}</p>
            </div>

            <form onSubmit={handleSubmit} noValidate aria-busy={busy}>
              <div className="login-fields">
                <Field label="Email" htmlFor="login-email">
                  <input
                    ref={emailRef}
                    id="login-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    disabled={busy}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "login-error" : undefined}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="login-input"
                  />
                </Field>
                <Field
                  label="Password"
                  htmlFor="login-password"
                  action={mode === 'signin' ? (
                    <button type="button" onClick={handleReset} disabled={busy} className="login-text-button login-forgot">
                      {pending === 'reset' ? 'Sending…' : 'Forgot password?'}
                    </button>
                  ) : null}
                >
                  <div className="login-password-wrap">
                    <input
                      id="login-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={copy.passwordAutoComplete}
                      required
                      minLength={6}
                      disabled={busy}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? "login-error" : undefined}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={mode === 'signup' ? 'At least 6 characters' : 'Enter your password'}
                      className="login-input login-password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      disabled={busy}
                      aria-pressed={showPassword}
                      className="login-password-toggle"
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </Field>
              </div>

              {error && <div id="login-error" role="alert" className="login-feedback login-error">{error}</div>}
              {(busy || notice) && <div role="status" aria-live="polite" className="login-feedback login-notice">{busy ? (pending === 'google' ? 'Opening Google…' : pending === 'reset' ? 'Sending reset link…' : copy.pending) : notice}</div>}

              <button type="submit" disabled={busy} className="login-submit">
                <span>{pending === mode ? copy.pending : copy.submit}</span>
                {pending === mode ? <span className="login-spinner" aria-hidden="true" /> : <ArrowIcon />}
              </button>
            </form>

            <div className="login-divider" aria-hidden="true"><span />or<span /></div>

            <button
              type="button"
              onClick={() => run('google', signInWithGoogle)}
              disabled={busy}
              className="login-google"
            >
              {pending === 'google' ? <span className="login-spinner" aria-hidden="true" /> : <GoogleIcon />}
              {pending === 'google' ? 'Opening Google…' : 'Continue with Google'}
            </button>

            <p className="login-switch">
              {copy.switchPrompt}{' '}
              <button type="button" onClick={switchMode} disabled={busy} className="login-text-button">
                {copy.switchAction}<span aria-hidden="true"> ↗</span>
              </button>
            </p>
          </div>

          <p className="login-reassurance"><LockIcon /> Your money stays with your brokerage.</p>
        </div>
        <footer className="login-access-footer">
          <span>© {new Date().getFullYear()} WallAI</span>
          <span>Portfolio tracking</span>
        </footer>
      </section>

      <section className="login-story" aria-labelledby="login-heading">
        <div className="login-story-content">
          <div className="login-intro">
            <p className="login-eyebrow"><span /> Your personal portfolio</p>
            <h2 id="login-heading">Your investments.<br /><span>All together.</span></h2>
            <p className="login-description">
              See what you own. Know where you stand.<br className="login-desktop-break" />
              {' '}All your accounts, without all the tabs.
            </p>
          </div>

          <PortfolioPreview />

          <div className="login-story-footer">
            <span className="login-footer-mark" aria-hidden="true">✳</span>
            <span>Canadian accounts. Global investments.</span>
          </div>
        </div>
      </section>
    </main>
  )
}

function Field({ label, htmlFor, action, children }) {
  return (
    <div>
      <div className="login-field-label">
        <label htmlFor={htmlFor}>{label}</label>
        {action}
      </div>
      {children}
    </div>
  )
}

// Illustrative values only: this preview never reads a visitor's financial data.
const PREVIEW_RANGES = {
  '1M': {
    change: '+$2,840.00 (2.26%)', period: 'this month', start: 'Aug 1', end: 'Aug 31',
    points: [96, 91, 99, 88, 86, 98, 93, 102, 83, 91, 75, 79, 66, 69, 61, 65, 55, 60, 46, 42, 50, 36, 31, 39, 24],
  },
  '6M': {
    change: '+$7,620.00 (6.31%)', period: 'past 6 months', start: 'Mar', end: 'Aug',
    points: [115, 106, 110, 102, 92, 95, 78, 81, 66, 69, 83, 94, 86, 71, 73, 66, 63, 50, 61, 44, 37, 45, 29, 34, 24],
  },
  '1Y': {
    change: '+$11,460.00 (9.80%)', period: 'past year', start: 'Sep', end: 'Aug',
    points: [132, 126, 129, 113, 117, 108, 113, 93, 101, 86, 92, 80, 89, 73, 78, 57, 61, 47, 55, 36, 42, 29, 36, 18, 24],
  },
  ALL: {
    change: '+$28,450.00 (28.45%)', period: 'all time', start: '2022', end: '2026',
    points: [145, 137, 143, 128, 134, 120, 127, 112, 120, 108, 114, 94, 102, 88, 93, 78, 88, 64, 70, 51, 60, 41, 48, 28, 24],
  },
}

function PortfolioPreview() {
  const [range, setRange] = useState('1Y')
  const data = PREVIEW_RANGES[range]
  const path = data.points.map((y, index) => `${index === 0 ? 'M' : 'L'}${8 + index * 19.5} ${y}`).join(' ')

  return (
    <figure className="login-preview" aria-label="Sample portfolio preview">
      <div className="login-preview-card">
        <div className="login-preview-header">
          <span><span className="login-preview-dot" /> Portfolio overview</span>
          <p className="login-preview-caption">Sample portfolio</p>
        </div>
        <div className="login-preview-balance">$128,450<span>.00</span><span className="login-currency">CAD</span></div>
        <div className="login-preview-change" aria-live="polite" aria-atomic="true">
          <span>↗ {data.change}</span><span>{data.period}</span>
        </div>
        <div className="login-chart">
          <svg viewBox="0 0 484 170" preserveAspectRatio="none" role="img" aria-label={`Sample portfolio value ${data.period}, up ${data.change}`}>
            <defs>
              <linearGradient id="login-chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--wa-sage)" stopOpacity="0.2" />
                <stop offset="100%" stopColor="var(--wa-sage)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[40, 85, 130].map((y) => <line key={y} x1="0" y1={y} x2="484" y2={y} className="login-chart-guide" />)}
            <g key={range}>
              <path d={`${path} L476 170 L8 170 Z`} fill="url(#login-chart-fill)" className="login-chart-area" />
              <path d={path} fill="none" stroke="var(--wa-sage)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength="1" className="login-chart-line" />
              <circle cx="476" cy="24" r="8" fill="var(--wa-sage)" fillOpacity="0.12" className="login-chart-end" />
              <circle cx="476" cy="24" r="3.5" fill="var(--wa-sage)" className="login-chart-end" />
            </g>
          </svg>
          <div className="login-chart-labels"><span>{data.start}</span><span>{data.end}</span></div>
        </div>
        <div className="login-preview-bottom">
          <span>Portfolio value</span>
          <div className="login-chart-ranges" role="group" aria-label="Sample portfolio time range">
            {Object.keys(PREVIEW_RANGES).map((value) => (
              <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{value}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="login-account-strip">
        <div className="login-account-icons" aria-hidden="true"><span>T</span><span>R</span><span>N</span></div>
        <div><strong>Different accounts. One view.</strong><span>TFSA, RRSP & non-registered</span></div>
        <span className="login-account-check" aria-hidden="true"><CheckIcon /></span>
      </div>
    </figure>
  )
}

function ArrowIcon() { return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg> }
function CheckIcon() { return <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M10 3L4.75 8.25L2 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function LockIcon() { return <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> }
function EyeIcon() { return <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg> }
function EyeOffIcon() { return <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c6.4 0 10 7 10 7a17 17 0 0 1-2.9 3.8M6.2 6.7A17 17 0 0 0 2 13s3.6 7 10 7a9.3 9.3 0 0 0 4.3-1" /><path d="m3 3 18 18" /><path d="M9.9 10.1a3 3 0 0 0 4.1 4.2" /></svg> }
function GoogleIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg> }
