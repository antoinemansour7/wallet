import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AccountDetailModal from './AccountDetailModal'

const account = {
  accountNumber: 'TFSA',
  cash: 125,
  positions: [],
  stats: { totalMarketValue: 125 },
}

describe('AccountDetailModal motion', () => {
  it('keeps the confirmation available after a failed removal', async () => {
    const onRemoveAccount = vi.fn().mockResolvedValue(false)
    render(<AccountDetailModal open account={account} onClose={vi.fn()} onRemoveAccount={onRemoveAccount} error="Please try again." />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))
    await waitFor(() => expect(onRemoveAccount).toHaveBeenCalledWith('TFSA'))
    expect(screen.getByRole('heading', { name: 'Remove this account?' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Please try again.')
  })
  it('keeps the removed account visible while the modal closes', () => {
    const { rerender } = render(
      <AccountDetailModal open account={account} onClose={vi.fn()} />,
    )

    rerender(
      <AccountDetailModal open={false} account={null} onClose={vi.fn()} />,
    )

    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('data-state', 'closing')
    expect(screen.getByText('Account TFSA')).toBeInTheDocument()
  })

  it('animates the inline remove confirmation into the sheet', () => {
    render(<AccountDetailModal open account={account} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))
    expect(screen.getByRole('heading', { name: 'Remove this account?' }).closest('.modal-step')).toHaveClass('modal-step')
  })

  it('can close a confirmed removal after the account leaves the portfolio', () => {
    const sibling = { ...account, accountNumber: 'RRSP' }
    const { rerender } = render(<AccountDetailModal open account={account} accounts={[account, sibling]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))
    expect(() => rerender(<AccountDetailModal open={false} account={null} accounts={[sibling]} onClose={vi.fn()} />)).not.toThrow()
    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('data-state', 'closing')
  })
})
