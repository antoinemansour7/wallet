// Spot illustrations for empty states — gradient line-art, drawn as SVG so
// they stay crisp at any size and weigh nothing.

function GradientDefs({ id }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#d4d4d8" />
        <stop offset="60%" stopColor="#a1a1aa" />
        <stop offset="100%" stopColor="#71717a" />
      </linearGradient>
    </defs>
  )
}

/** Rising chart inside a floating card, with sparkles — "no data yet" */
export function ChartSpot({ size = 120 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <GradientDefs id="spot-chart" />
      {/* floating card */}
      <rect x="18" y="30" width="84" height="64" rx="12" fill="#141417" stroke="#26262b" strokeWidth="1.5" />
      <rect x="26" y="40" width="24" height="5" rx="2.5" fill="#26262b" />
      {/* rising line */}
      <path
        d="M28 80 L44 68 L56 74 L72 56 L92 46"
        stroke="url(#spot-chart)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="92" cy="46" r="3.5" fill="#a1a1aa" />
      <circle cx="92" cy="46" r="7" stroke="#a1a1aa" strokeOpacity="0.3" strokeWidth="1.5" />
      {/* sparkles */}
      <path d="M104 24 l2.2 5 5 2.2 -5 2.2 -2.2 5 -2.2 -5 -5 -2.2 5 -2.2 z" fill="url(#spot-chart)" opacity="0.9" />
      <path d="M12 60 l1.6 3.6 3.6 1.6 -3.6 1.6 -1.6 3.6 -1.6 -3.6 -3.6 -1.6 3.6 -1.6 z" fill="#d4d4d8" opacity="0.55" />
      <circle cx="22" cy="20" r="2" fill="#71717a" opacity="0.5" />
    </svg>
  )
}

/** Magnifier over candlesticks — "no picks yet" */
export function SearchSpot({ size = 110 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 110 110" fill="none" aria-hidden="true">
      <GradientDefs id="spot-search" />
      {/* candles */}
      <g stroke="#3a3a42" strokeWidth="2" strokeLinecap="round">
        <path d="M30 46v26" /><path d="M48 38v34" /><path d="M66 50v22" />
      </g>
      <g strokeWidth="6" strokeLinecap="round">
        <path d="M30 52v12" stroke="#34d399" opacity="0.85" />
        <path d="M48 44v18" stroke="url(#spot-search)" />
        <path d="M66 56v9" stroke="#fb7185" opacity="0.8" />
      </g>
      {/* magnifier */}
      <circle cx="68" cy="44" r="20" stroke="url(#spot-search)" strokeWidth="2.5" fill="rgba(99,102,241,0.06)" />
      <path d="M82.5 58.5 L94 70" stroke="url(#spot-search)" strokeWidth="3.5" strokeLinecap="round" />
      {/* sparkle */}
      <path d="M18 22 l2 4.4 4.4 2 -4.4 2 -2 4.4 -2 -4.4 -4.4 -2 4.4 -2 z" fill="url(#spot-search)" opacity="0.75" />
    </svg>
  )
}

/** Calendar with a small trend line — "history is empty" */
export function HistorySpot({ size = 110 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 110 110" fill="none" aria-hidden="true">
      <GradientDefs id="spot-history" />
      <rect x="20" y="26" width="70" height="62" rx="10" fill="#141417" stroke="#26262b" strokeWidth="1.5" />
      <path d="M20 42h70" stroke="#26262b" strokeWidth="1.5" />
      <path d="M36 20v12M74 20v12" stroke="url(#spot-history)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M32 70 L46 60 L58 66 L78 52" stroke="url(#spot-history)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="78" cy="52" r="3" fill="#a1a1aa" />
      <circle cx="96" cy="30" r="2" fill="#71717a" opacity="0.5" />
    </svg>
  )
}
