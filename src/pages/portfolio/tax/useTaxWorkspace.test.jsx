import { describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import useTaxWorkspace from './useTaxWorkspace'
import { loadTaxSettings, loadTaxTransactions, saveTaxSettings } from './taxStorage'
vi.mock('./taxStorage', () => ({ loadTaxSettings: vi.fn(), loadTaxTransactions: vi.fn(), saveTaxSettings: vi.fn() }))

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
  it('retains saved settings on a write failure and loads transactions only on Tax', async () => {
    loadTaxSettings.mockResolvedValue({ yieldPct: 1.3 })
    loadTaxTransactions.mockResolvedValue({ transactions: [{ id: 'record' }], limited: false })
    saveTaxSettings.mockRejectedValueOnce(new Error('offline'))
    const { result, rerender } = renderHook(({ enabled }) => useTaxWorkspace('owner', enabled), { initialProps: { enabled: false } })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const readsBefore = loadTaxTransactions.mock.calls.length
    await act(async () => { expect(await result.current.update({ yieldPct: 2 })).toBe(false) })
    expect(result.current.settings.yieldPct).toBe(1.3)
    expect(result.current.error).toContain('Couldn’t save')
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.ledger.transactions).toHaveLength(1))
    expect(loadTaxTransactions.mock.calls.length).toBe(readsBefore + 1)
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
})
