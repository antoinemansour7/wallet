import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ChangedValue from './ChangedValue'

afterEach(() => vi.unstubAllGlobals())

describe('ChangedValue', () => {
  it('does not imply an update on first render, but marks a later change', () => {
    vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 1 })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const { rerender } = render(<ChangedValue value={10}>$10</ChangedValue>)
    expect(screen.getByText('$10')).not.toHaveClass('motion-value-change')

    rerender(<ChangedValue value={12}>$12</ChangedValue>)
    expect(screen.getByText('$12')).toHaveClass('motion-value-change')

    fireEvent.animationEnd(screen.getByText('$12'))
    expect(screen.getByText('$12')).not.toHaveClass('motion-value-change')
  })

  it('updates silently while feedback is disabled', () => {
    const { rerender } = render(<ChangedValue value={10}>$10</ChangedValue>)
    rerender(<ChangedValue value={12} enabled={false}>$12</ChangedValue>)
    expect(screen.getByText('$12')).not.toHaveClass('motion-value-change')
  })
})
