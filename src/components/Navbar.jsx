import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, signOut } = useAuth()

  return (
    <nav className="sticky top-0 z-50 h-14 border-b border-white/[0.06] bg-wall-surface/90 px-5 glass">
      <div className="flex h-full items-center justify-between">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/10">
              <LogoIcon />
            </div>
            <span className="font-display text-sm font-semibold tracking-tight text-white">WallAI</span>
          </div>

          <div className="h-4 w-px bg-white/10" />

          <div className="flex items-center gap-0.5">
            <NavItem to="/portfolio" icon={<PortfolioIcon />}>Portfolio</NavItem>
            <NavItem to="/research" icon={<ResearchIcon />}>Research</NavItem>
            <NavItem to="/history" icon={<HistoryIcon />}>History</NavItem>
          </div>
        </div>

        {user && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName}
                  className="h-7 w-7 rounded-full ring-1 ring-white/10"
                />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-xs font-semibold text-white/60">
                  {user.displayName?.[0] ?? '?'}
                </div>
              )}
              <span className="hidden text-sm text-white/50 sm:block">
                {user.displayName?.split(' ')[0]}
              </span>
            </div>

            <div className="h-4 w-px bg-white/10" />

            <button
              onClick={signOut}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-white/50 transition-all hover:bg-white/[0.06] hover:text-white"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}

function NavItem({ to, icon, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-white/10 text-white'
            : 'text-white/50 hover:bg-white/[0.06] hover:text-white'
        }`
      }
    >
      {icon}
      {children}
    </NavLink>
  )
}

function LogoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
      <path d="M2 16L7 9L11 13L15 6L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PortfolioIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  )
}

function ResearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
