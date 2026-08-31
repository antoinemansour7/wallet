import { useEffect } from 'react'
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

// Grouped nav: category headers are what let a sidebar grow past a handful of
// items without turning into an undifferentiated list.
const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [{ to: '/portfolio', label: 'Portfolio', icon: PortfolioIcon }],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/research', label: 'Research', icon: ResearchIcon },
      { to: '/history', label: 'History', icon: HistoryIcon },
    ],
  },
]

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items)

// Collapsed rail shows icons only, so every item needs a label on hover.
// A styled tooltip rather than `title` — the native one waits about a second
// and can't be themed, which reads as the app being unresponsive.
function Tooltip({ label }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 translate-x-[-4px] whitespace-nowrap rounded-md border border-white/10 bg-wall-elevated px-2.5 py-1.5 text-[12px] font-medium text-white/90 opacity-0 shadow-card transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
    >
      {label}
    </span>
  )
}

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

const RAIL_TRANSITION = 'transition-[width,padding] duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)]'

// App shell navigation: collapsible sidebar on desktop, native-style bottom
// tab bar on mobile — the structure real broker apps use.
export default function Navbar({ collapsed = false, onToggleSidebar }) {
  const { user, signOut } = useAuth()

  // Power-user shortcut, the same key Linear and Notion bind it to.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target
      if (el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
      e.preventDefault()
      onToggleSidebar?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onToggleSidebar])

  return (
    <>
      {/* ── Desktop sidebar (collapsible) ────────────────────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-white/[0.06] bg-wall-bg lg:flex ${RAIL_TRANSITION} ${collapsed ? 'w-16' : 'w-[260px]'}`}
      >
        {/* Header — fixed height in both states so nothing below it shifts
            when the rail collapses. Collapsed, the logo swaps to the toggle
            on hover instead of the toggle claiming a row of its own. */}
        <div className={`group relative flex h-16 shrink-0 items-center ${collapsed ? 'justify-center px-0' : 'justify-between px-4'}`}>
          <NavLink
            to="/portfolio"
            aria-label="WallAI home"
            className={`rounded-lg transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
              collapsed ? 'group-hover:opacity-0' : ''
            }`}
          >
            <Logo withWordmark={!collapsed} />
          </NavLink>
          <button
            onClick={onToggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={`${collapsed ? 'Expand' : 'Collapse'} sidebar  [`}
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-white/35 transition-all duration-150 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
              collapsed
                ? 'absolute left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                : ''
            }`}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </button>
        </div>

        {/* Nav — scrolls independently so the account block stays pinned.
            Collapsed it must not scroll: any overflow value other than
            `visible` on one axis clips the other, which would cut the rail
            tooltips off at the sidebar edge. */}
        <nav className={`flex-1 pb-4 scrollbar-none ${collapsed ? 'overflow-visible px-2' : 'overflow-y-auto overflow-x-hidden px-3'}`}>
          {NAV_GROUPS.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex > 0 ? 'mt-5' : ''}>
              {collapsed ? (
                groupIndex > 0 && <div className="mx-auto mb-2 h-px w-6 bg-white/[0.07]" />
              ) : (
                <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/25">
                  {group.label}
                </p>
              )}

              <div className="flex flex-col gap-1">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `group relative flex h-10 items-center rounded-[10px] text-[14px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                        collapsed ? 'justify-center px-0' : 'gap-3 px-3'
                      } ${
                        isActive
                          ? 'bg-white/[0.07] text-white'
                          : 'text-white/50 hover:bg-white/[0.035] hover:text-white/90'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {/* Inside the item, so it can never clip against the
                            rail edge the way an outdented bar does. */}
                        {isActive && !collapsed && (
                          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-accent" />
                        )}
                        <span
                          className={`flex w-5 shrink-0 justify-center ${
                            isActive ? 'text-accent' : 'text-white/40 transition-colors group-hover:text-white/70'
                          }`}
                        >
                          <Icon />
                        </span>
                        {collapsed ? <Tooltip label={label} /> : label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Account — pinned to the bottom, separated by a divider */}
        {user && (
          <div className={`mt-auto shrink-0 pb-4 ${collapsed ? 'px-2' : 'px-3'}`}>
            <div className="mb-3 h-px bg-white/[0.06]" />
            {collapsed ? (
              <div className="flex flex-col items-center gap-2">
                <div className="group relative flex h-8 w-8 items-center justify-center">
                  <Avatar user={user} size={30} />
                  <Tooltip label={user.displayName || user.email} />
                </div>
                <button
                  onClick={signOut}
                  aria-label="Sign out"
                  className="group relative flex h-8 w-8 items-center justify-center rounded-lg text-white/35 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  <SignOutIcon />
                  <Tooltip label="Sign out" />
                </button>
              </div>
            ) : (
              <div className="flex h-12 items-center gap-2.5 rounded-[10px] px-2 transition-colors duration-150 hover:bg-white/[0.035]">
                <Avatar user={user} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-white/85">{user.displayName?.split(' ')[0]}</p>
                  <p className="truncate text-[11px] text-white/30">{user.email}</p>
                </div>
                <button
                  onClick={signOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/35 transition-colors duration-150 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
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
        <NavLink to="/portfolio"><Logo size={28} /></NavLink>
        {user && (
          <div className="flex items-center gap-2">
            <Avatar user={user} size={28} />
            <button
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white/35 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
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

function ChevronLeftIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
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
