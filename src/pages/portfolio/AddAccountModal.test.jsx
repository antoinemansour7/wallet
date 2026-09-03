import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AddAccountModal from './AddAccountModal'

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
