import { useState } from 'react'

// The tape, not the picks. Deliberately reads as a separate thing from a pick's
// conviction — a strong idea in a poor market is a real situation, and merging
// the two numbers would hide it.

const BANDS = [
  { min: 7, tone: 'text-gain',      bar: 'bg-gain/70',      ring: 'border-gain/25 bg-gain/[0.06]' },
  { min: 5, tone: 'text-ink',     bar: 'bg-ink/45',     ring: 'border-ink/[0.10] bg-ink/[0.04]' },
  { min: 3, tone: 'text-amber-300', bar: 'bg-amber-300/60', ring: 'border-amber-300/25 bg-amber-300/[0.06]' },
  { min: -Infinity, tone: 'text-loss', bar: 'bg-loss/60',   ring: 'border-loss/25 bg-loss/[0.07]' },
]

const bandFor = (score) => BANDS.find((b) => score >= b.min)

// Component scores share the composite's colour scale, so a red row is red for
// the same reason the headline is.
// Name, then what it means in words, then the one number behind it. The number
// used to be the whole row — "10y 4.76% at 100th pctile, +1.6% in 20d" is a
// fine note to yourself and a poor thing to show a reader.
function ComponentRow({ label, score, detail, metric }) {
  const band = bandFor(score)
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink/70">{label}</span>
        <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-ink/[0.07]">
          <div className={`h-full rounded-full ${band.bar}`} style={{ width: `${Math.max(4, score * 10)}%` }} />
        </div>
        <span className={`w-6 shrink-0 text-right font-mono text-[13px] font-semibold tabular ${band.tone}`}>{score}</span>
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-ink/50">{detail}</p>
      {metric && <p className="mt-0.5 text-[11px] leading-snug text-ink/25">{metric}</p>}
    </div>
  )
}

export default function RegimeGauge({ regime, defaultOpen = false }) {
  // Open by default only where it sits in the desktop rail and has room. On a
  // phone this panel is a full screen of content, and starting it expanded
  // buried the picks entirely below the fold.
  const [open, setOpen] = useState(() => (
    defaultOpen
    && typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(min-width: 1024px)').matches
  ))
  if (!regime || regime.score == null) return null

  const band = bandFor(regime.score)
  const pct = Math.max(0, Math.min(100, regime.score * 10))

  return (
    <div className={`rounded-2xl border px-5 py-4 ${band.ring}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/40">Market conditions</p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className={`font-display text-[30px] font-medium leading-none tabular ${band.tone}`}>
              {regime.score}
            </span>
            <span className="text-[14px] text-ink/30">/ 10</span>
            <span className={`text-[14px] font-medium ${band.tone}`}>{regime.label}</span>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.07]">
            <div className={`h-full rounded-full ${band.bar}`} style={{ width: `${pct}%` }} />
          </div>
          {regime.drag && (
            <p className="mt-2.5 text-[12.5px] leading-snug text-ink/50">
              Weakest part: <span className="text-ink/70">{regime.drag.label}</span> — {regime.drag.detail.toLowerCase()}
            </p>
          )}
        </div>

        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`mt-0.5 shrink-0 text-ink/30 transition-transform duration-motion-short ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="motion-enter mt-3.5 border-t border-ink/[0.06] pt-1.5">
          {(regime.components ?? []).map((c) => (
            <ComponentRow key={c.key} label={c.label} score={c.score} detail={c.detail} metric={c.metric} />
          ))}
          {/* Said plainly, because a number next to a list of picks invites exactly
              the reading it must not have. */}
          <p className="mt-3 border-t border-ink/[0.05] pt-3 text-[11.5px] leading-relaxed text-ink/35">
            This scores the market, not the picks below. A good stock can still be a bad
            moment to buy — use it to decide how much to put in, not whether an idea is any
            good. It is new and not yet proven against results, so nothing else here acts
            on it automatically.
          </p>
        </div>
      )}
    </div>
  )
}
