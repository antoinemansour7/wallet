import { useEffect, useState } from 'react'

// Some Canadian CDR tickers differ from the US underlying they track —
// map them so the logo lookup hits the real company.
const CDR_UNDERLYING = {
  ORAC: 'ORCL',
  NOWS: 'NOW',
}

/**
 * Single-stock leveraged ETFs, mapped to the company they track.
 *
 * You hold these to get exposure to one business, so the business is what the
 * row should be captioned with. Left alone they are worse than anonymous: the
 * CDN either 404s (NVDL, CONL, MSTU) and falls through to a letter circle, or
 * serves the *issuer's* house logo (TSLL, AMDL), so a Direxion Tesla product and
 * a Direxion Apple product render as the same picture.
 *
 * Every entry verified against the product's official name on 2026-08-31.
 */
const LEVERAGED_UNDERLYING = {
  NVDL: 'NVDA', NVDX: 'NVDA', NVDU: 'NVDA', NVDD: 'NVDA',
  TSLL: 'TSLA', TSLT: 'TSLA', TSLR: 'TSLA', TSLS: 'TSLA',
  CONL: 'COIN',
  MSTU: 'MSTR', MSTX: 'MSTR', MSTZ: 'MSTR',
  AMDL: 'AMD',
  AAPU: 'AAPL', AAPD: 'AAPL', AAPB: 'AAPL',
  MSFU: 'MSFT', MSFD: 'MSFT',
  GGLL: 'GOOGL', GGLS: 'GOOGL',
  METU: 'META', METD: 'META',
  AMZU: 'AMZN', AMZD: 'AMZN',
  PLTU: 'PLTR',
}

// Words that appear in a fund's name but are never the underlying ticker.
const NAME_NOISE = new Set([
  'BULL', 'BEAR', 'LONG', 'SHORT', 'DAILY', 'TARGET', 'ETF', 'ETN', 'FUND',
  'TRUST', 'SHARES', 'INDEX', 'CLASS', 'NEW', 'THE', 'AND', 'INC', 'CORP',
  'CO', 'LTD', 'PLC', 'SA', 'NV', 'AG', 'US', 'USD', 'CAD', 'HDG', 'CDR',
  'HEDGED', 'UNITS', 'UNIT', 'SP', 'TSX', 'NASDAQ', 'DOW',
])

/**
 * Pull the underlying ticker out of a leveraged product's name, for the ones
 * not in the map above. Only runs when the name actually reads as a leveraged
 * product, so an ordinary holding is never second-guessed.
 *
 * Index products — "BETAPRO SP500 2X DAILY BULL ETF" — deliberately yield
 * nothing. There is no single company behind them, and the issuer's own logo is
 * the honest answer.
 */
const DIRECTION_WORDS = new Set(['LONG', 'BULL', 'BEAR', 'SHORT'])

export function underlyingFromName(name, symbol) {
  const text = String(name || '')
  if (!/\b(\d+(?:\.\d+)?\s*X|BULL|BEAR|LEVERAGED)\b/i.test(text)) return null

  const self = String(symbol || '').toUpperCase().split('.')[0]
  const words = text.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  const plausible = (w) => (
    w && w.length >= 2 && w.length <= 5
    && /^[A-Z]+$/.test(w)
    && !NAME_NOISE.has(w)
    && !DIRECTION_WORDS.has(w)
    && w !== self
  )

  // The underlying sits next to the direction word, on one side or the other:
  //   "GraniteShares 2x Long NVDA Daily"   -> after
  //   "Direxion Daily TSLA Bull 2X ETF"    -> before
  // Scanning for the first plausible token anywhere instead picked up the
  // issuer — "T-Rex 2X Long MSTR" yielded REX.
  for (let i = 0; i < words.length; i += 1) {
    if (!DIRECTION_WORDS.has(words[i])) continue
    for (const candidate of [words[i + 1], words[i - 1]]) {
      if (plausible(candidate)) return candidate
    }
  }
  return null
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
export function logoCandidates(symbol, description = '') {
  const raw = String(symbol || '').trim().toUpperCase()
  if (!raw) return []

  const dot = raw.indexOf('.')
  const base = dot === -1 ? raw : raw.slice(0, dot)
  const suffix = dot === -1 ? '' : raw.slice(dot + 1)
  const mapped = CDR_UNDERLYING[base]

  // A leveraged wrapper is a way to own one company; caption it with that
  // company. The map is checked first, the product's own name second.
  const underlying = LEVERAGED_UNDERLYING[base] ?? underlyingFromName(description, raw)

  const order = suffix === 'NE'
    ? [mapped, base]                    // CDR — the US underlying is the company
    : suffix
      ? [underlying, raw, mapped, base] // TSX/TSXV — suffixed symbol is the right one
      : [underlying, mapped, base]

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
export default function CompanyLogo({ symbol, description = '', size = 40, className = '' }) {
  const candidates = logoCandidates(symbol, description)
  const [attempt, setAttempt] = useState(0)

  // A recycled row (holdings re-sort, a new pick list) hands this component a
  // different symbol without remounting it. Without the reset, a symbol that
  // had exhausted its candidates would show the letter avatar forever.
  useEffect(() => { setAttempt(0) }, [symbol, description])

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
