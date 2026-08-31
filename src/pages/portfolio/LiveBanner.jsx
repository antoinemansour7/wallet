import { useState } from 'react'
import { LIVE_META } from './constants'

// Quiet one-line status — brokers never show a banner card for "prices ok".
// Only errors get the full message treatment, and those are dismissible:
// a partial refresh is information, not a blocker.
export default function LiveBanner({ liveStatus, liveMessage, lastUpdatedAt }) {
  // Dismissal is remembered against the message itself, not a boolean. Prices
  // re-refresh every few minutes, and a boolean would resurrect the identical
  // banner on each cycle; a genuinely different problem still gets through.
  const [dismissedKey, setDismissedKey] = useState(null)
  const bannerKey = `${liveStatus}:${liveMessage}`

  if (liveStatus === 'idle' && !liveMessage) return null
  const meta = LIVE_META[liveStatus] ?? LIVE_META.idle
  const isProblem = liveStatus === 'error' || liveStatus === 'partial'

  if (!isProblem) {
    // "Prices as of 1:51 PM" — one fact, phrased the way a person would say it.
    // It used to read "Prices up to date · 1:51 PM", which is the same fact
    // asserted twice, the second time in a way you have to parse.
    const time = lastUpdatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return (
      <div className="mb-3 flex items-center justify-end gap-2 text-[11px] text-white/30">
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
        <span className="tabular">
          {liveStatus === 'success' && time ? `Prices as of ${time}` : meta.label}
        </span>
      </div>
    )
  }

  if (dismissedKey === bannerKey) return null

  return (
    <div className={`mb-5 flex items-start gap-3 rounded-xl border py-3 pl-4 pr-2.5 ${meta.cls}`}>
      <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
          <p className="text-sm font-semibold">{meta.label}</p>
          {lastUpdatedAt && (
            <span className="text-xs tabular opacity-60">
              {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        {liveMessage && <p className="mt-0.5 text-xs leading-relaxed opacity-75">{liveMessage}</p>}
      </div>
      <button
        type="button"
        onClick={() => setDismissedKey(bannerKey)}
        aria-label="Dismiss"
        title="Dismiss"
        className="-mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg opacity-50 transition-all duration-150 hover:bg-white/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
