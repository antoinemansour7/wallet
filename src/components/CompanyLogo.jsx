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
        src={`https://assets.parqet.com/logos/symbol/${encodeURIComponent(sym)}?format=png&size=${size * 2}`}
        alt={`${sym} logo`}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  )
}
