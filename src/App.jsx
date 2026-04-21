import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Navbar from './components/Navbar'
import Login from './pages/Login'
import Portfolio from './pages/Portfolio'
import Research from './pages/Research'

function AppLayout({ children }) {
  return (
    <>
      <Navbar />
      <main>{children}</main>
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
          <Route path="*" element={<Navigate to="/portfolio" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
