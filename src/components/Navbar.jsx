import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, signOut } = useAuth()

  return (
    <nav className="sticky top-0 z-50 h-14 border-b border-black/[0.07] bg-wall-bg/90 px-5 backdrop-blur-xl glass">
      <div className="flex h-full items-center justify-between">
        {/* Left: Brand + nav */}
        <div className="flex items-center gap-5">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-wall-green shadow-sm">
              <LogoIcon />
            </div>
            <span className="text-sm font-bold tracking-tight text-stone-800">WallAI</span>
          </div>

          <div className="h-4 w-px bg-black/[0.08]" />

          {/* Nav links */}
          <div className="flex items-center gap-0.5">
            <NavItem to="/portfolio" icon={<PortfolioIcon />}>Portfolio</NavItem>
            <NavItem to="/research" icon={<ResearchIcon />}>Research</NavItem>
          </div>
        </div>

        {/* Right: User */}
        {user && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName}
                  className="h-7 w-7 rounded-full ring-1 ring-black/10"
                />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-wall-green/20 bg-wall-green-light text-xs font-bold text-wall-green">
                  {user.displayName?.[0] ?? '?'}
                </div>
              )}
              <span className="hidden text-sm text-stone-500 sm:block">
                {user.displayName?.split(' ')[0]}
              </span>
            </div>

            <div className="h-4 w-px bg-black/[0.08]" />

            <button
              onClick={signOut}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-400 transition-all hover:bg-black/[0.05] hover:text-stone-700"
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
        `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-wall-green text-white'
            : 'text-stone-500 hover:bg-black/[0.05] hover:text-stone-800'
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
