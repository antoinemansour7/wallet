import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CompositionPanel from './CompositionPanel'
vi.mock('../../components/CompanyLogo', () => ({ default: () => <span aria-hidden="true" /> }))
const rows = Array.from({ length: 11 }, (_, index) => ({ SYMBOL: `H${index}`, DESCRIPTION: `Holding ${index}`, 'ACCOUNT NUMBER': 'A', 'ACCOUNT CURRENCY': 'CAD', 'MARKET VALUE': (11 - index) * 100, 'BOOK VALUE': 500, QUANTITY: 10, 'DAY CHANGE': index }))

describe('CompositionPanel', () => {
  it('sorts the visible holdings and expands the full list', () => {
    render(<CompositionPanel rows={rows} />)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('button', { name: /View H\d+ details/ })).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'Sort by total return' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sort by total return' }))
    expect(within(table).getAllByRole('button', { name: /View H\d+ details/ })[0]).toHaveAccessibleName('View H10 details')
    expect(screen.getByRole('button', { name: 'Sort by total return' }).closest('th')).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(screen.getByRole('button', { name: 'View all 11 holdings' }))
    expect(within(table).getAllByRole('button', { name: /View H\d+ details/ })).toHaveLength(11)
  })
  it('reveals cost, daily return, and account context for a holding', () => {
    render(<CompositionPanel rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: 'View H0 details' }))
    expect(screen.getByText('Average cost / share')).toBeInTheDocument()
    expect(screen.getByText('Held in account')).toBeInTheDocument()
    expect(screen.getByText('$50.00')).toBeInTheDocument()
  })
  it('keeps currencies separate and lets the user switch scope', () => {
    render(<CompositionPanel rows={[rows[0], { ...rows[1], SYMBOL: 'US', 'ACCOUNT CURRENCY': 'USD' }]} />)
    expect(screen.queryByRole('button', { name: 'View US details' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Holdings currency'), { target: { value: 'USD' } })
    expect(screen.getByRole('button', { name: 'View US details' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View H0 details' })).not.toBeInTheDocument()
  })
})
