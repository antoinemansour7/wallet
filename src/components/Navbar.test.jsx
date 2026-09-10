import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Navbar from './Navbar'

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))
import { useAuth } from '../context/AuthContext'

const user = { uid: 'someone', displayName: 'Someone', email: 'someone@example.com', photoURL: null }

function renderNavbar(authOverrides = {}) {
  useAuth.mockReturnValue({ user, signOut: vi.fn(), isResearchOwner: false, ...authOverrides })
  return render(<MemoryRouter><Navbar /></MemoryRouter>)
}

function openAccountMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
}

afterEach(cleanup)

describe('account menu owner-only research links', () => {
  it('shows links to research logs and research evaluation, above sign out, only for the confirmed research owner', () => {
    renderNavbar({ isResearchOwner: true })
    openAccountMenu()

    const items = screen.getAllByRole('menuitem').map((el) => el.textContent)
    const signOutIndex = items.findIndex((t) => /Sign out/.test(t))
    expect(items.findIndex((t) => /Research logs/.test(t))).toBeLessThan(signOutIndex)
    expect(items.findIndex((t) => /Research evaluation/.test(t))).toBeLessThan(signOutIndex)
    expect(screen.getByRole('menuitem', { name: /Research logs/ })).toHaveAttribute('href', '/research/logs')
    expect(screen.getByRole('menuitem', { name: /Research evaluation/ })).toHaveAttribute('href', '/research/evaluation')
  })

  it('shows nothing research-related to a regular signed-in user', () => {
    renderNavbar({ isResearchOwner: false })
    openAccountMenu()

    expect(screen.queryByText(/Research logs/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Research evaluation/)).not.toBeInTheDocument()
  })
})
