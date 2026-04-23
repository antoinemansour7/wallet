import { LIVE_META } from './constants'

export default function LiveBanner({ liveStatus, liveMessage, lastUpdatedAt }) {
  if (liveStatus === 'idle' && !liveMessage) return null
  const meta = LIVE_META[liveStatus] ?? LIVE_META.idle
  return (
    <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 ${meta.cls}`}>
      <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
          <p className="text-sm font-semibold">{meta.label}</p>
          {lastUpdatedAt && (
            <span className="font-mono text-xs opacity-60">
              {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed opacity-75">
          {liveMessage || 'Quantities and book values come from the uploaded file. Cash uses broker cash rows when present, otherwise upload-to-upload trade deltas.'}
        </p>
      </div>
    </div>
  )
}
