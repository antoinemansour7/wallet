import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadLocalPortfolio: vi.fn(),
  loadSavedPortfolioWithTimeout: vi.fn(),
  savePortfolio: vi.fn(async () => {}),
  enrichRowsWithLivePrices: vi.fn(),
  recordIntradayPoint: vi.fn(),
  saveDailySnapshot: vi.fn(async () => {}),
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'portfolio-user' } }) }))
vi.mock('../firebase/config', () => ({ auth: {}, db: {}, googleProvider: {} }))
vi.mock('../utils/parseSpreadsheet', () => ({ parseSpreadsheet: vi.fn() }))
vi.mock('../utils/portfolioStorage', () => ({
  clearPortfolio: vi.fn(),
  loadLocalPortfolio: mocks.loadLocalPortfolio,
  loadSavedPortfolioWithTimeout: mocks.loadSavedPortfolioWithTimeout,
  savePortfolio: mocks.savePortfolio,
}))
vi.mock('../utils/livePrices', async (importOriginal) => ({
  ...await importOriginal(),
  enrichRowsWithLivePrices: mocks.enrichRowsWithLivePrices,
}))
vi.mock('../utils/portfolioHistory', () => ({
  recordIntradayPoint: mocks.recordIntradayPoint,
  saveDailySnapshot: mocks.saveDailySnapshot,
}))
vi.mock('../utils/plaidClient', () => ({ callPlaid: vi.fn() }))
vi.mock('./portfolio/tax/useTaxWorkspace', () => ({ default: () => ({ settings: {} }) }))
vi.mock('./portfolio/tax/TaxView', () => ({ default: () => null, TaxOverviewPointer: () => null }))
vi.mock('./portfolio/PerformanceChart', () => ({
  default: ({ stats, valuationReady }) => (
    <output data-testid="performance-chart" data-ready={String(valuationReady)}>
      {stats.totalMarketValue}
    </output>
  ),
}))
vi.mock('./portfolio/TabNav', () => ({ default: () => null }))
vi.mock('./portfolio/StatRail', () => ({ default: () => null }))
vi.mock('./portfolio/LiveBanner', () => ({ default: () => null }))
vi.mock('./portfolio/CompositionPanel', () => ({ default: () => null }))
vi.mock('./portfolio/ChartsView', () => ({ default: () => null }))
vi.mock('./portfolio/HoldingsView', () => ({ default: () => null }))
vi.mock('./portfolio/AccountsView', () => ({ default: () => null }))
vi.mock('./portfolio/AccountDetailModal', () => ({ default: () => null }))
vi.mock('./portfolio/AddAccountModal', () => ({ default: () => null }))
vi.mock('./portfolio/EmptyState', () => ({ default: () => null }))

import Portfolio from './Portfolio.jsx'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function row(symbol, marketValue) {
  return {
    'ACCOUNT NUMBER': 'A1',
    'ACCOUNT CURRENCY': 'CAD',
    SYMBOL: symbol,
    QUANTITY: '10',
    'MARKET PRICE': String(marketValue / 10),
    'MARKET VALUE': String(marketValue),
    'BOOK VALUE': String(marketValue),
  }
}

function saved(rows, { cash = 0, updatedAt = '2026-09-11T12:00:00Z' } = {}) {
  return {
    rows,
    fileName: 'portfolio.csv',
    updatedAt,
    accounts: {
      A1: { accountNumber: 'A1', currency: 'CAD', positions: rows, cash, cashSource: 'explicit', realizedPnl: 0 },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => cleanup())

describe('portfolio valuation readiness', () => {
  it('does not publish local, remote, or cached startup totals before the complete live refresh', async () => {
    const remote = deferred()
    const live = deferred()
    mocks.loadLocalPortfolio.mockReturnValue(saved([row('ABC', 1000)], {
      cash: 100, updatedAt: '2026-09-11T10:00:00Z',
    }))
    mocks.loadSavedPortfolioWithTimeout.mockReturnValue(remote.promise)
    mocks.enrichRowsWithLivePrices.mockImplementation(async (rows, options) => {
      if (options?.cachedOnly) return { rows: [row('ABC', 1800)], updatedRows: 1, missing: [], errors: [] }
      return live.promise
    })

    render(<Portfolio />)

    expect(await screen.findByTestId('performance-chart')).toHaveAttribute('data-ready', 'false')
    expect(screen.getByTestId('performance-chart')).toHaveTextContent('1100')
    expect(mocks.recordIntradayPoint).not.toHaveBeenCalled()
    expect(mocks.saveDailySnapshot).not.toHaveBeenCalled()

    await act(async () => {
      remote.resolve(saved([row('ABC', 1500)], { cash: 200 }))
      await remote.promise
    })
    await waitFor(() => expect(mocks.enrichRowsWithLivePrices).toHaveBeenCalledWith(
      expect.any(Array), expect.objectContaining({ cachedOnly: true }),
    ))
    expect(screen.getByTestId('performance-chart')).toHaveAttribute('data-ready', 'false')
    expect(screen.getByTestId('performance-chart')).toHaveTextContent('2000')
    expect(mocks.recordIntradayPoint).not.toHaveBeenCalled()

    await act(async () => {
      live.resolve({ rows: [row('ABC', 2000)], updatedRows: 1, missing: [], errors: [] })
      await live.promise
    })
    await waitFor(() => expect(screen.getByTestId('performance-chart')).toHaveAttribute('data-ready', 'true'))
    expect(screen.getByTestId('performance-chart')).toHaveTextContent('2200')
    expect(mocks.recordIntradayPoint).toHaveBeenLastCalledWith(expect.objectContaining({ totalMarketValue: 2200 }))
    expect(mocks.saveDailySnapshot).toHaveBeenLastCalledWith('portfolio-user', expect.objectContaining({ totalMarketValue: 2200 }))
  })

  it('keeps a partial live refresh out of chart endpoints and persisted history', async () => {
    const remoteRows = [row('ABC', 1500), row('MISSING', 900)]
    mocks.loadLocalPortfolio.mockReturnValue(null)
    mocks.loadSavedPortfolioWithTimeout.mockResolvedValue(saved(remoteRows))
    mocks.enrichRowsWithLivePrices.mockImplementation(async (rows, options) => (
      options?.cachedOnly
        ? { rows, updatedRows: 2, missing: [], errors: [] }
        : { rows: [row('ABC', 1600), rows[1]], updatedRows: 1, missing: ['MISSING'], errors: [] }
    ))

    render(<Portfolio />)

    await waitFor(() => expect(mocks.enrichRowsWithLivePrices).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('performance-chart')).toHaveAttribute('data-ready', 'false')
    expect(mocks.recordIntradayPoint).not.toHaveBeenCalled()
    expect(mocks.saveDailySnapshot).not.toHaveBeenCalled()
  })
})
