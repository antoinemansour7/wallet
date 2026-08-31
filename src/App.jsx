import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Navbar from './components/Navbar'
import Login from './pages/Login'
import Portfolio from './pages/Portfolio'
import Research from './pages/Research'
import History from './pages/History'

const SIDEBAR_PREF_KEY = 'wallai:sidebar'

function AppLayout({ children }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_PREF_KEY) === 'collapsed' } catch { return false }
  })

  const toggleSidebar = () => {
    setCollapsed((current) => {
      try { localStorage.setItem(SIDEBAR_PREF_KEY, current ? 'open' : 'collapsed') } catch { /* ignore */ }
      return !current
    })
  }

  return (
    <>
      <Navbar collapsed={collapsed} onToggleSidebar={toggleSidebar} />
      {/* offset for desktop sidebar + mobile bottom tab bar, animated with the
          rail — same duration and curve as the sidebar so they move as one */}
      <main className={`pb-20 transition-[padding] duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)] lg:pb-0 ${collapsed ? 'lg:pl-16' : 'lg:pl-[260px]'}`}>
        {children}
      </main>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/portfolio"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Portfolio />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/research"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Research />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <History />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/portfolio" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
