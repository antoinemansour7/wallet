import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Logo({ size = 30, withWordmark = true }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-[11px] bg-gradient-accent text-ink shadow-[0_8px_24px_rgba(52,211,153,0.16)]"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 32 32" className="size-[72%]" fill="none">
          <path d="M5 8.5 9.5 23 14.8 11.5 20.2 23 27 8.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {withWordmark && (
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">
          Wall<span className="text-gradient">AI</span>
        </span>
      )}
    </span>
  )
}

const NAV_ITEMS = [
  { to: '/portfolio', label: 'Portfolio', icon: PortfolioIcon },
  { to: '/research', label: 'Research', icon: ResearchIcon },
  { to: '/history', label: 'History', icon: HistoryIcon },
]

function Avatar({ user, size = 32 }) {
  if (user?.photoURL) {
    return <img src={user.photoURL} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-full ring-1 ring-white/10" />
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-accent font-semibold text-brand"
    >
      {user?.displayName?.[0] ?? '?'}
    </div>
  )
}

// Account dropdown. Three nav items don't justify a persistent rail, but the
// account details still need somewhere to live — a menu keeps the bar itself
// down to identity and navigation.
function AccountMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
          open ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'
        }`}
      >
        <Avatar user={user} size={28} />
        <span className="hidden text-[13px] font-medium text-white/70 sm:block">
          {user.displayName?.split(' ')[0]}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          className={`text-white/35 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="animate-fade-in absolute right-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-xl border border-white/10 bg-wall-elevated shadow-card"
        >
          <div className="flex items-center gap-3 border-b border-white/[0.06] px-3.5 py-3">
            <Avatar user={user} size={34} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-white/90">{user.displayName}</p>
              <p className="truncate text-[11px] text-white/35">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onSignOut() }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-white/60 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:bg-white/[0.05]"
          >
            <SignOutIcon />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// App shell navigation. Three destinations don't warrant a 260px rail — a top
// bar gives the full window width back to the dashboard, which is the dense
// part of this app. Mobile keeps the native-style bottom tab bar.
export default function Navbar() {
  const { user, signOut } = useAuth()

  return (
    <>
      <header className="glass sticky top-0 z-40 border-b border-white/[0.06]">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <NavLink
            to="/portfolio"
            aria-label="WallAI home"
            className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <Logo />
          </NavLink>

          {/* Primary nav — a filled pill for the active view, so it never reads
              as the same control as the page-level underlined tabs below it. */}
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_ITEMS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `rounded-lg px-3.5 py-2 text-[13.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                    isActive
                      ? 'bg-white/[0.08] text-white'
                      : 'text-white/50 hover:bg-white/[0.04] hover:text-white/90'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center">
            {user && <AccountMenu user={user} onSignOut={signOut} />}
          </div>
        </div>
      </header>

      {/* ── Mobile bottom tab bar ────────────────────────────────────── */}
      <nav className="glass fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.06] pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="grid grid-cols-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-1.5 py-2.5 text-[10px] font-medium transition-colors duration-150 ${
                  isActive ? 'text-accent' : 'text-white/40'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute top-0 h-[2px] w-7 rounded-full bg-gradient-accent" />}
                  <Icon />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  )
}

function PortfolioIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  )
}

function ResearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}
