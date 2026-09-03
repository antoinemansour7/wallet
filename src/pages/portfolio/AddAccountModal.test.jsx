import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AddAccountModal from './AddAccountModal'

// Renders PlaidLinkButton, which since #53 goes through plaidClient.js's
// callPlaid() for an auth token — that pulls in firebase/config, which
// initializes real Firebase Auth at import time. CI has no Firebase API key
// to give it, so this throws there even though a real local .env masks it.
vi.mock('../../firebase/config', () => ({
  auth: { currentUser: null },
  db: {},
}))

describe('AddAccountModal motion', () => {
  it('animates the next step when an add method is chosen', () => {
    render(
      <AddAccountModal
        open
        onClose={vi.fn()}
        inputRef={createRef()}
        onFile={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Import a statement/ }))
    expect(screen.getByText('Drop a file').closest('.modal-step')).toBeInTheDocument()
  })
})
