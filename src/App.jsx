import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ErrorBoundary, { PageFallback } from './components/ErrorBoundary'
import ProtectedRoute from './components/ProtectedRoute'
import Navbar from './components/Navbar'
import Login from './pages/Login'
import Portfolio from './pages/Portfolio'
import Research from './pages/Research'
import History from './pages/History'

const LandingPage = lazy(() => import('../app/page'))
const ResearchEvaluation = lazy(() => import('./pages/ResearchEvaluation'))
const ResearchLogs = lazy(() => import('./pages/ResearchLogs'))

function AppLayout({ children }) {
  // Keyed on the route: a crash on Portfolio should not follow you to
  // Research, and navigating back to the page that crashed is itself a retry
  // rather than a screen stuck showing the old error forever.
  const { pathname } = useLocation()

  return (
    <>
      <Navbar />
      {/* Only offset needed is for the mobile bottom tab bar — the top bar is
          in normal flow, so content gets the full window width on desktop. */}
      <main className="pb-20 lg:pb-0">
        <ErrorBoundary context="page" resetKey={pathname} fallback={PageFallback}>
          {children}
        </ErrorBoundary>
      </main>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Suspense fallback={null}><LandingPage /></Suspense>} />
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
            path="/research/evaluation"
            element={<ProtectedRoute><AppLayout><Suspense fallback={null}><ResearchEvaluation /></Suspense></AppLayout></ProtectedRoute>}
          />
          <Route
            path="/research/logs"
            element={<ProtectedRoute><AppLayout><Suspense fallback={null}><ResearchLogs /></Suspense></AppLayout></ProtectedRoute>}
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
