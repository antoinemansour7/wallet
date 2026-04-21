import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Login from './Login'

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn() }
})

import { useAuth } from '../context/AuthContext'

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  )
}

describe('Login page', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({
      user: null,
      signInWithGoogle: vi.fn().mockResolvedValue({}),
    })
  })

  it('renders brand name', () => {
    renderLogin()
    expect(screen.getByText('WallAI')).toBeInTheDocument()
  })

  it('renders sign-in button', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
  })

  it('calls signInWithGoogle when button is clicked', async () => {
    const mockSignIn = vi.fn().mockResolvedValue({})
    useAuth.mockReturnValue({ user: null, signInWithGoogle: mockSignIn })

    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))

    expect(mockSignIn).toHaveBeenCalledOnce()
  })

  it('does not crash if signInWithGoogle rejects', async () => {
    const mockSignIn = vi.fn().mockRejectedValue(new Error('popup closed'))
    useAuth.mockReturnValue({ user: null, signInWithGoogle: mockSignIn })

    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))

    // Should not throw — error is caught internally
    await vi.waitFor(() => expect(mockSignIn).toHaveBeenCalled())
  })
})
