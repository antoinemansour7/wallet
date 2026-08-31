import { useState } from 'react'

// The tape, not the picks. Deliberately reads as a separate thing from a pick's
// conviction — a strong idea in a poor market is a real situation, and merging
// the two numbers would hide it.

const BANDS = [
  { min: 7, tone: 'text-gain',      bar: 'bg-gain/70',      ring: 'border-gain/25 bg-gain/[0.06]' },
  { min: 5, tone: 'text-white',     bar: 'bg-white/45',     ring: 'border-white/[0.10] bg-white/[0.04]' },
  { min: 3, tone: 'text-amber-300', bar: 'bg-amber-300/60', ring: 'border-amber-300/25 bg-amber-300/[0.06]' },
  { min: -Infinity, tone: 'text-loss', bar: 'bg-loss/60',   ring: 'border-loss/25 bg-loss/[0.07]' },
]

const bandFor = (score) => BANDS.find((b) => score >= b.min)

// Component scores share the composite's colour scale, so a red row is red for
// the same reason the headline is.
function ComponentRow({ label, score, detail }) {
  const band = bandFor(score)
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-[104px] shrink-0 text-[11px] text-white/45">{label}</span>
      <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-white/[0.07]">
        <div className={`h-full rounded-full ${band.bar}`} style={{ width: `${Math.max(3, score * 10)}%` }} />
      </div>
      <span className={`w-7 shrink-0 text-right font-mono text-[11px] tabular ${band.tone}`}>{score}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-white/30">{detail}</span>
    </div>
  )
}

export default function RegimeGauge({ regime }) {
  const [open, setOpen] = useState(false)
  if (!regime || regime.score == null) return null

  const band = bandFor(regime.score)
  const pct = Math.max(0, Math.min(100, regime.score * 10))

  return (
    <div className={`mb-6 rounded-2xl border px-4 py-3.5 ${band.ring}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 rounded-lg"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">Market conditions</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`font-display text-[22px] font-medium leading-none tabular ${band.tone}`}>
              {regime.score}
            </span>
            <span className="text-[12px] text-white/30">/ 10</span>
            <span className={`text-[12px] font-medium ${band.tone}`}>{regime.label}</span>
          </div>
          {regime.drag && (
            <p className="mt-1.5 truncate text-[11px] text-white/35">
              Biggest drag: {regime.drag.label} — {regime.drag.detail}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.07]">
            <div className={`h-full rounded-full ${band.bar}`} style={{ width: `${pct}%` }} />
          </div>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`text-white/25 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="mt-3 border-t border-white/[0.06] pt-2">
          {(regime.components ?? []).map((c) => (
            <ComponentRow key={c.key} label={c.label} score={c.score} detail={c.detail} />
          ))}
          {/* Said plainly, because a number next to a list of picks invites exactly
              the reading it must not have. */}
          <p className="mt-2.5 text-[10px] leading-relaxed text-white/25">
            Rates the market, not the picks. A strong setup in a weak tape is still a strong
            setup — this argues about position size, not about whether an idea is good.
            Uncalibrated: one month of history could not separate its signal from drift,
            so nothing downstream acts on it automatically.
          </p>
        </div>
      )}
    </div>
  )
}
