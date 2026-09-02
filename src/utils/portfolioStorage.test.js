import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { setDoc, deleteDoc } from 'firebase/firestore'
import {
  normalizeStoredPortfolio, loadLocalPortfolio, saveLocalPortfolio,
  savePortfolio, clearPortfolio,
} from './portfolioStorage'

// Mock Firebase to avoid real Firestore calls
vi.mock('../firebase/config', () => ({
  db: {},
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(() => new Date()),
}))

describe('normalizeStoredPortfolio', () => {
  it('returns null for null/undefined input', () => {
    expect(normalizeStoredPortfolio(null)).toBeNull()
    expect(normalizeStoredPortfolio(undefined)).toBeNull()
  })

  it('normalizes a portfolio with rows', () => {
    const data = {
      fileName: 'test.csv',
      rows: [{ SYMBOL: 'AAPL', 'MARKET VALUE': '1500', 'ACCOUNT NUMBER': 'ACC1', 'ACCOUNT CURRENCY': 'CAD' }],
      uploadedAt: '2026-05-01T10:00:00Z',
    }

    const result = normalizeStoredPortfolio(data)

    expect(result.fileName).toBe('test.csv')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].SYMBOL).toBe('AAPL')
    expect(result.accounts).toBeDefined()
  })

  it('returns null when no rows and no accounts', () => {
    const result = normalizeStoredPortfolio({ rows: [], accounts: {} })
    expect(result).toBeNull()
  })

  it('converts Firestore timestamp in uploadedAt', () => {
    const data = {
      rows: [{ SYMBOL: 'X', 'ACCOUNT NUMBER': 'A', 'ACCOUNT CURRENCY': 'USD' }],
      uploadedAt: { toDate: () => new Date('2026-01-15T08:00:00Z') },
    }

    const result = normalizeStoredPortfolio(data)
    expect(result.uploadedAt).toBe('2026-01-15T08:00:00.000Z')
  })

  it('handles Date objects in date fields', () => {
    const data = {
      rows: [{ SYMBOL: 'Y', 'ACCOUNT NUMBER': 'B', 'ACCOUNT CURRENCY': 'CAD' }],
      updatedAt: new Date('2026-03-10T12:00:00Z'),
    }

    const result = normalizeStoredPortfolio(data)
    expect(result.updatedAt).toBe('2026-03-10T12:00:00.000Z')
  })
})

describe('loadLocalPortfolio / saveLocalPortfolio', () => {
  let mockStorage

  beforeEach(() => {
    mockStorage = {}
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key) => mockStorage[key] ?? null,
        setItem: (key, value) => { mockStorage[key] = value },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null for missing uid', () => {
    expect(loadLocalPortfolio(null)).toBeNull()
    expect(loadLocalPortfolio('')).toBeNull()
  })

  it('returns null when nothing is stored', () => {
    expect(loadLocalPortfolio('user123')).toBeNull()
  })

  it('saves and loads portfolio data round-trip', () => {
    const portfolio = {
      fileName: 'holdings.csv',
      rows: [{ SYMBOL: 'AAPL', 'ACCOUNT NUMBER': 'ACC1', 'ACCOUNT CURRENCY': 'USD', QUANTITY: '10', 'MARKET VALUE': '1500' }],
      accounts: {
        ACC1: { name: 'ACC1', currency: 'USD', positions: [{ SYMBOL: 'AAPL' }], cash: 0 },
      },
      updatedAt: '2026-05-20T10:00:00Z',
    }

    saveLocalPortfolio('user123', portfolio)
    const loaded = loadLocalPortfolio('user123')

    expect(loaded.fileName).toBe('holdings.csv')
    expect(loaded.rows[0].SYMBOL).toBe('AAPL')
  })

  it('does not save when uid is falsy', () => {
    saveLocalPortfolio(null, { rows: [{ SYMBOL: 'X' }] })
    expect(Object.keys(mockStorage)).toHaveLength(0)
  })

  it('returns null on invalid JSON in storage', () => {
    mockStorage['wallai:portfolio:user123'] = 'not json {'
    expect(loadLocalPortfolio('user123')).toBeNull()
  })
})

const account = (number, symbol) => ({
  accountNumber: number,
  currency: 'CAD',
  positions: [{
    'ACCOUNT NUMBER': number, SYMBOL: symbol, QUANTITY: '1', 'MARKET VALUE': '100',
  }],
  cash: 0,
  cashSource: 'none',
  realizedPnl: 0,
})

/** The accounts map as it was actually written to Firestore on the Nth save. */
const writtenAccounts = (call = 0) => Object.keys(setDoc.mock.calls[call][1].accounts)

describe('savePortfolio', () => {
  beforeEach(() => {
    setDoc.mockClear()
    deleteDoc.mockClear()
  })

  it('writes the document whole, never merged', () => {
    // Firestore deep-merges nested maps, so a merging write cannot express the
    // removal of an account: the key is simply absent, and merge keeps absent
    // keys. Removing an account then came back on the next load.
    savePortfolio('user1', { fileName: 'a.csv', rows: [], accounts: { A: account('A', 'AAPL') } })

    expect(setDoc).toHaveBeenCalledTimes(1)
    const [, , options] = setDoc.mock.calls[0]
    expect(options).toBeUndefined()
  })

  it('a removed account is left out, and cannot be merged back', () => {
    const both = { A: account('A', 'AAPL'), B: account('B', 'MSFT') }
    savePortfolio('user1', { fileName: 'a.csv', rows: [], accounts: both })

    const { B, ...withoutB } = both
    savePortfolio('user1', { fileName: 'a.csv', rows: [], accounts: withoutB })

    expect(writtenAccounts(0).sort()).toEqual(['A', 'B'])
    expect(writtenAccounts(1)).toEqual(['A'])
    // The payload alone proves nothing: merging happens on the server, so a
    // merging write carrying this exact payload would still leave B in the
    // document. The absent option is what makes the removal stick.
    expect(setDoc.mock.calls[1][2]).toBeUndefined()
  })

  it('refuses to write an empty portfolio, so a failed parse cannot wipe a good one', () => {
    savePortfolio('user1', { fileName: '', rows: [], accounts: {} })
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('writes nothing without a uid', () => {
    savePortfolio(null, { fileName: 'a.csv', rows: [], accounts: { A: account('A', 'AAPL') } })
    expect(setDoc).not.toHaveBeenCalled()
  })
})

describe('clearPortfolio', () => {
  let mockStorage

  beforeEach(() => {
    deleteDoc.mockClear()
    mockStorage = {}
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key) => mockStorage[key] ?? null,
        setItem: (key, value) => { mockStorage[key] = value },
        removeItem: (key) => { delete mockStorage[key] },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('empties both copies, because savePortfolio will not write an empty one', async () => {
    // Removing the last account is the one case where empty is intended, and it
    // has to survive a reload: leave the local copy behind and the next load
    // restores everything the person just removed.
    saveLocalPortfolio('user1', { rows: [], accounts: { A: account('A', 'AAPL') } })
    expect(loadLocalPortfolio('user1')).not.toBeNull()

    await clearPortfolio('user1')

    expect(loadLocalPortfolio('user1')).toBeNull()
    expect(deleteDoc).toHaveBeenCalledTimes(1)
  })
})
