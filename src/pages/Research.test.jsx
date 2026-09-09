import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'test' } }) }))
vi.mock('../utils/portfolioStorage', () => ({ loadLocalPortfolio: vi.fn(() => null) }))
vi.mock('../preview/mockMode', () => ({ IS_PREVIEW: false, PREVIEW_RESEARCH: null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => <span aria-hidden="true" /> }))
import { loadLocalPortfolio } from '../utils/portfolioStorage'
import Research from './Research.jsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); loadLocalPortfolio.mockReset(); loadLocalPortfolio.mockReturnValue(null) })

const pick = (ticker = 'VERIFIED', extra = {}) => ({ ticker, conviction: 7, price: 100, quoteVerified: true, reason: 'A specific thesis worth reviewing.', sources: ['finviz'], ...extra })
function mockResearch(picks, { data = {}, quotes = [], regime = null } = {}) {
  const fetchMock = vi.fn(async (url) => ({ ok: true, json: async () => url === '/api/get-research'
    ? { picks, generatedAt: '2026-06-12T13:00:00Z', signalCount: 50, articles: [], ...data }
    : url === '/api/market-regime' ? { regime } : { quotes } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('research briefing', () => {
  it('preserves the server ranking instead of sorting again by LLM conviction', async () => {
    mockResearch([pick('VERIFIED', { finalScore: 30 }), pick('HYPE', { conviction: 9, finalScore: 20 })])
    render(<Research />)
    const leading = await screen.findByRole('article', { name: 'VERIFIED' })
    expect(screen.getAllByRole('article').map((item) => item.getAttribute('aria-label'))).toEqual(['VERIFIED', 'HYPE'])
    expect(within(leading).getByLabelText('Rank 1')).toBeInTheDocument()
    expect(within(leading).getByRole('button', { name: 'Hide research for VERIFIED' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(leading).getByText('Why this one')).toBeInTheDocument()
  })

  it('preserves original ranks and all weaker ideas behind a labelled disclosure', async () => {
    mockResearch([pick('WEAK', { conviction: 5 }), pick('LEAD'), pick('LOW', { conviction: 4 })])
    render(<Research />)
    await screen.findByRole('article', { name: 'LEAD' })
    expect(screen.getByLabelText('Rank 2')).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'WEAK' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show 2 weaker ideas/ }))
    expect(screen.getAllByRole('article').map((item) => item.getAttribute('aria-label'))).toEqual(['LEAD', 'WEAK', 'LOW'])
    expect(within(screen.getByRole('article', { name: 'WEAK' })).getByLabelText('Rank 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Hide the weaker ideas/ }))
    expect(screen.queryByRole('article', { name: 'WEAK' })).not.toBeInTheDocument()
  })

  it('explains a completed empty scan and retains its source counts', async () => {
    mockResearch([], { data: { queryCount: 0, xBreakdown: { accountSignals: 0, searchSignals: 0 } } })
    render(<Research />)
    expect(await screen.findByText('No qualifying ideas this run')).toBeInTheDocument()
    expect(screen.queryByText('No picks yet')).not.toBeInTheDocument()
    expect(screen.getByText('Searches run')).toBeInTheDocument()
    expect(screen.getByText('Posts from traders we follow')).toBeInTheDocument()
  })

  it('distinguishes the first-run empty state from a fetch failure and supports retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = mockResearch([])
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 503 }))
    render(<Research />)
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load your briefing.')
    expect(screen.queryByText('No qualifying ideas this run')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No qualifying ideas this run')).toBeInTheDocument()
  })

  it('keeps research when market data is malformed and distinguishes no prior scan', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, json: async () => {
      if (url === '/api/market-regime') throw new Error('Invalid JSON')
      return { picks: [], generatedAt: null, articles: [] }
    } })))
    render(<Research />)
    expect(await screen.findByText('No picks yet')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/Market context is unavailable/)).toBeInTheDocument()
  })

  it('fetches all prices on arrival and every five minutes, preserves flat zero, and falls back honestly after failure', async () => {
    let refresh
    const nativeInterval = window.setInterval.bind(window)
    const interval = vi.spyOn(window, 'setInterval').mockImplementation((callback, delay) => {
      if (delay === 300000) { refresh = callback; return 123 }
      return nativeInterval(callback, delay)
    })
    const clear = vi.spyOn(window, 'clearInterval')
    const fetchMock = mockResearch([pick(), pick('WEAK', { conviction: 5 })], { quotes: [{ requestedSymbol: 'VERIFIED', price: 110, changePercent: 0 }] })
    const { unmount } = render(<Research />)
    expect(await screen.findByText('$110.00')).toBeInTheDocument()
    expect(screen.getByText('0.00%', { exact: false })).toHaveTextContent('0.00% today')
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 300000)
    const request = fetchMock.mock.calls.find(([url]) => url === '/api/live-prices')
    expect(JSON.parse(request[1].body).symbols).toEqual(['VERIFIED', 'WEAK'])
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    await act(async () => { await refresh() })
    expect(screen.getByText('$100.00')).toBeInTheDocument()
    expect(screen.queryByText('Price live')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Daily change unknown')).toBeInTheDocument()
    unmount()
    expect(clear).toHaveBeenCalledWith(123)
  })

  it.each([null, '', undefined])('does not turn an unknown live change (%s) into a flat day', async (changePercent) => {
    mockResearch([pick()], { quotes: [{ symbol: 'VERIFIED', price: 110, changePercent }] })
    render(<Research />)
    expect(await screen.findByText('$110.00')).toBeInTheDocument()
    expect(screen.getByLabelText('Daily change unknown')).toBeInTheDocument()
    expect(screen.queryByText('0.00%', { exact: false })).not.toBeInTheDocument()
  })

  it('rejects a stale quote and keeps its stored-price provenance', async () => {
    mockResearch([pick()], { quotes: [{ symbol: 'VERIFIED', price: 999, changePercent: 10, cacheStatus: 'stale' }] })
    render(<Research />)
    await screen.findByRole('article', { name: 'VERIFIED' })
    expect(screen.getByText('$100.00')).toBeInTheDocument()
    expect(screen.queryByText('$999.00')).not.toBeInTheDocument()
    expect(screen.getByText(/Price from/)).toBeInTheDocument()
  })

  it('keeps the sizing action on demand, reports missing holdings, and permits retry', async () => {
    const fetchMock = mockResearch([pick()])
    render(<Research />)
    fireEvent.click(await screen.findByRole('button', { name: /Size against my portfolio/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload your portfolio first')
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/position-sizing')).toBe(false)
    loadLocalPortfolio.mockReturnValue({ rows: [{ SYMBOL: 'OTHER', QUANTITY: '5', 'MARKET VALUE': 500 }] })
    let finish
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: /Try sizing again/ }))
    expect(screen.getByRole('button', { name: /Analyzing/ })).toBeDisabled()
    await act(async () => finish({ ok: true, json: async () => ({ totalSuggestedAllocation: 300, allocationPct: 3, picks: [{ ticker: 'VERIFIED', suggestedPct: 3, suggestedAmount: 300, reasoning: 'Keeps the position small.', overlap: 'OTHER', warning: 'Concentration warning.' }] }) }))
    expect(await screen.findByText('Keeps the position small.')).toBeInTheDocument()
    expect(screen.getByText('Existing overlap · OTHER')).toBeInTheDocument()
    expect(screen.getByText('Concentration warning.')).toBeInTheDocument()
  })

  it('opens the market breakdown and exposes article links without changing the payload', async () => {
    mockResearch([pick()], { regime: { score: 5, label: 'Mixed', drag: { label: 'Rates', detail: 'Rates are rising.' }, components: [{ key: 'rates', label: 'Interest rates', score: 3, detail: 'Rates affect borrowing.', metric: '10-year yield: 4%' }] }, data: { articles: [{ title: 'A reported event', link: 'https://example.com/story', source: 'Fixture News' }, { title: 'Untrusted link', link: 'javascript:alert(1)' }] } })
    render(<Research />)
    fireEvent.click(await screen.findByRole('button', { name: /View market breakdown/ }))
    expect(screen.getByText('10-year yield: 4%')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /A reported event/ })
    expect(link).toHaveAttribute('href', 'https://example.com/story')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByRole('link', { name: /Untrusted link/ })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '5'))
  })
})
