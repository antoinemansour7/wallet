// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  values: new Map(),
  redis: {
    get: vi.fn(async (key) => mocks.values.get(key) ?? null),
    set: vi.fn(async () => 'OK'),
  },
}))

vi.mock('@upstash/redis', () => ({
  Redis: class Redis {
    constructor() { return mocks.redis }
  },
}))

import { fetchBreakoutCandidates } from './technicalScreener.js'

beforeEach(() => {
  process.env.TECHNICAL_SCREENER_PROVIDER = 'finviz'
  mocks.values.clear()
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })))
})
afterEach(() => {
  delete process.env.TECHNICAL_SCREENER_PROVIDER
  vi.unstubAllGlobals()
})

describe('Finviz failure handling', () => {
  it('stops after the broad probes when the provider blocks Vercel', async () => {
    await expect(fetchBreakoutCandidates()).rejects.toThrow('Finviz unavailable')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('uses the last known good screen instead of erasing the screener signal', async () => {
    mocks.values.set('screener:breakout-candidates:last-good', [
      { ticker: 'MU', setupType: 'breakout', source: 'finviz-screener' },
    ])

    await expect(fetchBreakoutCandidates()).resolves.toEqual([
      { ticker: 'MU', setupType: 'breakout', source: 'finviz-screener' },
    ])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
