import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'

// Mock AuthContext so tests don't need Firebase
vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../context/AuthContext'

function renderWithRouter(user, initialPath = '/protected') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/protected"
          element={
            <ProtectedRoute>
              <div>Protected content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  it('renders children when user is authenticated', () => {
    useAuth.mockReturnValue({ user: { uid: 'abc', displayName: 'Alice' } })
    renderWithRouter({ uid: 'abc' })

    expect(screen.getByText('Protected content')).toBeInTheDocument()
  })

  it('redirects to /login when user is null', () => {
    useAuth.mockReturnValue({ user: null })
    renderWithRouter(null)

    expect(screen.getByText('Login page')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('redirects to /login when user is undefined', () => {
    useAuth.mockReturnValue({ user: undefined })
    renderWithRouter(undefined)

    expect(screen.getByText('Login page')).toBeInTheDocument()
  })
})
