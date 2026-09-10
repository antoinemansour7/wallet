import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ResearchLogs from './ResearchLogs'
const auth = vi.hoisted(() => ({ user: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

// A non-owner must never see this page exist, so every render happens inside
// a router with a real destination: the assertion is what the *app* shows
// after the redirect, not a mocked navigate() call.
function renderLogs() {
  return render(
    <MemoryRouter initialEntries={['/research/logs']}>
      <Routes>
        <Route path="/research/logs" element={<ResearchLogs />} />
        <Route path="/portfolio" element={<div>PORTFOLIO</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const run = (extra = {}) => ({
  runId: 'run-1', job: 'nightly-research', status: 'success',
  startedAt: '2026-09-10T07:00:00.000Z', durationMs: 134000,
  stages: [
    { stage: 'x_discovery', status: 'success', durationMs: 900, metrics: { signals: 24 } },
    { stage: 'catalyst_verification', status: 'failed', durationMs: 4200, error: { message: 'exa timeout' } },
  ],
  admission: {
    funnel: { discovered: 82, eligible: 82, admitted: 15, sentToClaude: 15, claudeAccepted: 4, published: 4, notReviewed: 67 },
    streams: [{
      strategy: 'fundamentals', horizon: 20, configured: 10, reservedUsed: 10, selected: 10,
      reallocatedIn: 0, reallocatedOut: 0, eligible: 63, waiting: 53,
      sources: [{ source: 'SEC', count: 63 }],
      lowestAdmitted: { ticker: 'ABC', securityId: 'figi:ABC', priority: 78, streamRanks: { fundamentals: 10 } },
      belowCutoff: [{ ticker: 'LATE', securityId: 'figi:LATE', name: 'Late Holdings', priority: 77, priorityGap: 1,
        streamRanks: { fundamentals: 11 }, sources: ['SEC'], evidence: [{ id: 'ev-late', type: '10-Q' }] }],
    }],
  },
  candidates: [
    { ticker: 'RKLB', securityId: 'figi:RKLB', name: 'Rocket Lab USA', outcome: 'published', sentToClaude: true, claudeStatus: 'accepted', rank: 2, finalScore: 84, catalystVerified: true },
    { ticker: 'LATE', securityId: 'figi:LATE', name: 'Late Holdings', outcome: 'not_reviewed', sentToClaude: false,
      sources: ['SEC'], strategies: ['fundamentals'], horizons: [5, 20], priority: 77, overallRank: 18,
      streamRanks: { fundamentals: 11 }, budgetUsage: { fundamentals: { configured: 10, reservedUsed: 10, selected: 10, reallocatedIn: 0, reallocatedOut: 0 } },
      evidenceCount: 1, evidence: [{ id: 'ev-late', strategy: 'fundamentals', horizon: 20, source: 'SEC', type: '10-Q' }],
      reason: 'review_budget_exhausted' },
  ],
  ...extra,
})

beforeEach(() => {
  auth.user = { uid: 'owner', getIdToken: vi.fn(async () => 'signed-token') }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ runs: [run()] }) })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('private research logs page', () => {
  it('lists a run with its status, duration and stage outcomes', async () => {
    renderLogs()

    expect(await screen.findByText(/nightly-research/)).toBeInTheDocument()
    expect(screen.getByText('x_discovery')).toBeInTheDocument()
    expect(screen.getByText('catalyst_verification')).toBeInTheDocument()
    expect(screen.getByText(/exa timeout/)).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/get-research?runs=1', expect.objectContaining({
      method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer signed-token' },
    }))
  })

  it('makes it obvious why a candidate never reached the model', async () => {
    renderLogs()

    const group = await screen.findByRole('heading', { name: /Eligible but not reviewed/ })
    const row = within(group.closest('section')).getAllByText('LATE').at(-1).closest('tr')
    expect(within(row).getByText('Late Holdings')).toBeInTheDocument()
    expect(within(row).getByText(/review_budget_exhausted/)).toBeInTheDocument()
    expect(within(row).getByText('Eligible, not reviewed')).toBeInTheDocument()
    expect(within(row).getByText('NO')).toBeInTheDocument()
    expect(within(row).getByText(/Overall #18/)).toBeInTheDocument()
    expect(within(row).getByText(/Fundamentals #11/)).toBeInTheDocument()
    expect(within(row).getByText(/10\/10 reserved/)).toBeInTheDocument()
    expect(within(row).getByText('SEC')).toBeInTheDocument()
  })

  it('shows the exact run funnel, stream usage and candidates immediately below the cutoff', async () => {
    renderLogs()

    const funnel = await screen.findByLabelText('Research admission funnel')
    expect(within(funnel).getAllByText('82', { selector: 'strong' })).toHaveLength(2)
    expect(within(funnel).getAllByText('15', { selector: 'strong' })).toHaveLength(2)
    expect(within(funnel).getByText('67')).toBeInTheDocument()
    expect(screen.getByText(/It is not a cron-runtime timeout/)).toBeInTheDocument()
    expect(screen.getByText(/10 \/ 10 used/)).toBeInTheDocument()
    expect(screen.getAllByText(/#10 ABC · priority 78/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect candidates immediately below each cutoff/)).toBeInTheDocument()
  })

  it('uses ticker and company identity when known and falls back to the stable ID otherwise', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ runs: [run({
      admission: null,
      candidates: [{ ticker: null, securityId: 'figi:BBG00UNKNOWN', outcome: 'discovered', sentToClaude: false, reason: 'unresolved_identity' }],
    })] }) })))
    renderLogs()

    expect(await screen.findByText('figi:BBG00UNKNOWN')).toBeInTheDocument()
    expect(screen.getByText(/Admission funnel unavailable for this legacy run/)).toBeInTheDocument()
  })

  it('keeps a large exhausted cohort compact with an option to inspect every candidate', async () => {
    const candidates = Array.from({ length: 11 }, (_, index) => ({
      ticker: `WAIT${index}`, securityId: `figi:WAIT${index}`, outcome: 'not_reviewed', sentToClaude: false,
      priority: 100 - index, overallRank: index + 1, reason: 'review_budget_exhausted',
    }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ runs: [run({ admission: null, candidates })] }) })))
    renderLogs()

    expect(await screen.findByText('Show all 11 eligible candidates')).toBeInTheDocument()
  })

  it('filters the candidate trace down to one ticker', async () => {
    renderLogs()
    await screen.findByText('RKLB')

    fireEvent.change(screen.getByLabelText(/ticker/i), { target: { value: 'late' } })

    expect(screen.queryByText('RKLB')).not.toBeInTheDocument()
    expect(screen.getAllByText('LATE').length).toBeGreaterThan(0)
  })

  it('is read-only, offering no control that could write', async () => {
    renderLogs()
    await screen.findByText('RKLB')

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('redirects away without ever fetching, for a session that cannot prove ownership', async () => {
    auth.user = { uid: 'preview' }
    renderLogs()

    expect(await screen.findByText('PORTFOLIO')).toBeInTheDocument()
    expect(screen.queryByText(/Research logs/)).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('redirects away, rather than showing the refusal, when the API denies access', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Owner access required' }) })))
    renderLogs()

    expect(await screen.findByText('PORTFOLIO')).toBeInTheDocument()
    expect(screen.queryByText(/Research logs/)).not.toBeInTheDocument()
  })

  it('never renders the page title while ownership is still being checked', () => {
    renderLogs()

    expect(screen.queryByText(/Research logs/)).not.toBeInTheDocument()
  })

  it('says so plainly when no run has been recorded yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ runs: [] }) })))
    renderLogs()

    expect(await screen.findByText(/No research runs recorded yet/)).toBeInTheDocument()
  })
})
