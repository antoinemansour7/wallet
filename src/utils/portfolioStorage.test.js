import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { normalizeStoredPortfolio, loadLocalPortfolio, saveLocalPortfolio } from './portfolioStorage'

// Mock Firebase to avoid real Firestore calls
vi.mock('../firebase/config', () => ({
  db: {},
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
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
