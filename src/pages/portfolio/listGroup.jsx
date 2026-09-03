// The grouped list is the app's one way of presenting a small set of choices:
// a single surface, hairlines between rows, a tile on the left, nothing
// floating. It was invented in AddAccountModal and then re-typed by hand
// wherever else it was needed, which is how the accounts screen ended up with
// a different empty state than the sheet it opens.

/** One surface, hairlines between rows, nothing floating. */
export function Group({ children, className = '', ...rest }) {
  return (
    <div {...rest} className={`divide-y divide-ink/[0.06] overflow-hidden rounded-2xl border border-ink/[0.08] ${className}`}>
      {children}
    </div>
  )
}

/** The square icon well that opens a row. */
export const Tile = ({ children }) => (
  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-ink/[0.06] text-ink/55">
    {children}
  </span>
)

/** A row that goes somewhere. */
export function Option({ icon, title, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 px-4 py-4 text-left transition-colors duration-motion-short hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:bg-ink/[0.04]"
    >
      <Tile>{icon}</Tile>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium tracking-[-0.01em] text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] text-ink/45">{hint}</span>
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink/25">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}

// The two ways into this app, drawn once. They appear on the empty accounts
// screen and again inside the add sheet, and they have to match.

export const IconStatement = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
  </svg>
)

export const IconBrokerage = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
  </svg>
)
