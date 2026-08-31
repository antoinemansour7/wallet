import { useState } from 'react'

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

function logoSymbol(symbol) {
  const base = String(symbol || '').toUpperCase().replace(/\.(NE|TO|V)$/, '')
  return CDR_UNDERLYING[base] ?? base
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
 * Company logo by ticker (Parqet CDN), falling back to a gradient initial
 * when the symbol has no logo. `size` is the rendered diameter in px.
 */
export default function CompanyLogo({ symbol, size = 40, className = '' }) {
  const [failed, setFailed] = useState(false)
  const sym = logoSymbol(symbol)

  if (!sym || failed) {
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
        src={logoUrl(sym, size, 1)}
        // The CDN honours whatever pixel size it is asked for, so let the
        // browser pick by device pixel ratio instead of hard-coding 2x. A
        // 3x phone was rendering a 2x image scaled up, which is what made
        // these look soft.
        srcSet={`${logoUrl(sym, size, 1)} 1x, ${logoUrl(sym, size, 2)} 2x, ${logoUrl(sym, size, 3)} 3x`}
        alt={`${sym} logo`}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  )
}
