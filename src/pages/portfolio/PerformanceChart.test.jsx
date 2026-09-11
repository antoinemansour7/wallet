import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'chart-user' } }) }))
vi.mock('../../utils/portfolioHistory', () => ({
  loadHistory: async () => [],
  loadIntradayPoints: () => [],
}))

import PerformanceChart, { withLiveEndpoint } from './PerformanceChart.jsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const endpoint = {
  isSameSlot: () => true,
  create: (marketValue) => ({ ts: 3, marketValue }),
}

describe('withLiveEndpoint', () => {
  it('keeps the last valid intraday bar while the current valuation is settling', () => {
    const points = [{ ts: 1, marketValue: 1000 }, { ts: 2, marketValue: 1010 }]

    expect(withLiveEndpoint(points, 200, endpoint, false)).toEqual(points)
  })

  it('accepts a sharp move once the current valuation is trustworthy', () => {
    const points = [{ ts: 1, marketValue: 1000 }, { ts: 2, marketValue: 1010 }]

    expect(withLiveEndpoint(points, 200, endpoint, true)).toEqual([
      points[0], { ts: 2, marketValue: 200 },
    ])
  })
})

it('reconstructs the chart again when cash changes with the same holdings', async () => {
  const requests = []
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ series: [] }) }
  }))
  const rows = [{ SYMBOL: 'ABC', QUANTITY: '10', 'MARKET VALUE': '1000' }]
  const { rerender } = render(
    <PerformanceChart rows={rows} stats={{ totalMarketValue: 1100, totalCashValue: 100 }} valuationReady />,
  )
  await waitFor(() => expect(requests.filter((request) => request.cashValue === 100)).toHaveLength(2))

  await act(async () => {
    rerender(<PerformanceChart rows={rows} stats={{ totalMarketValue: 1200, totalCashValue: 200 }} valuationReady />)
  })

  await waitFor(() => expect(requests.filter((request) => request.cashValue === 200)).toHaveLength(2))
  expect(requests.filter((request) => request.cashValue === 200).map((request) => Boolean(request.intraday)).sort()).toEqual([false, true])
})
