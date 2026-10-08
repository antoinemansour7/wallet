import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { computeStats } from '../../utils/portfolioStats'
import HoldingsView from './HoldingsView'

vi.mock('../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../firebase/config', () => ({ auth: { currentUser: null }, db: {} }))
const position = (symbol, name, value) => ({ SYMBOL: symbol, DESCRIPTION: name, 'MARKET VALUE': value, QUANTITY: 1 })
const account = (accountNumber, positions, cash = 0) => ({ accountNumber, positions, cash, currency: 'CAD', stats: computeStats(positions, { cashValue: cash }) })
const accounts = [account('TFSA', [position('MSFT', 'Microsoft', 200), position('AAPL', 'Apple', 100)], 50), account('RRSP', [position('MSFT', 'Microsoft', 400)]), account('CASH', [], 75)]
const rows = accounts.flatMap((a) => a.positions)
const renderHoldings = () => render(<HoldingsView rows={rows} accounts={accounts} />)

describe('Finding holdings', () => {
  it('combines case-insensitive company search with account filtering without changing totals', () => {
    renderHoldings()
    fireEvent.change(screen.getByLabelText('Search holdings'), { target: { value: ' MICROsoft ' } })
    expect(screen.getAllByText('MSFT')).toHaveLength(2)
    expect(screen.queryByText('AAPL')).not.toBeInTheDocument()
    expect(screen.queryByText('Cash')).not.toBeInTheDocument()
    expect(screen.getByText('$350.00')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'TFSA' } })
    expect(screen.getAllByText('MSFT')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3 positions match')
    expect(screen.queryByText('Account RRSP')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('AAPL')).toBeVisible()
    expect(screen.getByText('Account CASH')).toBeVisible()
  })

  it('sorts within accounts and keeps an expanded holding attached to its ticker', () => {
    renderHoldings()
    const tickerOrder = () => screen.getAllByRole('button', { expanded: false }).map((button) => button.textContent)
    expect(tickerOrder()[0]).toContain('MSFT')
    fireEvent.click(screen.getAllByRole('button', { name: /MSFT/ })[0])
    fireEvent.change(screen.getByLabelText('Sort within accounts'), { target: { value: 'symbol' } })
    expect(screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-expanded'))[0]).toHaveTextContent('AAPL')
    expect(screen.getByRole('button', { expanded: true })).toHaveTextContent('MSFT')
    expect(accounts[0].positions[0].SYMBOL).toBe('MSFT')
  })

  it('shows a recoverable empty search and includes cash when explicitly searched', () => {
    renderHoldings()
    fireEvent.change(screen.getByLabelText('Search holdings'), { target: { value: 'not-a-ticker' } })
    expect(screen.getByText('No matching holdings')).toBeVisible()
    expect(screen.queryByText('Account TFSA')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search holdings'), { target: { value: 'cash' } })
    expect(screen.getAllByText('Cash')).toHaveLength(2)
    expect(screen.queryByText('No matching holdings')).not.toBeInTheDocument()
    expect(screen.queryByText('MSFT')).not.toBeInTheDocument()
  })

  it('recovers when a selected account is removed by a portfolio update', () => {
    const { rerender } = renderHoldings()
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'RRSP' } })
    rerender(<HoldingsView accounts={[accounts[0]]} rows={accounts[0].positions} />)
    expect(screen.getByLabelText('Account')).toHaveValue('')
    expect(screen.getByText('AAPL')).toBeVisible()
  })
})
