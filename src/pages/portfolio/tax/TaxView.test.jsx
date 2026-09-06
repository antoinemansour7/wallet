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
    expect(screen.getByRole('heading', { name: 'Contribution room' })).toBeInTheDocument()
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
  it('starts with a focused summary and opens one planning tool at a time', () => {
    render(<TaxView accounts={accounts} workspace={workspace()} />)
    expect(screen.getByRole('region', { name: 'FX conversion cost summary' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Contribution room' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Compare account types' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'After a sale' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Portfolio withholding summary' })).toHaveTextContent('$19.50')
    fireEvent.click(screen.getByRole('tab', { name: 'Planning' }))
    expect(screen.getByRole('heading', { name: 'Compare account types' })).toBeVisible()
    fireEvent.change(screen.getByLabelText(/Illustration over/), { target: { value: '20' } })
    expect(screen.getByText('$390.00')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Currency conversion', exact: true }))
    expect(screen.getByRole('heading', { name: 'Currency conversion' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Compare account types' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Account comparison' }))
    expect(screen.getByRole('slider')).toHaveValue('20')
  })
  it('does not describe a zero-yield TFSA as treaty exempt anywhere on the page', () => {
    // The by-account table that carried this label is gone (#139). The rule it
    // guarded is asserted directly on projectWithholding now; this keeps the
    // weaker guarantee that no surface reintroduces the claim.
    render(<TaxView accounts={[accounts[0]]} workspace={workspace({ settings: { yieldPct: 0 } })} />)
    expect(screen.getByRole('tabpanel', { name: 'Summary' })).not.toHaveTextContent('Treaty-exempt')
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
    expect(screen.getByRole('region', { name: 'Annual fund fee summary' })).toHaveTextContent('$3.00')
    expect(screen.queryByRole('heading', { name: 'Fund fee breakdown' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View breakdown' }))
    expect(screen.getByRole('heading', { name: 'Fund fee breakdown' })).toBeVisible()
    expect(document.querySelector('#tax-fees')).toHaveTextContent('$3.00')
    expect(document.querySelector('#tax-fees')).toHaveTextContent('Expense ratio unavailable: OTHER')
  })
  it('no longer offers a registration control on the Tax page', () => {
    // The control moves to Accounts (#136's sibling issue). Asserting its
    // absence keeps that move honest: if it reappears here it exists twice,
    // and two controls over one setting can disagree.
    render(<TaxView accounts={[...accounts, { accountNumber: 'unknown', currency: 'USD', positions: [{ SYMBOL: 'MSFT' }] }]} workspace={workspace()} />)
    expect(screen.queryByLabelText('Registration for unknown')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('tab', { name: 'Sales' }))
    expect(screen.getByRole('heading', { name: 'After a sale' })).toBeVisible()
    expect(document.querySelector('#tax-sales')).toHaveTextContent('$1,650.00')
    expect(document.querySelector('#tax-sales')).toHaveTextContent('Holding would be worth more')
    expect(document.querySelector('#tax-sales')).toHaveTextContent('derived from the transaction pool')
    expect(document.querySelector('#tax-sales')).toHaveTextContent('Excludes reinvestment of the sale proceeds')
    rerender(<TaxView accounts={accounts} workspace={{ ...state, prices: { quotes: { MSFT: { price: 50, currency: 'USD' } }, usdCadRate: 1.5 } }} />)
    expect(document.querySelector('#tax-sales')).toHaveTextContent('Selling was worth more')
  })
  it('supports keyboard navigation and preserves a contribution draft between views', () => {
    render(<TaxView accounts={accounts} workspace={workspace()} />)
    fireEvent.click(screen.getAllByRole('button', { name: /Add room/ })[0])
    fireEvent.change(screen.getByLabelText(/TFSA available room \(CAD\)/), { target: { value: '7300' } })
    const summary = screen.getByRole('tab', { name: 'Summary' })
    summary.focus()
    fireEvent.keyDown(summary, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Planning' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Planning' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Planning' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Sales' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Sales' }), { key: 'Home' })
    expect(summary).toHaveFocus()
    expect(screen.getByLabelText(/TFSA available room \(CAD\)/)).toHaveValue(7300)
  })

})

describe('FX conversion costs card (#139)', () => {
  // A CAD leg and a USD leg on the same day are one conversion.
  const conversion = (day, cad, usd, rate = 1.34) => ([
    { id: `fx-cad-${day}`, accountId: 'a1', action: 'FX', tradeDate: `2026-0${day}-01`, amountMinor: cad, currency: 'CAD', quantity: 0 },
    { id: `fx-usd-${day}`, accountId: 'a1', action: 'FX', tradeDate: `2026-0${day}-01`, amountMinor: usd, currency: 'USD', quantity: 0, fxRate: rate },
  ])
  const withLedger = (transactions) => workspace({ data: { reference, transactions } })
  const card = () => screen.getByRole('region', { name: 'FX conversion cost summary' })

  it('always reports itself as measured, never as an estimate', () => {
    // It reports only what the ledger can prove happened, which is a different
    // kind of number from the two cards beside it.
    render(<TaxView accounts={accounts} workspace={withLedger(conversion(7, 500000, 366300))} />)
    // The badge specifically. The body copy does say "Estimated FX spread",
    // which is the issue's own wording — what must never appear is the badge
    // that would file this alongside the two projected figures.
    const badges = [...card().querySelectorAll('.tax-badge')].map((b) => b.textContent)
    expect(badges).toContain('Measured')
    expect(badges).not.toContain('Estimate')
    expect(badges).not.toContain('Annual estimate')
  })

  it('counts a single conversion in the singular', () => {
    render(<TaxView accounts={accounts} workspace={withLedger(conversion(7, 500000, 366300))} />)
    expect(card()).toHaveTextContent('1 measured conversion')
    expect(card()).not.toHaveTextContent('1 measured conversions')
  })

  it('counts several', () => {
    render(<TaxView accounts={accounts} workspace={withLedger([
      ...conversion(5, 500000, 366300), ...conversion(6, 400000, 295000), ...conversion(7, 300000, 221000),
    ])} />)
    expect(card()).toHaveTextContent('3 measured conversions')
  })

  it('says nothing was recorded when the ledger holds no USD activity at all', () => {
    // Claiming USD purchases exist when none do explains something that never
    // happened.
    render(<TaxView accounts={accounts} workspace={withLedger([])} />)
    expect(card()).toHaveTextContent('No conversions recorded')
    expect(card()).not.toHaveTextContent('We found USD purchases')
  })

  it('explains the gap when USD activity exists but cannot be priced', () => {
    render(<TaxView accounts={accounts} workspace={withLedger([
      { id: 'buy', accountId: 'a1', action: 'BUY', tradeDate: '2026-07-01', amountMinor: 91856, currency: 'USD', quantity: 8, priceMinor: 11482, symbol: 'MSFT' },
    ])} />)
    expect(card()).toHaveTextContent('We found USD purchases')
  })

  it('offers a route to the conversions rather than only a number', () => {
    render(<TaxView accounts={accounts} workspace={withLedger(conversion(7, 500000, 366300))} />)
    fireEvent.click(within(card()).getByRole('button', { name: /View conversions/ }))
    expect(screen.getByRole('heading', { name: 'Currency conversion' })).toBeVisible()
  })
})
