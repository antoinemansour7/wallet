import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
  candidates: [
    { ticker: 'RKLB', outcome: 'published', reviewed: true, rank: 2, finalScore: 84, catalystVerified: true },
    { ticker: 'LATE', outcome: 'not_reviewed', reviewed: false, reason: 'review_budget_exhausted' },
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

    expect(await screen.findByText('LATE')).toBeInTheDocument()
    expect(screen.getByText(/review_budget_exhausted/)).toBeInTheDocument()
    expect(screen.getByText('Not reviewed')).toBeInTheDocument()
  })

  it('filters the candidate trace down to one ticker', async () => {
    renderLogs()
    await screen.findByText('RKLB')

    fireEvent.change(screen.getByLabelText(/ticker/i), { target: { value: 'late' } })

    expect(screen.queryByText('RKLB')).not.toBeInTheDocument()
    expect(screen.getByText('LATE')).toBeInTheDocument()
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
