import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Modal from './Modal'

function Example({ open, onClose = vi.fn() }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="example-title">
      <h2 id="example-title">Example dialog</h2>
      <button type="button">Continue</button>
    </Modal>
  )
}

describe('Modal motion', () => {
  it('marks the backdrop and panel as opening', () => {
    render(<Example open />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-state', 'open')
    expect(dialog).toHaveClass('modal-panel')
    expect(document.querySelector('.modal-backdrop')).toHaveAttribute('data-state', 'open')
  })

  it('stays mounted for its closing animation, then leaves the portal', () => {
    const { rerender } = render(<Example open />)
    rerender(<Example open={false} />)

    const dialog = screen.getByRole('dialog', { hidden: true })
    expect(dialog).toHaveAttribute('data-state', 'closing')
    expect(dialog.parentElement).toHaveClass('pointer-events-none')

    fireEvent.animationEnd(dialog)
    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument()
  })

  it('opens after initially rendering closed and still closes with Escape', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Example open={false} onClose={onClose} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(<Example open onClose={onClose} />)
    expect(screen.getByRole('dialog')).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
