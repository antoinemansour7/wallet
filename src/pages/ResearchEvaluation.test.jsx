import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ResearchEvaluation from './ResearchEvaluation'
const auth = vi.hoisted(() => ({ user: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

// A non-owner must never learn this page exists, so every render happens
// inside a router with a real destination: the assertion is what the *app*
// shows after the redirect, not a mocked navigate() call.
function renderEvaluation() {
  return render(
    <MemoryRouter initialEntries={['/research/evaluation']}>
      <Routes>
        <Route path="/research/evaluation" element={<ResearchEvaluation />} />
        <Route path="/portfolio" element={<div>PORTFOLIO</div>} />
      </Routes>
    </MemoryRouter>,
  )
}
const horizon = (h) => ({ horizon: h, completed: 0, pending: 0, unavailable: 0, sampleSize: 0,
  benchmarkSampleSize: 0, sectorSampleSize: 0, meanReturn: null, medianReturn: null, meanNetReturn: null,
  medianNetReturn: null, benchmarkRelative: null, sectorRelative: null, status: 'Insufficient data' })
const report = () => ({ experimentId: 'discovery-matrix-v1', status: 'Insufficient data', variantsTried: 6, latestRun: null,
  definition: null, arms: [{ id: 'frozen-existing', name: 'Frozen existing engine', version: 'frozen-existing-v1',
    cohort: 'shadow', observations: 0, accepted: 0, rejected: 0, cohorts: [], emptyHorizons: [horizon(5), horizon(20)] }] })
beforeEach(() => {
  auth.isResearchOwner = false
  auth.user = { uid: 'owner', getIdToken: vi.fn(async () => 'signed-token') }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => report() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('private evaluation page', () => {
  it('lets a verified owner retry a temporary API failure without being sent away', async () => {
    auth.isResearchOwner = true
    fetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'Temporary storage issue' }) })
    renderEvaluation()
    expect(screen.getByText('Loading evaluation summary…')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary storage issue')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Frozen existing engine')).toBeInTheDocument()
  })

  it('distinguishes an active review from a queued review and labels stale results', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ ...report(), stale: true,
      currentJob: { status: 'started' }, generatedAt: '2026-09-20T11:00:00Z' }) })
    renderEvaluation()
    expect(await screen.findByText(/Evaluation: running/)).toBeInTheDocument()
    expect(screen.getByText(/more than 36 hours old/)).toBeInTheDocument()
  })
  it('uses authenticated GET only and honestly shows zero completed sessions', async () => {
    renderEvaluation()
    expect(await screen.findByText('Frozen existing engine')).toBeInTheDocument()
    expect(screen.getAllByText('0 completed — insufficient data')).toHaveLength(2)
    expect(screen.getByText('20 sessions')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/get-research?evaluation=1', expect.objectContaining({ method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer signed-token' } }))
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
  it('redirects away without ever fetching, for a session that cannot prove ownership', async () => {
    auth.user = { uid: 'preview' }
    renderEvaluation()
    expect(await screen.findByText('PORTFOLIO')).toBeInTheDocument()
    expect(screen.queryByText(/Research evaluation/)).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('redirects away, rather than showing the refusal, when the API denies access', async () => {
    fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Owner access required' }) })
    renderEvaluation()
    expect(await screen.findByText('PORTFOLIO')).toBeInTheDocument()
    expect(screen.queryByText('Frozen existing engine')).not.toBeInTheDocument()
  })
  it('never renders the page title while ownership is still being checked', () => {
    renderEvaluation()
    expect(screen.queryByText(/Research evaluation/)).not.toBeInTheDocument()
  })
  it('renders the summary without an individual-stock payload or filters', async () => {
    renderEvaluation()
    expect(await screen.findByText('Frozen existing engine')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Individual observations' })).not.toBeInTheDocument()
    expect(screen.queryByText('Individual stocks and daily observations')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('explains a partially blocked run and puts the raw provider error in a disclosure', async () => {
    const data = report()
    data.status = 'Partially blocked'
    data.latestRun = { availableAt: '2026-09-29T11:00:22Z', failures: ['Your credit balance is too low to access the Anthropic API.', null] }
    fetch.mockResolvedValue({ ok: true, json: async () => data })
    renderEvaluation()
    expect(await screen.findByText('Partially blocked')).toBeInTheDocument()
    expect(screen.getByText(/This review was blocked because Anthropic credits ran out. Reviews now run on OpenAI/)).toBeInTheDocument()
    expect(screen.getByText(/Frozen engine review:/).closest('details')).not.toHaveAttribute('open')
  })
  it('clears owner data immediately when the signed-in identity changes', async () => {
    const { rerender } = renderEvaluation()
    await screen.findByText('Frozen existing engine')
    auth.user = { uid: 'other', getIdToken: () => new Promise(() => {}) }
    rerender(
      <MemoryRouter initialEntries={['/research/evaluation']}>
        <Routes>
          <Route path="/research/evaluation" element={<ResearchEvaluation />} />
          <Route path="/portfolio" element={<div>PORTFOLIO</div>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.queryByText('Frozen existing engine')).not.toBeInTheDocument())
  })

  it('shows a pending banner instead of looking blank when a job is frozen but not yet processed', async () => {
    const data = report()
    data.currentJob = { status: 'pending', frozenAt: '2026-09-10T07:02:00.000Z', error: null, retryState: null }
    fetch.mockResolvedValue({ ok: true, json: async () => data })
    renderEvaluation()
    expect(await screen.findByText(/Evaluation: pending/)).toBeInTheDocument()
    expect(screen.getByText(/Next step: scheduled evaluation job/)).toBeInTheDocument()
  })

  it('shows a failed banner with the reason and retry state', async () => {
    const data = report()
    data.currentJob = { status: 'failed', frozenAt: '2026-09-10T07:02:00.000Z', error: 'anthropic unavailable', retryState: 'retryable' }
    fetch.mockResolvedValue({ ok: true, json: async () => data })
    renderEvaluation()
    expect(await screen.findByText(/Evaluation: failed/)).toBeInTheDocument()
    expect(screen.getByText(/anthropic unavailable/)).toBeInTheDocument()
    expect(screen.getByText(/Retry state: retryable/)).toBeInTheDocument()
  })

  it('shows no banner once the job has completed', async () => {
    const data = report()
    data.currentJob = null
    fetch.mockResolvedValue({ ok: true, json: async () => data })
    renderEvaluation()
    await screen.findByText('Frozen existing engine')
    expect(screen.queryByText(/Evaluation: pending/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Evaluation: failed/)).not.toBeInTheDocument()
  })
})
