import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, signOut } = useAuth()

  return (
    <nav className="sticky top-0 z-50 bg-wall-bg/80 backdrop-blur-xl border-b border-white/[0.06] h-14 px-6 flex items-center justify-between">
      {/* Left: Brand + nav */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center shadow-sm shadow-blue-600/30">
            <LogoIcon />
          </div>
          <span className="text-slate-100 font-semibold text-sm tracking-tight">WallAI</span>
        </div>

        <div className="h-4 w-px bg-white/[0.08]" />

        <div className="flex items-center gap-1">
          <NavLink
            to="/portfolio"
            className={({ isActive }) =>
              `flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-all duration-150 ${
                isActive
                  ? 'text-white bg-white/[0.08]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`
            }
          >
            <PortfolioIcon />
            Portfolio
          </NavLink>

          <NavLink
            to="/research"
            className={({ isActive }) =>
              `flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-all duration-150 ${
                isActive
                  ? 'text-white bg-white/[0.08]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`
            }
          >
            <ResearchIcon />
            Research
          </NavLink>
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
                className="w-7 h-7 rounded-full ring-1 ring-white/10"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-semibold">
                {user.displayName?.[0] ?? '?'}
              </div>
            )}
            <span className="text-slate-400 text-sm hidden sm:block">
              {user.displayName?.split(' ')[0]}
            </span>
          </div>

          <div className="h-4 w-px bg-white/[0.06]" />

          <button
            onClick={signOut}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer px-2 py-1 rounded-md hover:bg-white/[0.04]"
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  )
}

function ResearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}
