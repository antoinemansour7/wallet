import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { coverageSnapshotFrom, recordCoverageSnapshot, loadSeenDocuments, dateKeyFor } from './researchCoverageStore.js'

describe('coverageSnapshotFrom', () => {
  it('counts each document once, on the day it is first seen', () => {
    // The run window (30h of posts, 48h of articles) is longer than the 24h gap
    // between runs, so consecutive runs re-see the same documents. Counting
    // them again would difference two overlapping trailing windows and call the
    // result a daily change.
    const board = [{ ticker: 'RKLB', documentKeys: ['a.com/1', 'b.com/2', 'c.com/3'] }]
    const seenDocuments = new Set(['a.com/1', 'b.com/2'])

    expect(coverageSnapshotFrom(board, { seenDocuments }).counts).toEqual({ RKLB: 1 })
  })

  it('counts every document on a first run, when nothing has been seen', () => {
    const board = [{ ticker: 'RKLB', documentKeys: ['a.com/1', 'b.com/2', 'c.com/3'] }]
    expect(coverageSnapshotFrom(board).counts).toEqual({ RKLB: 3 })
  })

  it('stores every document seen today, not only the fresh ones', () => {
    // Tomorrow has to know a document existed today even though today did not
    // count it, or it would be counted as new twice.
    const board = [{ ticker: 'RKLB', documentKeys: ['old', 'new'] }]
    const snapshot = coverageSnapshotFrom(board, { seenDocuments: new Set(['old']) })

    expect(snapshot.counts.RKLB).toBe(1)
    expect(snapshot.documents.sort()).toEqual(['new', 'old'])
  })

  it('does not clamp — the whole point is measuring how far the count moved', () => {
    const board = [{ ticker: 'HOT', documentKeys: Array.from({ length: 40 }, (_, i) => `doc-${i}`) }]
    expect(coverageSnapshotFrom(board).counts.HOT).toBe(40)
  })

  it('falls back to raw counts when an item carries no document keys', () => {
    // Reporting zero would look exactly like a fade. Callers that rank a board
    // without the store attached still get a usable, if trailing, number.
    const snapshot = coverageSnapshotFrom([{ ticker: 'RKLB', signalCount: 4, articleCount: 2 }])
    expect(snapshot.counts.RKLB).toBe(6)
  })

  it('normalizes tickers and survives missing or malformed input', () => {
    const snapshot = coverageSnapshotFrom([
      { ticker: ' rklb ', documentKeys: ['x'] },
      { ticker: 'BAD', signalCount: null, articleCount: undefined },
      { ticker: '', documentKeys: ['y'] },
      { documentKeys: ['z'] },
      null,
    ])
    expect(snapshot.counts).toEqual({ RKLB: 1, BAD: 0 })
  })

  it('does not double-count one document shared by two tickers on the same day', () => {
    // A single article naming both names is one document for the ledger, but
    // real coverage for each ticker.
    const board = [
      { ticker: 'RKLB', documentKeys: ['shared'] },
      { ticker: 'IREN', documentKeys: ['shared'] },
    ]
    const snapshot = coverageSnapshotFrom(board)

    expect(snapshot.counts).toEqual({ RKLB: 1, IREN: 1 })
    expect(snapshot.documents).toEqual(['shared'])
  })

  it('treats negative fallback counts as zero rather than subtracting coverage', () => {
    expect(coverageSnapshotFrom([{ ticker: 'ODD', signalCount: -5, articleCount: 2 }]).counts.ODD).toBe(2)
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
    const board = [{ ticker: 'RKLB', documentKeys: ['a'] }]
    await expect(recordCoverageSnapshot(board, { healthy: false })).resolves.toBeNull()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not recording coverage'))
  })

  it('returns null without Redis configured instead of throwing', async () => {
    const board = [{ ticker: 'RKLB', documentKeys: ['a'] }]
    await expect(recordCoverageSnapshot(board, { healthy: true })).resolves.toBeNull()
  })
})

describe('loadSeenDocuments', () => {
  it('returns an empty set without Redis, so a first run counts everything', async () => {
    await expect(loadSeenDocuments()).resolves.toEqual(new Set())
  })
})

describe('dateKeyFor', () => {
  it('keys by UTC calendar day', () => {
    expect(dateKeyFor(new Date('2026-09-05T23:59:00Z'))).toBe('2026-09-05')
    expect(dateKeyFor(new Date('2026-09-06T00:01:00Z'))).toBe('2026-09-06')
  })
})
