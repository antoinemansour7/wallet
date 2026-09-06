import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { localTaxDate } from './taxModel'
import TaxView, { TaxOverviewPointer, AccountTaxSection } from './TaxView'
import TabNav from '../TabNav'

const accounts = ['TFSA', 'RRSP'].map((type, index) => ({ accountNumber: type, currency: 'USD', positions: [{ SYMBOL: 'MSFT', DESCRIPTION: 'Microsoft Corporation', 'ACCOUNT CURRENCY': 'USD', CURRENCY: 'USD', 'ACCOUNT TYPE': type, 'MARKET VALUE': 10000 + index * 1000 }] }))
const workspace = (overrides = {}) => ({ settings: {}, loading: false, saving: false, update: vi.fn().mockResolvedValue(true), ledger: { transactions: [], loading: false, error: '', limited: false }, ...overrides })

describe('Tax navigation and context', () => {
  it('puts Tax between Holdings and Accounts and opens it from the Overview pointer', () => {
    const onChange = vi.fn()
    render(<><TabNav activeView="tax" hasData onChange={onChange} /><TaxOverviewPointer accounts={accounts} settings={{}} onOpen={() => onChange('tax')} /></>)
    expect(within(screen.getByRole('navigation', { name: 'Portfolio views' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Overview', 'Charts', 'Holdings', 'Tax', 'Accounts'])
    expect(screen.getByRole('button', { name: 'Tax' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: /Explore tax/ }))
    expect(onChange).toHaveBeenCalledWith('tax')
  })
  it('allows contribution planning before any account is imported', () => {
    const onAdd = vi.fn()
    render(<><TabNav activeView="tax" hasData={false} onChange={vi.fn()} /><TaxView accounts={[]} workspace={workspace()} onAddAccount={onAdd} /></>)
    expect(screen.getByRole('button', { name: 'Tax', exact: true })).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Room to contribute' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    expect(onAdd).toHaveBeenCalledOnce()
  })
  it('retains the contextual withholding section and a route to the full page', () => {
    const onOpenTax = vi.fn()
    render(<AccountTaxSection account={accounts[0]} onOpenTax={onOpenTax} />)
    expect(screen.getByRole('region', { name: 'Account withholding' })).toHaveTextContent('$19.50')
    fireEvent.click(screen.getByRole('button', { name: /Compare on the Tax page/ }))
    expect(onOpenTax).toHaveBeenCalledOnce()
  })
})

describe('Tax page interactions', () => {
  it('shows all sections and updates the comparison period', () => {
    render(<TaxView accounts={accounts} workspace={workspace()} />)
    for (const name of ['Where withholding happens', 'Same holding. Different account.', 'Room to contribute', 'What does converting cost?', 'The cost of your accounts', 'After a sale']) expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Portfolio withholding summary' })).toHaveTextContent('$19.50')
    fireEvent.change(screen.getByLabelText(/Illustration over/), { target: { value: '20' } })
    expect(screen.getByText('$390.00')).toBeInTheDocument()
    expect(screen.getByText('No fee history available')).toBeInTheDocument()
  })
  it('does not label a zero-yield TFSA as treaty exempt', () => {
    render(<TaxView accounts={[accounts[0]]} workspace={workspace({ settings: { yieldPct: 0 } })} />)
    expect(screen.getByRole('table')).toHaveTextContent('Not recoverable')
    expect(screen.getByRole('table')).not.toHaveTextContent('Treaty-exempt')
  })
  it('saves room with its date and checks an excess against all contributions', async () => {
    const current = localTaxDate()
    const state = workspace()
    const { rerender } = render(<TaxView accounts={accounts} workspace={state} />)
    fireEvent.click(screen.getAllByRole('button', { name: /Add room/ })[0])
    fireEvent.change(screen.getByLabelText('TFSA available room (CAD)'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText(/Contributions since that date/), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save figures' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith({ room: { TFSA: { room: '10000', contributed: '1000', asOf: current } } }))
    rerender(<TaxView accounts={accounts} workspace={workspace({ settings: { room: { TFSA: { room: '10000', contributed: '1000', asOf: current } } } })} />)
    fireEvent.change(screen.getByLabelText('Check a planned TFSA contribution (CAD)'), { target: { value: '9500' } })
    expect(screen.getByRole('status')).toHaveTextContent('$500.00 above the room you recorded')
  })
  it('keeps failed saves editable and never hides ledger errors behind a zero fee', async () => {
    const state = workspace({ update: vi.fn().mockResolvedValue(false), ledger: { transactions: [], error: 'Transaction history couldn’t be loaded.', loading: false } })
    render(<TaxView accounts={accounts} workspace={state} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Transaction history couldn’t be loaded')
    fireEvent.click(screen.getAllByRole('button', { name: /Add room/ })[0])
    fireEvent.change(screen.getByLabelText('TFSA available room (CAD)'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save figures' }))
    await waitFor(() => expect(state.update).toHaveBeenCalled())
    expect(screen.getByLabelText('TFSA available room (CAD)')).toHaveValue(100)
  })
  it('compares an actual sale using an explicit price, showing either direction', () => {
    const state = workspace({ ledger: { transactions: [{ id: 'sale-1', action: 'SELL', symbol: 'MSFT', quantity: -10, priceMinor: 10000, currency: 'USD', tradeDate: '2026-04-01', feesMinor: 0 }], loading: false } })
    render(<TaxView accounts={accounts} workspace={state} />)
    const input = screen.getByLabelText('Comparison price per share (USD)')
    fireEvent.change(input, { target: { value: '110' } })
    expect(screen.getByText('Holding would be worth more')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '90' } })
    expect(screen.getByText('Selling avoided this price decline')).toBeInTheDocument()
  })
})
