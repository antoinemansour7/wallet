import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { localTaxDate } from './taxModel'
import TaxView, { TaxOverviewPointer, AccountTaxSection } from './TaxView'
import TabNav from '../TabNav'

const accounts = ['TFSA', 'RRSP'].map((type, index) => ({ accountNumber: type, currency: 'USD', positions: [{ SYMBOL: 'MSFT', DESCRIPTION: 'Microsoft Corporation', 'ACCOUNT CURRENCY': 'USD', CURRENCY: 'USD', 'ACCOUNT TYPE': type, 'MARKET VALUE': 10000 + index * 1000 }] }))
const reference = { MSFT: { exchange: 'NMS', yieldPct: 1.3, isFund: false } }
const workspace = (overrides = {}) => ({ settings: {}, data: { reference }, loading: false, saving: false, update: vi.fn().mockResolvedValue(true), ledger: { transactions: [], loading: false, error: '', limited: false }, ...overrides })

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
    render(<AccountTaxSection account={accounts[0]} data={{ reference }} onOpenTax={onOpenTax} />)
    expect(screen.getByRole('region', { name: 'Account withholding' })).toHaveTextContent('$19.50')
    fireEvent.click(screen.getByRole('button', { name: /Compare on the Tax page/ }))
    expect(onOpenTax).toHaveBeenCalledOnce()
  })
})

describe('Tax page interactions', () => {
  it('shows all sections and updates the comparison period', () => {
    render(<TaxView accounts={accounts} workspace={workspace()} />)
    for (const name of ['Where withholding happens', 'Same holding. Different account.', 'Room to contribute', 'What does converting cost?', 'The cost of your funds', 'After a sale']) expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Portfolio withholding summary' })).toHaveTextContent('$19.50')
    fireEvent.change(screen.getByLabelText(/Illustration over/), { target: { value: '20' } })
    expect(screen.getByText('$390.00')).toBeInTheDocument()
    expect(screen.getByText('No funds identified')).toBeInTheDocument()
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
    fireEvent.change(screen.getByLabelText(/TFSA available room \(CAD\)/), { target: { value: '10000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save figures' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith({ room: { TFSA: { limitMinor: 1000000, asOf: current } } }))
    rerender(<TaxView accounts={accounts} workspace={workspace({ settings: { room: { TFSA: { limitMinor: 1000000, asOf: current } } } })} />)
    fireEvent.change(screen.getByLabelText('Check a planned TFSA contribution (CAD)'), { target: { value: '10500' } })
    expect(screen.getByRole('status')).toHaveTextContent('$500.00 above the room you recorded')
  })
  it('keeps failed saves editable and never hides ledger errors behind a zero fee', async () => {
    const state = workspace({ update: vi.fn().mockResolvedValue(false), ledger: { transactions: [], error: 'Transaction history couldn’t be loaded.', loading: false } })
    render(<TaxView accounts={accounts} workspace={state} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Transaction history couldn’t be loaded')
    fireEvent.click(screen.getAllByRole('button', { name: /Add room/ })[0])
    fireEvent.change(screen.getByLabelText(/TFSA available room \(CAD\)/), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save figures' }))
    await waitFor(() => expect(state.update).toHaveBeenCalled())
    expect(screen.getByLabelText(/TFSA available room \(CAD\)/)).toHaveValue(100)
  })
  it('shows fund fees even with an empty ledger and names missing expense ratios', () => {
    const funds = [{ ...accounts[0], positions: [
      { ...accounts[0].positions[0], SYMBOL: 'VTI', 'MARKET VALUE': 10000 },
      { ...accounts[0].positions[0], SYMBOL: 'OTHER', 'MARKET VALUE': 5000 },
    ] }]
    render(<TaxView accounts={funds} workspace={workspace({ data: { reference: { VTI: { exchange: 'PCX', isFund: true, expenseRatioPct: 0.03 }, OTHER: { exchange: 'PCX', isFund: true } } } })} />)
    expect(document.querySelector('#tax-fees')).toHaveTextContent('$3.00')
    expect(document.querySelector('#tax-fees')).toHaveTextContent('Expense ratio unavailable: OTHER')
  })
  it('keeps imported registration read-only and permits unknown registration to be set', () => {
    render(<TaxView accounts={[...accounts, { accountNumber: 'unknown', currency: 'USD', positions: [{ SYMBOL: 'MSFT' }] }]} workspace={workspace({ settings: { accountTypes: { TFSA: 'RRSP' } } })} />)
    expect(screen.queryByLabelText('Registration for TFSA')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Registration for unknown')).toBeEnabled()
    expect(screen.getByRole('table').querySelector('tbody tr .tax-badge')).toHaveTextContent('TFSA')
  })
  it('hides stale contribution numbers and any planned-excess warning', () => {
    const prior = `${new Date().getFullYear() - 1}-01-01`
    render(<TaxView accounts={accounts} workspace={workspace({ settings: { room: { TFSA: { limitMinor: 1000, asOf: prior } } } })} />)
    expect(screen.getByText('Needs an update')).toBeInTheDocument()
    expect(screen.queryByLabelText('Check a planned TFSA contribution (CAD)')).not.toBeInTheDocument()
    expect(screen.getByText('TFSA withdrawal and re-contribution adjustments are excluded.')).toBeInTheDocument()
  })
  it('shows complete disposals and keeps provenance and reinvestment exclusions with their figures', () => {
    const base = { accountId: 'plaid', accountType: 'NON_REGISTERED', securityKey: 'isin:msft', securityKeyBasis: 'isin', symbol: 'MSFT', feesMinor: 0, currency: 'USD', fxRate: 1.4 }
    const state = workspace({ ledger: { transactions: [
      { ...base, id: 'buy', action: 'BUY', quantity: 10, amountMinor: 80000, tradeDate: '2025-01-01' },
      { ...base, id: 'sell', action: 'SELL', quantity: -10, amountMinor: 100000, tradeDate: '2026-01-01' },
    ], historyStarts: { plaid: '2024-01-01' }, loading: false }, prices: { quotes: { MSFT: { price: 110, currency: 'USD' } }, usdCadRate: 1.5 } })
    const { rerender } = render(<TaxView accounts={accounts} workspace={state} />)
    expect(document.querySelector('#tax-sales')).toHaveTextContent('$1,650.00')
    expect(document.querySelector('#tax-sales')).toHaveTextContent('Holding would be worth more')
    expect(document.querySelector('#tax-sales')).toHaveTextContent('derived from the transaction pool')
    expect(document.querySelector('#tax-sales')).toHaveTextContent('Excludes reinvestment of the sale proceeds')
    rerender(<TaxView accounts={accounts} workspace={{ ...state, prices: { quotes: { MSFT: { price: 50, currency: 'USD' } }, usdCadRate: 1.5 } }} />)
    expect(document.querySelector('#tax-sales')).toHaveTextContent('Selling was worth more')
  })
})
