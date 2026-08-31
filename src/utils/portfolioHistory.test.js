import { describe, expect, it, vi, beforeEach } from 'vitest'

const firestoreMocks = vi.hoisted(() => ({
  getDocs: vi.fn(),
  setDoc: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: firestoreMocks.getDocs,
  setDoc: firestoreMocks.setDoc,
}))

vi.mock('../firebase/config', () => ({ db: {} }))

import {
  loadHistory,
  mergeHistory,
  saveDailySnapshot,
  loadLocalHistory,
  recordIntradayPoint,
  loadIntradayPoints,
} from './portfolioHistory'

function permissionDenied() {
  const err = new Error('Missing or insufficient permissions.')
  err.code = 'permission-denied'
  return err
}

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
})

beforeEach(() => {
  store.clear()
  firestoreMocks.getDocs.mockReset()
  firestoreMocks.setDoc.mockReset()
})

describe('mergeHistory', () => {
  it('dedupes by date with remote winning, sorted ascending', () => {
    const local = [
      { date: '2026-06-01', marketValue: 100 },
      { date: '2026-06-03', marketValue: 300 },
    ]
    const remote = [
      { date: '2026-06-01', marketValue: 110 },
      { date: '2026-06-02', marketValue: 200 },
    ]

    const merged = mergeHistory(remote, local)

    expect(merged.map((d) => d.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
    expect(merged[0].marketValue).toBe(110)
  })
})

describe('saveDailySnapshot', () => {
  it('keeps a device-local copy even when the Firestore write is denied', async () => {
    firestoreMocks.setDoc.mockRejectedValue(permissionDenied())

    await saveDailySnapshot('uid-1', { totalMarketValue: 5000, totalBookValue: 4000, totalPnl: 1000 })

    const local = loadLocalHistory()
    expect(local).toHaveLength(1)
    expect(local[0].marketValue).toBe(5000)
  })
})

describe('loadHistory', () => {
  it('falls back to device-local history when the Firestore read is denied', async () => {
    firestoreMocks.setDoc.mockRejectedValue(permissionDenied())
    firestoreMocks.getDocs.mockRejectedValue(permissionDenied())
    await saveDailySnapshot('uid-1', { totalMarketValue: 5000, totalBookValue: 4000, totalPnl: 1000 })

    const history = await loadHistory('uid-1')

    expect(history).toHaveLength(1)
    expect(history[0].marketValue).toBe(5000)
  })

  it('records intraday points and throttles rapid successive writes', () => {
    recordIntradayPoint({ totalMarketValue: 5000 })
    recordIntradayPoint({ totalMarketValue: 5010 }) // within 2-min gap — dropped

    expect(loadIntradayPoints()).toHaveLength(1)
    expect(loadIntradayPoints()[0].marketValue).toBe(5000)
  })

  it('ignores intraday points from a previous day', () => {
    store.set('wallai:intraday-history', JSON.stringify({
      date: '2020-01-01',
      points: [{ ts: 1577836800000, marketValue: 1000 }],
    }))

    expect(loadIntradayPoints()).toEqual([])
  })

  it('merges remote and local history when both are available', async () => {
    firestoreMocks.setDoc.mockResolvedValue()
    firestoreMocks.getDocs.mockResolvedValue({
      docs: [{ data: () => ({ date: '2026-05-30', marketValue: 4200 }) }],
    })
    await saveDailySnapshot('uid-1', { totalMarketValue: 5000, totalBookValue: 4000, totalPnl: 1000 })

    const history = await loadHistory('uid-1')

    expect(history.map((d) => d.date)).toContain('2026-05-30')
    expect(history).toHaveLength(2)
  })
})
