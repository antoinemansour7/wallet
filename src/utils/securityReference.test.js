import { describe, it, expect, vi } from 'vitest'
import { fetchSecurityReference, symbolsToResolve, EMPTY_REFERENCE } from './securityReference'

const ok = (securities) => vi.fn(async () => ({ ok: true, json: async () => ({ securities }) }))

describe('symbolsToResolve', () => {
  it('uniques and upper-cases the symbols a set of holdings needs', () => {
    expect(symbolsToResolve([{ SYMBOL: 'vfv' }, { SYMBOL: 'VFV' }, { SYMBOL: ' xeqt ' }, {}])).toEqual(['VFV', 'XEQT'])
  })
})

describe('fetchSecurityReference', () => {
  it('returns the resolved records', async () => {
    const fetchImpl = ok({ VFV: { symbol: 'VFV', yieldPct: 1.1 } })
    await expect(fetchSecurityReference(['VFV'], { fetchImpl })).resolves.toEqual({ VFV: { symbol: 'VFV', yieldPct: 1.1 } })
  })

  it('asks for nothing when there is nothing to ask about', async () => {
    const fetchImpl = ok({})
    await expect(fetchSecurityReference([], { fetchImpl })).resolves.toBe(EMPTY_REFERENCE)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('degrades to an empty map on a failed or rejected lookup', async () => {
    // Every consumer treats a missing record as "use the assumption and say it
    // is one", so a failure lands on the behaviour that existed before this.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(fetchSecurityReference(['VFV'], { fetchImpl: vi.fn(async () => ({ ok: false })) })).resolves.toBe(EMPTY_REFERENCE)
    await expect(fetchSecurityReference(['VFV'], { fetchImpl: vi.fn(async () => { throw new Error('offline') }) })).resolves.toBe(EMPTY_REFERENCE)
    vi.restoreAllMocks()
  })
})
