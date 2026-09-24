// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createArchive } from './archive.js'
import { archiveAttentionSignals } from './evidence.js'
import { memoryObjectStore, memoryRedis } from '../../test/memoryRedis.js'

const NOW = '2026-09-24T07:01:06.000Z'
const security = (ticker) => ({ securityId: `figi:${ticker}`, issuerId: `cik:${ticker}`, name: `${ticker} Corp`, ticker,
  currency: 'USD', exchange: 'XNAS', type: 'common_stock', countryOfListing: 'US' })
const master = { resolve: ({ ticker }) => (ticker === 'UNKNOWN' ? [] : [security(ticker)]) }
const signal = (id, tickers) => ({ id, tickers, text: `post ${id}`, createdAt: '2026-09-24T06:00:00.000Z', url: `https://x.com/p/${id}`, sourceType: 'x' })

// An R2 stand-in whose uploads take real time, so overlapping work is observable.
function slowStore({ failOn } = {}) {
  const store = memoryObjectStore()
  const stats = { inFlight: 0, peak: 0, started: 0 }
  return {
    stats,
    get: store.get,
    async putIfAbsent(key, bytes) {
      const sequence = ++stats.started
      stats.inFlight += 1
      stats.peak = Math.max(stats.peak, stats.inFlight)
      try {
        await new Promise((resolve) => setTimeout(resolve, 5))
        if (failOn && failOn(sequence)) throw new Error('Archive object PUT failed (503)')
        return await store.putIfAbsent(key, bytes)
      } finally { stats.inFlight -= 1 }
    },
  }
}

describe('archiveAttentionSignals', () => {
  it('archives items in parallel, bounded, and returns evidence in signal order', async () => {
    const store = slowStore()
    const archive = createArchive(memoryRedis(), { objectStore: store })
    const signals = Array.from({ length: 30 }, (_, i) => signal(`s${i}`, [`T${i}`]))
    const evidence = await archiveAttentionSignals(signals, master, archive, NOW)
    expect(evidence.map((item) => item.ticker)).toEqual(signals.map((item) => item.tickers[0]))
    expect(store.stats.peak).toBeGreaterThan(1)
    expect(store.stats.peak).toBeLessThanOrEqual(8)
    for (const item of evidence) expect(await archive.get('evidence', item.id)).toMatchObject({ id: item.id, strategyFamily: 'attention' })
  })

  it('archives one signal once per resolvable ticker, sharing its document bytes', async () => {
    const archive = createArchive(memoryRedis(), { objectStore: slowStore() })
    const evidence = await archiveAttentionSignals([signal('a', ['AAA', 'BBB', 'AAA', 'UNKNOWN'])], master, archive, NOW)
    expect(evidence.map((item) => item.ticker)).toEqual(['AAA', 'BBB'])
    expect(new Set(evidence.map((item) => item.source.documentId)).size).toBe(2)
  })

  it('stops starting new items after a failure and reports the first error', async () => {
    const store = slowStore({ failOn: (n) => n === 3 })
    const archive = createArchive(memoryRedis(), { objectStore: store })
    const signals = Array.from({ length: 200 }, (_, i) => signal(`s${i}`, [`T${i}`]))
    await expect(archiveAttentionSignals(signals, master, archive, NOW)).rejects.toThrow('Archive object PUT failed (503)')
    // Only the items already in flight when the upload failed may have started.
    expect(store.stats.started).toBeLessThan(40)
  })
})
