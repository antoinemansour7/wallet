import { LIVE_META } from './constants'

// Quiet one-line status — brokers never show a banner card for "prices ok".
// Only errors get the full message treatment.
export default function LiveBanner({ liveStatus, liveMessage, lastUpdatedAt }) {
  if (liveStatus === 'idle' && !liveMessage) return null
  const meta = LIVE_META[liveStatus] ?? LIVE_META.idle
  const isProblem = liveStatus === 'error' || liveStatus === 'partial'

  if (!isProblem) {
    return (
      <div className="mb-3 flex items-center justify-end gap-2 text-[11px] text-white/30">
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
        <span>{meta.label}</span>
        {lastUpdatedAt && (
          <span className="tabular">
            · {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 ${meta.cls}`}>
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
    </div>
  )
}
