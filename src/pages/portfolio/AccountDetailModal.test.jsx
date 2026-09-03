import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AccountDetailModal from './AccountDetailModal'

const account = {
  accountNumber: 'TFSA',
  cash: 125,
  positions: [],
  stats: { totalMarketValue: 125 },
}

describe('AccountDetailModal motion', () => {
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
    expect(screen.getByText(/Deletes account TFSA/).parentElement).toHaveClass('modal-step')
  })
})
