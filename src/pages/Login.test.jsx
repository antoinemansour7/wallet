import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Login from './Login'

// Only useAuth is mocked. getAuthErrorMessage stays real — the point of these
// tests is that a raw Firebase code never reaches the screen, and a mocked
// mapper would assert nothing about that. It lives in its own module precisely
// so importing it here does not drag in firebase/config, which calls getAuth()
// at load time and throws wherever the keys are absent.
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn() }
})

import { useAuth } from '../context/AuthContext'

function mockAuth(overrides = {}) {
  const value = {
    user: null,
    signInWithGoogle: vi.fn().mockResolvedValue({}),
    signInWithEmail: vi.fn().mockResolvedValue({}),
    signUpWithEmail: vi.fn().mockResolvedValue({}),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  useAuth.mockReturnValue(value)
  return value
}

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  )
}

const emailField = () => screen.getByLabelText(/email/i)
const passwordField = () => screen.getByLabelText(/^password$/i)

describe('Login page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth()
  })

  it('renders brand name', () => {
    renderLogin()
    // The brand is split across spans — "Wall" plus a gradient "AI" — so it has
    // to be matched on combined text rather than as one string.
    const spellsBrand = (el) => el?.tagName === 'SPAN' && el.textContent === 'WallAI'

    expect(
      screen.getByText((_, el) => spellsBrand(el) && ![...el.children].some(spellsBrand)),
    ).toBeInTheDocument()
  })

  it('renders the Google button alongside the email form', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
    expect(emailField()).toBeInTheDocument()
    expect(passwordField()).toBeInTheDocument()
  })

  it('calls signInWithGoogle when the Google button is clicked', () => {
    const { signInWithGoogle } = mockAuth()
    renderLogin()

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))

    expect(signInWithGoogle).toHaveBeenCalledOnce()
  })

  it('does not crash if signInWithGoogle rejects', async () => {
    const signInWithGoogle = vi.fn().mockRejectedValue(new Error('popup closed'))
    mockAuth({ signInWithGoogle })
    renderLogin()

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))

    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalled())
  })

  describe('sign-in state', () => {
    it('submits the typed credentials', async () => {
      const { signInWithEmail } = mockAuth()
      renderLogin()

      fireEvent.change(emailField(), { target: { value: 'a@b.com' } })
      fireEvent.change(passwordField(), { target: { value: 'secret1' } })
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

      await waitFor(() => expect(signInWithEmail).toHaveBeenCalledWith('a@b.com', 'secret1'))
    })

    it('marks the password field for autofill as an existing password', () => {
      renderLogin()
      expect(passwordField()).toHaveAttribute('autocomplete', 'current-password')
      expect(emailField()).toHaveAttribute('autocomplete', 'email')
    })

    it('shows a neutral sentence rather than a raw Firebase code when sign-in fails', async () => {
      mockAuth({ signInWithEmail: vi.fn().mockRejectedValue({ code: 'auth/invalid-credential' }) })
      renderLogin()

      fireEvent.change(emailField(), { target: { value: 'a@b.com' } })
      fireEvent.change(passwordField(), { target: { value: 'wrong' } })
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Incorrect email or password.')
      expect(alert).not.toHaveTextContent(/auth\//)
    })
  })

  describe('sign-up state', () => {
    const switchToSignUp = () => fireEvent.click(screen.getByRole('button', { name: /create an account/i }))

    it('swaps the card in place without navigating', () => {
      renderLogin()
      switchToSignUp()

      expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^create account$/i })).toHaveAttribute('type', 'submit')
      // "Sign in" still exists, but only as the way back — it must no longer be
      // the thing that submits the form.
      expect(screen.getByRole('button', { name: /^sign in$/i })).toHaveAttribute('type', 'button')
    })

    it('submits through signUpWithEmail', async () => {
      const { signUpWithEmail } = mockAuth()
      renderLogin()
      switchToSignUp()

      fireEvent.change(emailField(), { target: { value: 'new@b.com' } })
      fireEvent.change(passwordField(), { target: { value: 'secret1' } })
      fireEvent.click(screen.getByRole('button', { name: /^create account$/i }))

      await waitFor(() => expect(signUpWithEmail).toHaveBeenCalledWith('new@b.com', 'secret1'))
    })

    it('asks autofill for a new password, not the saved one', () => {
      renderLogin()
      switchToSignUp()
      expect(passwordField()).toHaveAttribute('autocomplete', 'new-password')
    })

    it('keeps the typed email but clears the password when switching', () => {
      renderLogin()
      fireEvent.change(emailField(), { target: { value: 'a@b.com' } })
      fireEvent.change(passwordField(), { target: { value: 'secret1' } })

      switchToSignUp()

      expect(emailField()).toHaveValue('a@b.com')
      expect(passwordField()).toHaveValue('')
    })

    it('explains a taken address without naming the other provider', async () => {
      mockAuth({ signUpWithEmail: vi.fn().mockRejectedValue({ code: 'auth/email-already-in-use' }) })
      renderLogin()
      switchToSignUp()

      fireEvent.change(emailField(), { target: { value: 'taken@b.com' } })
      fireEvent.change(passwordField(), { target: { value: 'secret1' } })
      fireEvent.click(screen.getByRole('button', { name: /^create account$/i }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('An account with this email already exists. Try signing in instead.')
      expect(alert).not.toHaveTextContent(/google/i)
    })

    it('offers no password reset while signing up', () => {
      renderLogin()
      switchToSignUp()
      expect(screen.queryByRole('button', { name: /forgot password/i })).not.toBeInTheDocument()
    })
  })

  describe('password reveal', () => {
    it('starts masked and toggles to visible', () => {
      renderLogin()
      expect(passwordField()).toHaveAttribute('type', 'password')

      fireEvent.click(screen.getByRole('button', { name: /show password/i }))
      expect(passwordField()).toHaveAttribute('type', 'text')

      fireEvent.click(screen.getByRole('button', { name: /hide password/i }))
      expect(passwordField()).toHaveAttribute('type', 'password')
    })
  })

  describe('forgot password', () => {
    it('sends a reset for the typed address and confirms neutrally', async () => {
      const { resetPassword } = mockAuth()
      renderLogin()

      fireEvent.change(emailField(), { target: { value: 'a@b.com' } })
      fireEvent.click(screen.getByRole('button', { name: /forgot password/i }))

      await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('a@b.com'))
      // Neutral on purpose — confirming the address exists would enumerate users.
      expect(await screen.findByRole('status')).toHaveTextContent(/if that address has an account/i)
    })

    it('asks for an address instead of sending an empty reset', () => {
      const { resetPassword } = mockAuth()
      renderLogin()

      fireEvent.click(screen.getByRole('button', { name: /forgot password/i }))

      expect(resetPassword).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent(/enter your email address first/i)
    })
  })
})
