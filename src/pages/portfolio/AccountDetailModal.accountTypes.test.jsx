import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AccountsView from './AccountsView'
import AccountDetailModal from './AccountDetailModal'
import useTaxWorkspace from './tax/useTaxWorkspace'
import { loadTaxSettings, saveTaxSettings } from './tax/taxStorage'

vi.mock('./tax/taxStorage', () => ({ loadTaxSettings: vi.fn(), saveTaxSettings: vi.fn() }))
vi.mock('../../utils/transactionStore', () => ({ loadTransactions: vi.fn(async () => []), loadHistoryStarts: vi.fn(async () => ({})) }))
vi.mock('../../utils/securityReference', async (original) => ({
  ...await original(),
  fetchSecurityReference: vi.fn(async () => ({ MSFT: { exchange: 'NMS', yieldPct: 2, isFund: false } })),
}))

const importedAccount = (type = 'TFSA') => ({
  accountNumber: '68BB39Q', currency: 'USD', cash: 125,
  positions: [{ SYMBOL: 'MSFT', DESCRIPTION: 'Microsoft', 'MARKET VALUE': 10000, 'ACCOUNT CURRENCY': 'USD', 'ACCOUNT TYPE': type, __plaidAccountId: 'plaid-id' }],
})

function AccountsWorkspace({ account = importedAccount() }) {
  const workspace = useTaxWorkspace('owner', false, [account])
  const [open, setOpen] = useState(false)
  return <>
    <AccountsView accounts={[account]} taxSettings={workspace.settings} onOpenAccount={() => setOpen(true)} />
    <AccountDetailModal open={open} account={account} onClose={() => setOpen(false)}
      taxSettings={workspace.settings} taxData={workspace.data} onUpdateTaxSettings={workspace.update}
      taxSettingsDisabled={workspace.loading || workspace.saving || workspace.loadFailed} taxSettingsError={workspace.error} />
  </>
}

const openAccount = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Manage account 68BB39Q' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Account type' })).toBeEnabled())
  return screen.getByRole('combobox', { name: 'Account type' })
}

let persisted
beforeEach(() => {
  vi.clearAllMocks()
  persisted = { accountTypes: { sibling: 'FHSA' }, yieldPct: 2 }
  loadTaxSettings.mockImplementation(async () => structuredClone(persisted))
  saveTaxSettings.mockImplementation(async (_uid, settings) => { persisted = structuredClone(settings) })
})

describe('account registration settings', () => {
  it('prefills from Plaid and offers exactly the requested registration types without saving the guess', async () => {
    render(<AccountsWorkspace />)
    const select = await openAccount()
    expect(select).toHaveValue('TFSA')
    expect(within(select).getAllByRole('option').map((option) => [option.value, option.textContent])).toEqual([
      ['TFSA', 'TFSA'], ['FHSA', 'FHSA'], ['RRSP', 'RRSP'], ['RRSP_SPOUSAL', 'Spousal RRSP'],
      ['RRIF', 'RRIF'], ['LIRA', 'LIRA'], ['LIF', 'LIF'], ['LRIF', 'LRIF'], ['RESP', 'RESP'],
      ['RDSP', 'RDSP'], ['NON_REGISTERED', 'Non-registered'], ['UNKNOWN', 'Unknown'],
    ])
    expect(saveTaxSettings).not.toHaveBeenCalled()
  })

  it('saves an override, updates withholding in the open sheet, and retains it after refresh and a fresh import', async () => {
    const view = render(<AccountsWorkspace />)
    const select = await openAccount()
    await waitFor(() => expect(screen.getByRole('region', { name: 'Account withholding' })).toHaveTextContent('$30.00'))
    fireEvent.change(select, { target: { value: 'RRSP' } })
    await waitFor(() => expect(select).toHaveValue('RRSP'))
    expect(saveTaxSettings).toHaveBeenCalledWith('owner', { accountTypes: { sibling: 'FHSA', '68BB39Q': 'RRSP' }, yieldPct: 2 })
    expect(screen.getByRole('region', { name: 'Account withholding' })).toHaveTextContent('$0.00')
    expect(within(screen.getByRole('button', { name: 'Manage account 68BB39Q' })).getByRole('heading')).toHaveTextContent('RRSP')

    view.rerender(<AccountsWorkspace account={importedAccount('Non-Registered')} />)
    expect(select).toHaveValue('RRSP')
    expect(screen.getByRole('region', { name: 'Account withholding' })).toHaveTextContent('$0.00')
    view.unmount()
    render(<AccountsWorkspace account={importedAccount('TFSA')} />)
    expect(await openAccount()).toHaveValue('RRSP')
    await waitFor(() => expect(screen.getByRole('region', { name: 'Account withholding' })).toHaveTextContent('$0.00'))
  })

  it('stores Unknown and keeps withholding unestimated after refresh even with an imported type', async () => {
    const view = render(<AccountsWorkspace />)
    fireEvent.change(await openAccount(), { target: { value: 'UNKNOWN' } })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Account type' })).toHaveValue('UNKNOWN'))
    expect(persisted.accountTypes['68BB39Q']).toBe('UNKNOWN')
    expect(screen.getByRole('region', { name: 'Account withholding' })).toHaveTextContent('Not estimated')
    view.unmount()
    render(<AccountsWorkspace />)
    expect(await openAccount()).toHaveValue('UNKNOWN')
    expect(screen.getByRole('region', { name: 'Account withholding' })).toHaveTextContent('Add the account’s registration type')
  })

  it('defaults an unclassified account to Unknown', async () => {
    render(<AccountsWorkspace account={importedAccount('')} />)
    expect(await openAccount()).toHaveValue('UNKNOWN')
    expect(saveTaxSettings).not.toHaveBeenCalled()
  })

  it('disables editing during save and preserves the saved type when a write fails', async () => {
    let rejectSave
    saveTaxSettings.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject }))
    render(<AccountsWorkspace />)
    const select = await openAccount()
    fireEvent.change(select, { target: { value: 'RRSP' } })
    expect(select).toBeDisabled()
    await act(async () => rejectSave(new Error('offline')))
    expect(select).toBeEnabled()
    expect(select).toHaveValue('TFSA')
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save your changes')
    fireEvent.change(select, { target: { value: 'RRSP' } })
    await waitFor(() => expect(select).toHaveValue('RRSP'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('prevents editing before settings load and after a failed read', async () => {
    let rejectLoad
    loadTaxSettings.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLoad = reject }))
    render(<AccountsWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage account 68BB39Q' }))
    expect(screen.getByRole('combobox', { name: 'Account type' })).toBeDisabled()
    await act(async () => rejectLoad(new Error('offline')))
    expect(screen.getByRole('combobox', { name: 'Account type' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Tax settings couldn’t be loaded')
    expect(saveTaxSettings).not.toHaveBeenCalled()
  })
})
