import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { coverageSnapshotFrom, recordCoverageSnapshot, dateKeyFor } from './researchCoverageStore.js'

describe('coverageSnapshotFrom', () => {
  it('counts signals and articles together, since both are coverage', () => {
    const snapshot = coverageSnapshotFrom([
      { ticker: 'RKLB', signalCount: 4, articleCount: 2 },
      { ticker: 'IREN', signalCount: 1, articleCount: 0 },
    ])
    expect(snapshot).toEqual({ RKLB: 6, IREN: 1 })
  })

  it('does not clamp — the whole point is measuring how far the count moved', () => {
    const snapshot = coverageSnapshotFrom([{ ticker: 'HOT', signalCount: 31, articleCount: 9 }])
    expect(snapshot.HOT).toBe(40)
  })

  it('normalizes tickers and survives missing or malformed counts', () => {
    const snapshot = coverageSnapshotFrom([
      { ticker: ' rklb ', signalCount: 2 },
      { ticker: 'BAD', signalCount: null, articleCount: undefined },
      { ticker: '', signalCount: 9 },
      { signalCount: 9 },
      null,
    ])
    expect(snapshot).toEqual({ RKLB: 2, BAD: 0 })
  })

  it('sums a ticker that appears more than once rather than losing one', () => {
    const snapshot = coverageSnapshotFrom([
      { ticker: 'RKLB', signalCount: 2, articleCount: 0 },
      { ticker: 'RKLB', signalCount: 3, articleCount: 1 },
    ])
    expect(snapshot.RKLB).toBe(6)
  })

  it('treats negative counts as zero rather than subtracting coverage', () => {
    expect(coverageSnapshotFrom([{ ticker: 'ODD', signalCount: -5, articleCount: 2 }]).ODD).toBe(2)
  })
})

describe('recordCoverageSnapshot', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses to record a run where discovery was degraded', async () => {
    // A failed feed makes every ticker look quiet. Stored as though it were
    // real, the next run reads a market-wide collapse in attention that never
    // happened — so an unmeasured day is left absent, not written as zero.
    const board = [{ ticker: 'RKLB', signalCount: 1, articleCount: 0 }]
    await expect(recordCoverageSnapshot(board, { healthy: false })).resolves.toBeNull()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not recording coverage'))
  })

  it('returns null without Redis configured instead of throwing', async () => {
    const board = [{ ticker: 'RKLB', signalCount: 1, articleCount: 0 }]
    await expect(recordCoverageSnapshot(board, { healthy: true })).resolves.toBeNull()
  })
})

describe('dateKeyFor', () => {
  it('keys by UTC calendar day', () => {
    expect(dateKeyFor(new Date('2026-09-05T23:59:00Z'))).toBe('2026-09-05')
    expect(dateKeyFor(new Date('2026-09-06T00:01:00Z'))).toBe('2026-09-06')
  })
})
