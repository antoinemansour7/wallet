import { Component } from 'react'
import { auth, db } from '../firebase/config'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { IS_PREVIEW } from '../preview/mockMode'

// React's default for an uncaught render error is to unmount the whole tree —
// one bad row from an uploaded statement, a malformed Plaid response, or a
// null where a number was assumed, and the person is looking at a blank page
// with nothing to report and nothing for us to debug.
//
// Three boundaries exist rather than one: a wide one around each routed page,
// so a crash on Portfolio does not take the navigation with it; a narrower one
// around each tab panel, so switching away and back is itself the retry; and
// the narrowest around a single holdings row, because that is the one thing on
// this app fed directly by four sources we do not control. Losing one row's
// rendering should never cost someone the sight of the rest of their
// portfolio.

/**
 * Sent to Firestore, not just the console. A `console.error` is a message to
 * whoever has devtools open on that one machine, which for a crash on a
 * person's own laptop is nobody. `users/{uid}/errors` sits under the same
 * `request.auth.uid == userId` rule every other subcollection already uses, so
 * this needed no rule change — and it means a report is somewhere a person can
 * actually go find it, not gone the moment the tab closes.
 *
 * Guarded on IS_PREVIEW the same way every other write path is: the mock user
 * is not a real account, and the write would still land under whoever is
 * signed in.
 *
 * Fire-and-forget and never throws itself — a reporter that can fail the
 * render it is reporting on would be worse than the bug it exists to catch.
 */
function reportError(error, info, context) {
  console.error(`[ErrorBoundary:${context}]`, error, info?.componentStack)

  if (IS_PREVIEW) return
  const uid = auth.currentUser?.uid
  if (!uid) return

  addDoc(collection(db, 'users', uid, 'errors'), {
    context,
    message: String(error?.message ?? error),
    stack: String(error?.stack ?? '').slice(0, 4000),
    componentStack: String(info?.componentStack ?? '').slice(0, 4000),
    url: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    at: serverTimestamp(),
  }).catch((err) => {
    console.error('[ErrorBoundary] failed to persist report:', err.message)
  })
}

/**
 * `resetKey` is deliberately one value, not react-error-boundary's array — the
 * two callers here only ever have one thing that means "try again": the route
 * changed, or the tab changed. A crash is cleared when that key changes, and
 * the default fallback also offers a manual retry for when it does not.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    reportError(error, info, this.props.context ?? 'unknown')
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ error: null })
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      const Fallback = this.props.fallback ?? PageFallback
      return <Fallback error={this.state.error} reset={this.reset} />
    }
    return this.props.children
  }
}

/** Full-page fallback: a route crashed. Says what happened, offers a reload,
 *  does not blame the person looking at it. */
export function PageFallback({ reset }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[420px] flex-col items-center justify-center px-6 text-center">
      <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-ink">Something went wrong</h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink/45">
        This page hit a problem and couldn't finish loading. It's been reported.
      </p>
      <div className="mt-7 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-ink/60 transition-colors hover:bg-ink/[0.05] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-wall-surface transition-opacity hover:opacity-90 dark:bg-ink dark:text-brand"
        >
          Reload
        </button>
      </div>
    </div>
  )
}

/** Panel-sized fallback: one tab or chart crashed. Switching tabs and back is
 *  already a retry, via resetKey — this is for retrying without leaving. */
export function PanelFallback({ reset }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-ink/[0.12] px-6 py-14 text-center">
      <p className="text-[13.5px] text-ink/45">This section couldn't load.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-ink/55 transition-colors hover:bg-ink/[0.05] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
      >
        Try again
      </button>
    </div>
  )
}

/** Row-sized fallback: one holding crashed. No retry control — the row
 *  remounts on its own the next time the data behind it changes. */
export function RowFallback() {
  return (
    <div className="px-4 py-3.5 text-[12.5px] text-ink/35 sm:px-5">
      Couldn't show this holding.
    </div>
  )
}
