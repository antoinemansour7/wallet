import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Logo({ size = 30, withWordmark = true }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="flex shrink-0 items-center justify-center rounded-[9px] bg-gradient-accent font-bold leading-none text-brand"
        style={{ width: size, height: size, fontSize: size * 0.5 }}
      >
        W
      </span>
      {withWordmark && (
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-white">
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

// App shell navigation: collapsible sidebar on desktop, native-style bottom
// tab bar on mobile — the structure real broker apps use.
export default function Navbar({ collapsed = false, onToggleSidebar }) {
  const { user, signOut } = useAuth()

  return (
    <>
      {/* ── Desktop sidebar (collapsible) ────────────────────────────── */}
      <aside className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-white/[0.06] bg-wall-bg transition-[width] duration-ws ease-ws lg:flex ${collapsed ? 'w-[72px]' : 'w-[244px]'}`}>
        {/* Header: logo + collapse toggle */}
        <div className={`flex h-16 shrink-0 items-center ${collapsed ? 'justify-center px-0' : 'justify-between px-5'}`}>
          <NavLink to="/" aria-label="WallAI home">
            <Logo withWordmark={!collapsed} />
          </NavLink>
          {!collapsed && (
            <button
              onClick={onToggleSidebar}
              aria-label="Collapse sidebar"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.05] hover:text-white/70"
            >
              <ChevronLeftIcon />
            </button>
          )}
        </div>

        {collapsed && (
          <div className="flex shrink-0 justify-center pb-3">
            <button
              onClick={onToggleSidebar}
              aria-label="Expand sidebar"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.05] hover:text-white/70"
            >
              <ChevronRightIcon />
            </button>
          </div>
        )}

        {/* Nav */}
        <nav className="flex flex-col gap-0.5 px-3">
          {!collapsed && (
            <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/25">Menu</p>
          )}
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `group relative flex h-10 items-center rounded-[10px] text-[13.5px] font-medium transition-colors duration-ws ease-ws ${
                  collapsed ? 'justify-center' : 'gap-3 px-3'
                } ${
                  isActive
                    ? 'bg-white/[0.05] text-white'
                    : 'text-white/45 hover:bg-white/[0.03] hover:text-white/80'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-accent" />
                  )}
                  <span className={`flex w-[18px] shrink-0 justify-center ${isActive ? 'text-accent' : 'text-white/35 transition-colors group-hover:text-white/60'}`}>
                    <Icon />
                  </span>
                  {!collapsed && label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        {user && (
          <div className="mt-auto px-3 pb-4">
            <div className="mb-3 h-px bg-white/[0.06]" />
            {collapsed ? (
              <div className="flex flex-col items-center gap-2.5">
                <Avatar user={user} size={32} />
                <button
                  onClick={signOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.05] hover:text-white/70"
                >
                  <SignOutIcon />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 px-1">
                <Avatar user={user} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-white/85">{user.displayName?.split(' ')[0]}</p>
                  <p className="truncate text-[11px] text-white/30">{user.email}</p>
                </div>
                <button
                  onClick={signOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.05] hover:text-white/70"
                >
                  <SignOutIcon />
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ── Mobile top strip ─────────────────────────────────────────── */}
      <header className="glass sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/[0.05] px-5 lg:hidden">
        <NavLink to="/"><Logo size={28} /></NavLink>
        {user && (
          <div className="flex items-center gap-2">
            <Avatar user={user} size={28} />
            <button
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white/30 transition-colors hover:text-white/70"
            >
              <SignOutIcon />
            </button>
          </div>
        )}
      </header>

      {/* ── Mobile bottom tab bar ────────────────────────────────────── */}
      <nav className="glass fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.06] pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="grid grid-cols-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-1.5 py-2.5 text-[10px] font-medium transition-colors duration-ws ease-ws ${
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  )
}

function ResearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}
