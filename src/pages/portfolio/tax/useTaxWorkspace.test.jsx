import { beforeEach, describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import useTaxWorkspace from './useTaxWorkspace'
import { loadTaxSettings, saveTaxSettings } from './taxStorage'
vi.mock('./taxStorage', () => ({ loadTaxSettings: vi.fn(), saveTaxSettings: vi.fn() }))
import { loadTransactions, loadHistoryStarts } from '../../../utils/transactionStore'
import { fetchSecurityReference } from '../../../utils/securityReference'
import { callPlaid } from '../../../utils/plaidClient'
vi.mock('../../../utils/transactionStore', () => ({ loadTransactions: vi.fn(), loadHistoryStarts: vi.fn() }))
vi.mock('../../../utils/securityReference', async (original) => ({ ...await original(), fetchSecurityReference: vi.fn() }))
vi.mock('../../../utils/plaidClient', () => ({ callPlaid: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  loadTransactions.mockResolvedValue([])
  loadHistoryStarts.mockResolvedValue({})
  fetchSecurityReference.mockResolvedValue({ MSFT: { exchange: 'NMS' } })
})

describe('tax workspace persistence', () => {
  it('ignores an earlier user’s delayed response when the signed-in user changes', async () => {
    let resolveFirst
    loadTaxSettings.mockImplementation((uid) => uid === 'first' ? new Promise((resolve) => { resolveFirst = resolve }) : Promise.resolve({ yieldPct: 2 }))
    const { result, rerender } = renderHook(({ uid }) => useTaxWorkspace(uid, false), { initialProps: { uid: 'first' } })
    rerender({ uid: 'second' })
    await waitFor(() => expect(result.current.settings.yieldPct).toBe(2))
    await act(async () => resolveFirst({ yieldPct: 99 }))
    expect(result.current.settings.yieldPct).toBe(2)
  })
  it('retains saved settings on a write failure and shares ledger data with the account sheet', async () => {
    loadTaxSettings.mockResolvedValue({ yieldPct: 1.3 })
    loadTransactions.mockResolvedValue([{ id: 'record' }])
    saveTaxSettings.mockRejectedValueOnce(new Error('offline'))
    const { result, rerender } = renderHook(({ enabled }) => useTaxWorkspace('owner', enabled), { initialProps: { enabled: false } })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const readsBefore = loadTransactions.mock.calls.length
    await act(async () => { expect(await result.current.update({ yieldPct: 2 })).toBe(false) })
    expect(result.current.settings.yieldPct).toBe(1.3)
    expect(result.current.error).toContain('Couldn’t save')
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.ledger.transactions).toHaveLength(1))
    expect(loadTransactions.mock.calls.length).toBe(readsBefore)
    expect(saveTaxSettings).toHaveBeenCalledWith('owner', { yieldPct: 2 })
  })
  it('prevents a failed settings read from overwriting existing figures', async () => {
    loadTaxSettings.mockRejectedValueOnce(new Error('unavailable'))
    const { result } = renderHook(() => useTaxWorkspace('owner', false))
    await waitFor(() => expect(result.current.loadFailed).toBe(true))
    const writesBefore = saveTaxSettings.mock.calls.length
    await act(async () => { expect(await result.current.update({ yieldPct: 3 })).toBe(false) })
    expect(saveTaxSettings.mock.calls.length).toBe(writesBefore)
  })
  it('resolves references and history metadata, then refreshes after a scoped manual sync', async () => {
    loadTaxSettings.mockResolvedValue({})
    loadHistoryStarts.mockResolvedValue({ plaid: '2024-01-01' })
    callPlaid.mockResolvedValue({ ok: true, json: async () => ({ written: 10, fetched: 10, errors: [{ message: 'reconnect' }] }) })
    const accounts = [{ positions: [{ SYMBOL: 'MSFT' }] }]
    const { result } = renderHook(() => useTaxWorkspace('owner', true, accounts))
    await waitFor(() => expect(result.current.referenceLoading).toBe(false))
    expect(result.current.data.reference.MSFT.exchange).toBe('NMS')
    await waitFor(() => expect(result.current.ledger.historyStarts.plaid).toBe('2024-01-01'))
    await act(async () => result.current.sync())
    expect(callPlaid).toHaveBeenCalledWith({ action: 'sync-transactions' })
    expect(result.current.syncState.error).toContain('1 connection(s)')
    await waitFor(() => expect(loadTransactions).toHaveBeenCalledTimes(2))
  })
  it('exposes read errors and suppresses capped ledger calculations', async () => {
    loadTaxSettings.mockResolvedValue({})
    loadTransactions.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useTaxWorkspace('owner', true))
    await waitFor(() => expect(result.current.ledger.error).toContain('couldn’t be loaded'))
    loadTransactions.mockResolvedValue(Array.from({ length: 2000 }, (_, i) => ({ id: String(i) })))
    await act(async () => result.current.retry())
    await waitFor(() => expect(result.current.ledger.limited).toBe(true))
    expect(result.current.data.transactions).toEqual([])
  })

})
