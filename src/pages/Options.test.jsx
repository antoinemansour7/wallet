import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { optionsResearchFixture } from '../test/optionsResearchFixture'
import { buildOptionsResearchView } from '../server/options/researchView'
import Options from './Options'
import OptionsOperations from './OptionsOperations'
import { driverText, lifecycle, morningStatus, otmLabel, riskLabel, stateLabel } from './options/display'

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
function serve(view) {
  fetch.mockImplementation(async (url) => url.includes('owner=1') ? response({ owner: true }) : response({ research: typeof view === 'function' ? view(url) : view }))
}
// The next session, before today's scan: the latest record is yesterday's.
function nextSession(opening, summary = {}) {
  return { ...research, summary: { ...research.summary, tradingDate: '2026-09-23', state: 'unavailable', reason: 'no_scan_for_current_session', ...summary },
    opening: opening && { tradingDate: '2026-09-23', scheduledAt: '2026-09-23T13:31:00.000Z', deadlineAt: '2026-09-23T13:35:00.000Z', ...opening } }
}
const at = (time) => { vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(new Date(`2026-09-23T${time}Z`)) }
const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() })

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
  it('leads with the scan result and one comparable line per contract', async () => {
    mount()
    const row = await screen.findByRole('article', { name: 'EX call candidate' })
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('2 contracts passed today’s scan')
    expect(document.body).toHaveTextContent('Sep 22 · 9:32 AM ET · Indicative quotes · Complete')
    const call = research.candidates.find((item) => item.direction === 'call')
    expect(row).toHaveTextContent('EX Call')
    expect(row).toHaveTextContent('Oct 22 · $200 strike')
    expect(row).toHaveTextContent('$5.55 ask')
    expect(row).toHaveTextContent('Spread 1.8%')
    expect(row).toHaveTextContent(`+${call.selectedScenario.askEntryModeledBidReturnPct.toFixed(1)}%`)
    expect(row).toHaveTextContent('if stock +5% in 3 sessions')
    expect(row).toHaveTextContent('Risk: Full premium at risk')
    expect(row).toHaveTextContent(call.score.toFixed(1))
    expect(screen.getByRole('article', { name: 'EX put candidate' })).toHaveTextContent('if stock −5% in 3 sessions')
    expect(screen.getAllByText(/they are not probabilities/)).toHaveLength(1)
    expect(within(row).getByText(/Bid \$5.45/)).not.toBeVisible()
    expect(screen.queryByText('Delta')).not.toBeInTheDocument()
    expect(screen.queryByText(/raw-call/)).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/Explore the assumptions|Availability is unknown|research record/)
    expect(fetch.mock.calls.some(([url]) => url.includes('contractId='))).toBe(false)
  })
  it('opens details and refreshes without replacing morning values, then filters by direction', async () => {
    mount()
    const row = await screen.findByRole('article', { name: 'EX call candidate' })
    const toggle = within(row).getByRole('button', { name: 'Details for EX call' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(row).getByText(/Bid \$5.45 · Mid \$5.50 · Ask \$5.55/)).toBeVisible()
    expect(row).toHaveTextContent('stock below strike')
    fireEvent.click(within(row).getByText('Contract details'))
    await within(row).findByText('Delta')
    expect(row).toHaveTextContent('1200')
    expect(row).toHaveTextContent('2026-09-21')
    await within(row).findByText(/Separate observed bid \$8.00/)
    expect(row).toHaveTextContent('Bid $5.45 · Mid $5.50 · Ask $5.55')
    const post = fetch.mock.calls.find(([, init]) => init.method === 'POST')
    expect(JSON.parse(post[1].body)).toEqual({ manifestId: fixture.manifest.manifestId, contractId: fixture.contracts[0].contractId })
    const user = userEvent.setup()
    const direction = screen.getByRole('group', { name: 'Direction' })
    await user.click(within(direction).getByRole('button', { name: /^Puts/ }))
    expect(within(direction).getByRole('button', { name: /^Puts/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('article', { name: 'EX call candidate' })).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'EX put candidate' })).toBeInTheDocument()
  })
  it('retains the archived morning on a failed reload and never displays raw errors', async () => {
    mount(`/options?morning=${fixture.manifest.manifestId}`)
    await screen.findByRole('article', { name: 'EX call candidate' })
    fetch.mockImplementation(async (url) => url.includes('owner=1') ? response({ owner: true }) : response({ error: 'Redis quota secret raw diagnostic', referenceId: 'options-reference' }, 503))
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('article', { name: 'EX call candidate' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t reload. The scan below is the one already loaded.')
    expect(screen.getByRole('alert')).toHaveTextContent('options-reference')
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
    await settle()
    await waitFor(() => expect(screen.getByRole('article', { name: 'EX call candidate' })).toBeInTheDocument())
    expect(screen.queryByText(/Quotes are now stale/)).not.toBeInTheDocument()
    const calls = fetch.mock.calls.length
    act(() => { vi.advanceTimersByTime(30000) })
    expect(screen.getByText('Quotes are now stale; showing the 9:32 AM ET record.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(calls)
  })
  it('loads a new latest morning only when requested, and keeps diagnostic metrics in Operations', async () => {
    mount(`/options?morning=${fixture.manifest.manifestId}`)
    await screen.findByRole('article', { name: 'EX call candidate' })
    serve({ ...research, manifestId: 'e'.repeat(64), morning: { ...research.morning, revision: 2 } })
    fireEvent.click(screen.getByRole('button', { name: 'Latest scan' }))
    await screen.findByText(/Revision 2/)
    expect(fetch.mock.calls.some(([url]) => url === '/api/get-research?optionsAudit=1&view=research')).toBe(true)
    expect(document.body).not.toHaveTextContent('provider429Count')
  })
  it('renders a valid empty result as the whole answer, without list scaffolding', async () => {
    serve({ ...research, candidates: [], morning: { ...research.morning, result: 'empty', state: 'empty' } })
    mount()
    await screen.findByRole('heading', { name: 'No contracts passed today’s scan.' })
    expect(screen.getByText('Nothing cleared the liquidity, pricing and risk filters.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Direction' })).not.toBeInTheDocument()
    expect(screen.queryByText(/not probabilities/)).not.toBeInTheDocument()
  })
  it.each([
    ['partial', 'complete', 'Part of the watchlist couldn’t be scanned, so this list may be missing contracts.'],
    ['complete', 'partial', 'Some saved details are missing, so a few contracts show less.'],
    ['partial', 'partial', 'Part of the watchlist couldn’t be scanned and some saved details are missing, so this list may be incomplete.'],
  ])('names a %s scan with %s saved detail in a single line', async (completeness, evidenceStatus, line) => {
    serve({ ...research, evidenceStatus, morning: { ...research.morning, completeness } })
    mount()
    await screen.findByRole('article', { name: 'EX call candidate' })
    expect(screen.getByText(line)).toBeInTheDocument()
    expect(document.body.textContent.includes('Partial scan')).toBe(completeness === 'partial')
  })
  it('hides the direction filter when there is nothing to filter, and ranks ten contracts compactly', async () => {
    const [call] = research.candidates
    serve({ ...research, candidates: [call] })
    const first = mount()
    await screen.findByRole('heading', { name: '1 contract passed today’s scan' })
    expect(screen.queryByRole('group', { name: 'Direction' })).not.toBeInTheDocument()
    first.unmount()
    const ten = Array.from({ length: 10 }, (_, index) => ({ ...research.candidates[index % 2], rank: index + 1, ticker: `T${index + 1}`, contractId: `osi:T${index + 1}` }))
    serve({ ...research, candidates: ten })
    mount()
    await screen.findByRole('heading', { name: '10 contracts passed today’s scan' })
    expect(screen.getAllByRole('article')).toHaveLength(10)
    expect(within(screen.getByRole('group', { name: 'Direction' })).getByRole('button', { name: /^Calls/ })).toHaveTextContent('Calls 5')
  })
  it('shows a short loading line, then a retryable error with no raw detail', async () => {
    let fail = false
    fetch.mockImplementation(async (url) => {
      if (url.includes('owner=1')) return response({ owner: true })
      if (fail) return response({ error: 'Raw provider text', referenceId: 'options-load-1' }, 503)
      return new Promise(() => {})
    })
    const app = mount()
    expect(await screen.findByRole('status')).toHaveTextContent('Loading today’s scan…')
    expect(screen.queryByRole('group', { name: 'Direction' })).not.toBeInTheDocument()
    app.unmount()
    fail = true
    mount()
    await screen.findByRole('heading', { name: 'Couldn’t load today’s scan.' })
    expect(screen.getByRole('alert')).toHaveTextContent('options-load-1')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Raw provider text')
  })
})

describe('when today has no scan to show', () => {
  it.each([
    ['12:00:00', { status: 'scheduled' }, 'No scan yet today.', 'The opening scan normally publishes around 9:35 AM ET.'],
    ['13:32:00', { status: 'due' }, 'No scan yet today.', 'It should publish by 9:35 AM ET.'],
    ['13:40:00', { status: 'failed', at: '2026-09-23T13:33:10.000Z' }, 'Today’s scan failed.', 'It stopped at 9:33 AM ET without publishing. Operations has the details.'],
    ['13:40:00', { status: 'late', at: '2026-09-23T13:36:00.000Z' }, 'Today’s scan finished too late.', 'It ended at 9:36 AM ET, after the 9:35 AM ET cutoff'],
    ['13:40:00', { status: 'missed' }, 'Scan missed the opening window.', 'It didn’t start before the 9:35 AM ET cutoff.'],
    ['13:40:00', { status: 'unknown' }, 'No scan published today.', 'It was due by 9:35 AM ET.'],
    ['13:40:00', { status: 'published' }, 'Today’s scan ran, but it couldn’t be loaded.', 'Try reloading'],
  ])('at %s with %j says it in one compact card', async (time, opening, title, body) => {
    at(time)
    serve(nextSession(opening))
    mount()
    await settle()
    const card = await screen.findByRole('heading', { name: title })
    expect(card.parentElement).toHaveTextContent(body)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sep 22 scan · 2 contracts →' })).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Direction' })).not.toBeInTheDocument()
    expect(screen.queryByText(/not probabilities/)).not.toBeInTheDocument()
    expect(fetch.mock.calls.every(([url]) => !url.includes('manifestId'))).toBe(true)
  })
  it('says the scan is overdue once the deadline passes on screen', async () => {
    at('13:34:50')
    serve(nextSession({ status: 'due' }))
    mount()
    await settle()
    await screen.findByRole('heading', { name: 'No scan yet today.' })
    act(() => { vi.advanceTimersByTime(15000) })
    expect(screen.getByRole('heading', { name: 'No scan published today.' })).toBeInTheDocument()
  })
  it('says markets are closed on a closed day', async () => {
    serve(nextSession(null, { state: 'closed' }))
    mount()
    await screen.findByRole('heading', { name: 'Markets are closed today.' })
  })
  it('opens an earlier morning by URL, labels it, and returns to today', async () => {
    at('12:00:00')
    serve((url) => url.includes('manifestId') ? { ...nextSession({ status: 'scheduled' }), opening: undefined } : nextSession({ status: 'scheduled' }))
    mount()
    await settle()
    fireEvent.click(await screen.findByRole('link', { name: 'Sep 22 scan · 2 contracts →' }))
    await settle()
    expect(await screen.findByRole('heading', { name: '2 contracts passed the Sep 22 scan' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('You’re viewing an earlier scan; its quotes are from Sep 22.')
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Latest scan' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to today' }))
    await settle()
    expect(await screen.findByRole('heading', { name: 'No scan yet today.' })).toBeInTheDocument()
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
  it('names a missing-input deduction as the gap, not the condition', () => {
    expect(riskLabel('iv_above_90th_percentile', 'missing_input_uses_existing_worst_case_penalty')).toBe('IV history unknown')
    expect(riskLabel('iv_above_90th_percentile', 'implied_volatility_rich_against_own_history')).toBe('IV rich vs. its history')
    expect(riskLabel('event_before_expiry_after_exit', 'missing_input_uses_existing_worst_case_penalty')).toBe('Event calendar incomplete')
    expect(driverText([{ component: 'underlyingSetup' }, { component: 'convexity' }])).toBe('Strong setup · good convexity')
    expect(driverText([])).toBe('No standout drivers')
  })
  it('keeps today, archived, closed and every no-scan state distinct', () => {
    const now = Date.parse('2026-09-23T13:40:00Z')
    expect(morningStatus(research, Date.parse('2026-09-22T13:32:21Z')).kind).toBe('today')
    expect(morningStatus(nextSession({ status: 'failed' }), now, { selected: true }).kind).toBe('archived')
    expect(morningStatus(nextSession(null, { state: 'closed' }), now).kind).toBe('closed')
    expect(morningStatus(nextSession(null), now).kind).toBe('unavailable')
    const kinds = ['scheduled', 'failed', 'late', 'missed', 'published', 'unknown'].map((status) => morningStatus(nextSession({ status }), now).kind)
    expect(kinds).toEqual(['overdue', 'failed', 'late', 'missed', 'unreadable', 'overdue'])
    expect(morningStatus(nextSession({ status: 'unknown' }), Date.parse('2026-09-23T13:33:00Z')).kind).toBe('due')
  })
})
