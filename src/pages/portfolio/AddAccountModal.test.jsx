import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

  it('announces real loading text and prevents dismissal until processing finishes', () => {
    const onClose = vi.fn()
    render(<AddAccountModal open initialMode="file" loading loadingMsg="Reading statement.csv…" onClose={onClose} inputRef={createRef()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Reading statement.csv…')
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('No holdings are added until you confirm the review.')).toBeVisible()
  })

  it('shows Save only while saving, recovers from failure, and marks completion after success', () => {
    const pending = { kind: 'file', name: 'statement.csv', rows: [], cashEntries: [], knownAccounts: [{ accountNumber: 'TFSA', positions: 0, value: 0 }] }
    const onConfirm = vi.fn()
    const props = { open: true, inputRef: createRef(), onClose: vi.fn(), onConfirm, pending }
    const { rerender } = render(<AddAccountModal {...props} busy />)
    const current = () => within(screen.getByRole('list', { name: 'Add account progress' })).getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'step')
    expect(current()).toHaveTextContent('Save')
    expect(screen.getByRole('status')).toHaveTextContent('Saving your reviewed accounts…')
    fireEvent.click(screen.getByRole('button', { name: 'Adding accounts…' }))
    expect(onConfirm).not.toHaveBeenCalled()
    rerender(<AddAccountModal {...props} error="Save failed. Try again." />)
    expect(current()).toHaveTextContent('Review')
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed')
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 account' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    rerender(<AddAccountModal {...props} pending={null} completed={{ kind: 'file', count: 1, name: 'statement.csv' }} />)
    expect(current()).toBeUndefined()
    expect(screen.getByRole('status')).toHaveTextContent('Your accounts have been saved.')
    expect(within(screen.getByRole('list', { name: 'Add account progress' })).getAllByRole('listitem')).toHaveLength(3)
  })
})
