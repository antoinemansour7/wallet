import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useState } from 'react'

export default function Navbar() {
  const { user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <nav className="sticky top-0 z-50 border-b border-white/[0.04] bg-wall-bg/80 glass">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        {/* Left: logo + nav */}
        <div className="flex items-center gap-5">
          <NavLink to="/" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.08]">
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
                <path d="M2 16L7 9L11 13L15 6L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-[14px] font-semibold tracking-[-0.02em] text-white">WallAI</span>
          </NavLink>

          {/* Desktop nav links */}
          <div className="hidden items-center gap-0.5 sm:flex">
            <NavItem to="/portfolio">Portfolio</NavItem>
            <NavItem to="/research">Research</NavItem>
            <NavItem to="/history">History</NavItem>
          </div>
        </div>

        {/* Right: user */}
        <div className="flex items-center gap-3">
          {user && (
            <div className="hidden items-center gap-3 sm:flex">
              <div className="flex items-center gap-2">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="h-7 w-7 rounded-full ring-1 ring-white/[0.08]" />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-medium text-white/60">
                    {user.displayName?.[0] ?? '?'}
                  </div>
                )}
                <span className="text-[13px] text-white/40">
                  {user.displayName?.split(' ')[0]}
                </span>
              </div>
              <button
                onClick={signOut}
                className="rounded-full px-3 py-1.5 text-[12px] text-white/30 transition-all duration-200 hover:bg-white/[0.04] hover:text-white/60"
              >
                Sign out
              </button>
            </div>
          )}

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.05] hover:text-white sm:hidden"
            aria-label="Menu"
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="border-t border-white/[0.04] px-5 pb-5 pt-3 sm:hidden">
          <div className="flex flex-col gap-0.5">
            <MobileNavItem to="/portfolio" onClick={() => setMenuOpen(false)}>Portfolio</MobileNavItem>
            <MobileNavItem to="/research" onClick={() => setMenuOpen(false)}>Research</MobileNavItem>
            <MobileNavItem to="/history" onClick={() => setMenuOpen(false)}>History</MobileNavItem>
          </div>
          {user && (
            <div className="mt-4 flex items-center justify-between border-t border-white/[0.04] pt-4">
              <span className="text-[13px] text-white/40">{user.displayName?.split(' ')[0]}</span>
              <button
                onClick={() => { signOut(); setMenuOpen(false) }}
                className="text-[12px] text-white/30 transition-colors hover:text-white/60"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  )
}

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-full px-4 py-2 text-[13px] font-medium tracking-[-0.01em] transition-all duration-300 ${
          isActive
            ? 'bg-white/[0.08] text-white'
            : 'text-white/40 hover:text-white/70'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

function MobileNavItem({ to, children, onClick }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `rounded-xl px-4 py-3 text-[14px] font-medium transition-all duration-200 ${
          isActive
            ? 'bg-white/[0.06] text-white'
            : 'text-white/40 active:bg-white/[0.04]'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
