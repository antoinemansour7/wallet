import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'chart-user' } }) }))
vi.mock('../../utils/portfolioHistory', () => ({
  loadHistory: async () => [],
  loadIntradayPoints: () => [],
}))

import PerformanceChart, { withLiveEndpoint } from './PerformanceChart.jsx'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-11T21:40:00-04:00'))
})

afterEach(() => {
  vi.useRealTimers()
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

const ts = (time) => Date.parse(`2026-09-11T${time}:00-04:00`)
const daily = [
  { date: '2026-09-10', marketValue: 58000 },
  { date: '2026-09-11', marketValue: 58580 },
]
const intraday = [
  { ts: ts('09:30'), marketValue: 59000 },
  { ts: ts('12:00'), marketValue: 57710 },
  { ts: ts('15:55'), marketValue: 58580 },
]
const chartRows = [{ SYMBOL: 'ABC', QUANTITY: '10', 'MARKET VALUE': '58000', __marketTime: ts('15:55') }]

function mockChartData(history = daily, bars = intraday) {
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({
    ok: true,
    json: async () => JSON.parse(options.body).intraday
      ? { series: bars, session: { start: ts('09:30'), end: ts('16:00') } }
      : { series: history },
  })))
}

it('uses previous close for today and its visual reference, even when down from the open', async () => {
  mockChartData()
  const { container } = render(<PerformanceChart rows={chartRows} stats={{ totalMarketValue: 58580 }} valuationReady />)
  expect(await screen.findByText('+$580.00 (+1.00%)')).toBeInTheDocument()
  expect(screen.getByText('$58,580.00')).toBeInTheDocument()
  expect(container.querySelector('path[fill="none"]')).toHaveAttribute('stroke', 'rgb(var(--color-gain))')
  const baseline = container.querySelector('[data-reference-value]')
  expect(baseline).toHaveAttribute('data-reference-value', '58000')
  expect(Number(baseline.getAttribute('y1'))).toBeGreaterThan(0)
  expect(Number(baseline.getAttribute('y1'))).toBeLessThan(180)
})

it('scrubs value, dollars, percent, color and timestamp against previous close, then restores current', async () => {
  mockChartData()
  const { container } = render(<PerformanceChart hero rows={chartRows} stats={{ totalMarketValue: 58580 }} valuationReady />)
  const chart = await screen.findByRole('slider')
  fireEvent.keyDown(chart, { key: 'ArrowLeft' })
  expect(screen.getByText('$57,710.00')).toBeInTheDocument()
  expect(screen.getByText('-$290.00 (-0.50%)')).toBeInTheDocument()
  expect(screen.getByText(/Sep 11, 2026 · 12:00 PM ET/)).toBeInTheDocument()
  expect(container.querySelector('path[fill="none"]')).toHaveAttribute('stroke', 'rgb(var(--color-loss))')
  fireEvent.pointerUp(chart)
  expect(screen.getByText('+$580.00 (+1.00%)')).toBeInTheDocument()
  expect(screen.getByText('today')).toBeInTheDocument()
  fireEvent.keyDown(chart, { key: 'Home' })
  expect(screen.getByText('+$1,000.00 (+1.72%)')).toBeInTheDocument()
  fireEvent.pointerLeave(chart)
  expect(screen.getByText('$58,580.00')).toBeInTheDocument()
})

it('keeps the last market timestamp and ignores an after-hours current value', async () => {
  mockChartData()
  render(<PerformanceChart rows={[{ ...chartRows[0], __marketTime: ts('21:40') }]} stats={{ totalMarketValue: 200 }} valuationReady />)
  const chart = await screen.findByRole('slider')
  expect(chart).toHaveAttribute('aria-valuemax', '2')
  expect(screen.getByText('3:55 PM')).toBeInTheDocument()
  expect(screen.queryByText('9:40 PM')).not.toBeInTheDocument()
  expect(screen.getByText('$58,580.00')).toBeInTheDocument()
})

it('shows valid live quotes only once valuationReady is true', async () => {
  mockChartData()
  const rows = [{ ...chartRows[0], __marketTime: ts('15:59') }]
  const { rerender } = render(<PerformanceChart rows={rows} stats={{ totalMarketValue: 200 }} valuationReady={false} />)
  await screen.findByRole('slider')
  expect(screen.getByText('$58,580.00')).toBeInTheDocument()
  expect(screen.queryByText('$200.00')).not.toBeInTheDocument()
  rerender(<PerformanceChart rows={rows} stats={{ totalMarketValue: 200 }} valuationReady />)
  expect(screen.getByText('$200.00')).toBeInTheDocument()
  expect(screen.getByText('3:59 PM')).toBeInTheDocument()
})

it('does not substitute the opening point when previous close is unavailable', async () => {
  mockChartData([daily[1]])
  const { container } = render(<PerformanceChart rows={chartRows} stats={{ totalMarketValue: 58580 }} valuationReady />)
  expect(await screen.findByText('Previous close unavailable')).toBeInTheDocument()
  expect(container.querySelector('[data-reference-value]')).toBeNull()
  expect(container.querySelector('path[fill="none"]')).toHaveAttribute('stroke', 'rgb(var(--color-ink) / 0.5)')
})

it.each(['1W', '1M', '3M', '6M', '1Y', 'All'])('preserves the %s comparison with the first range point', async (range) => {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  mockChartData([{ date: yesterday, marketValue: 50000 }, { date: today, marketValue: 58580 }])
  render(<PerformanceChart rows={chartRows} stats={{ totalMarketValue: 60000 }} valuationReady />)
  await screen.findByRole('slider')
  fireEvent.click(screen.getByRole('button', { name: range, exact: true }))
  expect(screen.getByText('+$10,000.00 (+20.00%)')).toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('slider'), { key: 'Home' })
  expect(screen.getByText('+$0.00 (+0.00%)')).toBeInTheDocument()
})

it('does not use an old portfolio response while a new cash reconstruction is pending', async () => {
  mockChartData()
  const { rerender, container } = render(<PerformanceChart rows={chartRows} stats={{ totalMarketValue: 58580, totalCashValue: 0 }} valuationReady />)
  await screen.findByText('+$580.00 (+1.00%)')
  const pending = []
  vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((resolve) => pending.push({ resolve, intraday: JSON.parse(options.body).intraday }))))
  rerender(<PerformanceChart rows={chartRows} stats={{ totalMarketValue: 200, totalCashValue: 100 }} valuationReady />)
  expect(container.querySelector('[data-reference-value]')).toBeNull()
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  await act(async () => {
    for (const request of pending) request.resolve({ ok: true, json: async () => ({ series: request.intraday ? intraday : daily.map((p) => ({ ...p, marketValue: p.marketValue + 100 })) }) })
  })
  expect(await screen.findByText('+$480.00 (+0.83%)')).toBeInTheDocument()
  expect(screen.getByText('$58,580.00')).toBeInTheDocument()
})
