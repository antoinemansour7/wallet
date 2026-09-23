import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { optionsResearchFixture } from '../test/optionsResearchFixture'
import { buildOptionsResearchView } from '../server/options/researchView'
import Options from './Options'
import OptionsOperations from './OptionsOperations'
import { lifecycle, otmLabel, stateLabel } from './options/display'

const auth = vi.hoisted(() => ({ user: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
let fixture, research, detail
beforeAll(async () => {
  fixture = optionsResearchFixture()
  research = await buildOptionsResearchView({ ...fixture, now: () => Date.parse('2026-09-22T13:32:21Z') })
  detail = await buildOptionsResearchView({ ...fixture, contractId: fixture.contracts[0].contractId, now: () => Date.parse('2026-09-22T13:32:21Z') })
})
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
function mount(path = '/options') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/options" element={<Options />} /><Route path="/options/operations" element={<OptionsOperations />} /><Route path="/portfolio" element={<p>Portfolio destination</p>} /></Routes></MemoryRouter>)
}
beforeEach(() => {
  auth.user = { uid: 'owner', getIdToken: vi.fn(async () => 'owner-token') }
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (url.includes('owner=1')) return response({ owner: true })
    if (init.method === 'POST') return response({ detail: { refresh: { status: 'accepted', availableAt: '2026-09-22T14:00:00Z', contract: { quote: { bid: 8, ask: 8.1, marketAt: '2026-09-22T13:59:59Z' } } } } })
    if (url.includes('contractId=')) return response({ research: detail })
    if (url.includes('view=operations')) return response({ operations: { status: 'ok', checkedAt: '2026-09-22T14:00:00Z', stageTimings: [{ metrics: { provider429Count: 3 } }] } })
    return response({ research })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('owner-only Options workspace', () => {
  it.each(['/options', '/options/operations'])('denies direct %s links before reading any options data', async (path) => {
    fetch.mockResolvedValue(response({ error: 'Owner access required' }, 403))
    mount(path)
    expect(screen.queryByText('Morning opportunities')).not.toBeInTheDocument()
    await screen.findByText('Portfolio destination')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toContain('owner=1')
  })
  it('keeps default rows compact and uses archived numerical values with explicit assumptions', async () => {
    mount()
    const row = await screen.findByRole('article', { name: 'EX call candidate' })
    expect(within(row).getByText('$5.50')).toBeInTheDocument()
    expect(row).toHaveTextContent('Bid $5.45 · Ask $5.55')
    expect(row).toHaveTextContent('stock below strike')
    expect(row).toHaveTextContent('3 sessions')
    expect(row).toHaveTextContent('ask entry → modeled bid exit')
    expect(row).toHaveTextContent(`${research.candidates.find((item) => item.direction === 'call').selectedScenario.askEntryModeledBidReturnPct.toFixed(1)}%`)
    expect(screen.getByText(/Scores are not probabilities/)).toBeInTheDocument()
    expect(screen.queryByText('Delta')).not.toBeInTheDocument()
    expect(screen.queryByText(/raw-call/)).not.toBeInTheDocument()
    expect(fetch.mock.calls.some(([url]) => url.includes('contractId='))).toBe(false)
  })
  it('opens separate details and refreshes without replacing morning values, then filters independently', async () => {
    mount()
    const row = await screen.findByRole('article', { name: 'EX call candidate' })
    const contractSummary = within(row).getByText('Contract details')
    fireEvent.click(contractSummary)
    await within(row).findByText('Delta')
    expect(row).toHaveTextContent('1200')
    expect(row).toHaveTextContent('2026-09-21')
    await within(row).findByText(/Separate observed bid \$8.00/)
    expect(row).toHaveTextContent('Bid $5.45 · Ask $5.55')
    const post = fetch.mock.calls.find(([, init]) => init.method === 'POST')
    expect(JSON.parse(post[1].body)).toEqual({ manifestId: fixture.manifest.manifestId, contractId: fixture.contracts[0].contractId })
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Direction' }), 'put')
    expect(screen.queryByRole('article', { name: 'EX call candidate' })).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'EX put candidate' })).toHaveTextContent('stock above strike')
  })
  it('retains the archived morning on a failed reload and never displays raw errors', async () => {
    mount(`/options?morning=${fixture.manifest.manifestId}`)
    await screen.findByRole('article', { name: 'EX call candidate' })
    fetch.mockImplementation(async (url) => url.includes('owner=1') ? response({ owner: true }) : response({ error: 'Redis quota secret raw diagnostic', referenceId: 'options-reference' }, 503))
    fireEvent.click(screen.getByRole('button', { name: 'Reload record' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('article', { name: 'EX call candidate' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('morning record remains')
    expect(document.body).not.toHaveTextContent('Redis quota')
  })
  it('clears owner data immediately on an identity change', async () => {
    const app = mount()
    await screen.findByRole('article', { name: 'EX call candidate' })
    auth.user = { uid: 'other', getIdToken: () => new Promise(() => {}) }
    app.rerender(<MemoryRouter><Options /></MemoryRouter>)
    expect(screen.queryByText('Morning opportunities')).not.toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
  it('advances freshness locally without polling or changing the morning quote time', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-09-22T13:32:21Z'))
    mount(`/options?morning=${fixture.manifest.manifestId}`)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await waitFor(() => expect(screen.getByRole('article', { name: 'EX call candidate' })).toBeInTheDocument())
    expect(screen.queryByText('Stale')).not.toBeInTheDocument()
    const calls = fetch.mock.calls.length
    act(() => { vi.advanceTimersByTime(30000) })
    expect(screen.getByText('Stale')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(calls)
    expect(screen.getAllByText(/09:32:15 AM EDT/).length).toBeGreaterThan(0)
  })
  it('loads a new latest morning only when requested, and keeps diagnostic metrics in Operations', async () => {
    mount(`/options?morning=${fixture.manifest.manifestId}`)
    await screen.findByRole('article', { name: 'EX call candidate' })
    const next = { ...research, manifestId: 'e'.repeat(64), morning: { ...research.morning, revision: 2 } }
    fetch.mockImplementation(async (url) => url.includes('owner=1') ? response({ owner: true }) : response({ research: next }))
    fireEvent.click(screen.getByRole('button', { name: 'Latest morning' }))
    await screen.findByText(/revision 2/)
    expect(fetch.mock.calls.some(([url]) => url === '/api/get-research?optionsAudit=1&view=research')).toBe(true)
    expect(document.body).not.toHaveTextContent('provider429Count')
  })
  it('renders a valid empty result separately from unavailable data', async () => {
    fetch.mockImplementation(async (url) => url.includes('owner=1') ? response({}) : response({ research: { ...research, candidates: [], morning: { ...research.morning, result: 'empty' } } }))
    mount()
    await screen.findByText('No contracts passed this scan')
    expect(screen.getByText('A valid empty result is part of the research record.')).toBeInTheDocument()
  })
})

describe('research labels', () => {
  it('distinguishes every required status and handles market close', () => {
    const states = ['theoretical', 'delayed', 'live', 'stale', 'partial', 'closed', 'empty', 'unavailable']
    expect(new Set(states.map(stateLabel)).size).toBe(states.length)
    expect(lifecycle(research, Date.parse('2026-09-22T20:00:00Z'))).toBe('closed')
  })
  it('only claims a gain while OTM if the conservative return is positive', () => {
    const contract = { type: 'put', strikePrice: 100 }
    expect(otmLabel({ underlyingPrice: 110, midReturnPct: 20, askEntryModeledBidReturnPct: -3 }, contract)).toBe('Still OTM · stock above strike')
    expect(otmLabel({ underlyingPrice: 90, askEntryModeledBidReturnPct: 20 }, contract)).toBe('In the money')
  })
})
