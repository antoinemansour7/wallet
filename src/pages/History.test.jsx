import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import History from './History'

vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('reveals fetched history and shows exact returns when quotes arrive', async () => {
  let finishQuotes
  vi.stubGlobal('fetch', vi.fn((url) => url.includes('history=1')
    ? Promise.resolve({ json: async () => ({ entries: [{ date: '2025-01-02', picks: [{ ticker: 'NVDA', price: 100, conviction: 8, reason: 'Illustrative thesis' }] }] }) })
    : new Promise((resolve) => { finishQuotes = resolve })))
  render(<History />)
  await screen.findByText('NVDA')
  expect(screen.queryByText('+12.3%')).not.toBeInTheDocument()
  await waitFor(() => expect(finishQuotes).toBeTypeOf('function'))
  await act(async () => finishQuotes({ json: async () => ({ quotes: [{ symbol: 'NVDA', price: 112.3 }] }) }))
  expect(screen.getAllByText('+12.3%')).toHaveLength(3)
  expect(screen.getByText('100%')).toBeInTheDocument()
  await waitFor(() => expect(screen.getAllByText('+12.3%').some((node) => node.classList.contains('motion-value-change'))).toBe(true))
})
