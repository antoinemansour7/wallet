import { useEffect, useState } from 'react'

// Some Canadian CDR tickers differ from the US underlying they track —
// map them so the logo lookup hits the real company.
const CDR_UNDERLYING = {
  ORAC: 'ORCL',
  NOWS: 'NOW',
}

// Deterministic gradient fallback when no logo exists for a symbol
const AVATAR_TINTS = [
  'from-indigo-500/80 to-violet-500/80',
  'from-violet-500/80 to-fuchsia-500/80',
  'from-sky-500/80 to-indigo-500/80',
  'from-emerald-500/80 to-teal-500/80',
  'from-fuchsia-500/80 to-pink-500/80',
  'from-amber-500/80 to-orange-500/80',
]

export function avatarTint(symbol) {
  const code = String(symbol).split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  return AVATAR_TINTS[code % AVATAR_TINTS.length]
}

/**
 * Symbols to try, best first.
 *
 * This used to strip the exchange suffix and look up the bare ticker, which was
 * wrong for TSX listings in a way that showed the *wrong company's* logo rather
 * than no logo. The CDN carries suffixed symbols, and the bare form is often a
 * different business entirely — verified 2026-08-31, all distinct images:
 *
 *   AC.TO  Air Canada   vs  AC   Associated Capital Group
 *   T.TO   Telus        vs  T    AT&T
 *   CNR.TO CN Rail      vs  CNR  (a different listing)
 *   HSU.TO BetaPro 2x   vs  HSU  404 — this one fell back to a letter circle
 *
 * CDRs are the opposite case: `.NE` almost always 404s (AVGO.NE, ORAC.NE both
 * do), and the right logo is the US underlying's anyway, so those keep being
 * stripped and mapped.
 *
 * Unknown symbols 404 cleanly — no placeholder image — so walking the list and
 * landing on the letter avatar is safe.
 */
export function logoCandidates(symbol) {
  const raw = String(symbol || '').trim().toUpperCase()
  if (!raw) return []

  const dot = raw.indexOf('.')
  const base = dot === -1 ? raw : raw.slice(0, dot)
  const suffix = dot === -1 ? '' : raw.slice(dot + 1)
  const mapped = CDR_UNDERLYING[base]

  const order = suffix === 'NE'
    ? [mapped, base]          // CDR — the US underlying is the real company
    : suffix
      ? [raw, mapped, base]   // TSX/TSXV — the suffixed symbol is the right one
      : [mapped, base]

  return [...new Set(order.filter(Boolean))]
}

// Snap to a handful of widths rather than asking for whatever `size * dpr`
// happens to be. Every distinct pixel size is a separate CDN object, so asking
// for 76 here and 88 there meant almost every logo was a cache miss.
const SIZE_BUCKETS = [32, 64, 96, 128, 192, 256, 384, 512]

export function logoUrl(symbol, size, scale = 1) {
  const wanted = Math.round(size * scale)
  const bucket = SIZE_BUCKETS.find((b) => b >= wanted) ?? SIZE_BUCKETS.at(-1)
  return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}?format=png&size=${bucket}`
}

/**
 * Company logo by ticker (Parqet CDN), falling back through the candidate
 * symbols and finally to a gradient initial. `size` is the diameter in px.
 */
export default function CompanyLogo({ symbol, size = 40, className = '' }) {
  const candidates = logoCandidates(symbol)
  const [attempt, setAttempt] = useState(0)

  // A recycled row (holdings re-sort, a new pick list) hands this component a
  // different symbol without remounting it. Without the reset, a symbol that
  // had exhausted its candidates would show the letter avatar forever.
  useEffect(() => { setAttempt(0) }, [symbol])

  const sym = candidates[attempt]

  if (!sym) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white ${avatarTint(symbol)} ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.38 }}
      >
        {String(symbol || '?')[0]}
      </div>
    )
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        // Keyed so a failed candidate is torn down rather than reused — React
        // would otherwise keep the broken <img> and never re-request.
        key={sym}
        src={logoUrl(sym, size, 1)}
        // The CDN honours whatever pixel size it is asked for, so let the
        // browser pick by device pixel ratio instead of hard-coding 2x. A
        // 3x phone was rendering a 2x image scaled up, which made these soft.
        srcSet={`${logoUrl(sym, size, 1)} 1x, ${logoUrl(sym, size, 2)} 2x, ${logoUrl(sym, size, 3)} 3x`}
        alt={`${sym} logo`}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-contain"
        onError={() => setAttempt((i) => i + 1)}
      />
    </div>
  )
}
