import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import ResearchEvaluation from './ResearchEvaluation'
const auth = vi.hoisted(() => ({ user: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
const horizon = (h) => ({ horizon: h, completed: 0, pending: 0, unavailable: 0, sampleSize: 0,
  benchmarkSampleSize: 0, sectorSampleSize: 0, meanReturn: null, medianReturn: null, meanNetReturn: null,
  medianNetReturn: null, benchmarkRelative: null, sectorRelative: null, status: 'Insufficient data' })
const report = () => ({ experimentId: 'discovery-matrix-v1', status: 'Insufficient data', variantsTried: 6, latestRun: null,
  definition: null, observations: [], arms: [{ id: 'frozen-existing', name: 'Frozen existing engine', version: 'frozen-existing-v1',
    cohort: 'shadow', observations: 0, accepted: 0, rejected: 0, cohorts: [], emptyHorizons: [horizon(5), horizon(20)] }] })
beforeEach(() => {
  auth.user = { uid: 'owner', getIdToken: vi.fn(async () => 'signed-token') }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => report() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('private evaluation page', () => {
  it('uses authenticated GET only and honestly shows zero completed sessions', async () => {
    render(<ResearchEvaluation />)
    expect(await screen.findByText('Frozen existing engine')).toBeInTheDocument()
    expect(screen.getAllByText('0 completed — insufficient data')).toHaveLength(2)
    expect(screen.getByText('20 sessions')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/get-research?evaluation=1', expect.objectContaining({ method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer signed-token' } }))
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
  it('does not load data for mock sessions and displays owner-only denial', async () => {
    auth.user = { uid: 'preview' }
    render(<ResearchEvaluation />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Owner sign-in required')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not display experiment data when the API rejects a non-owner', async () => {
    fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Owner access required' }) })
    render(<ResearchEvaluation />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Owner access required')
    expect(screen.queryByText('Frozen existing engine')).not.toBeInTheDocument()
  })
  it('allows stock inspection and client-side filtering without writes', async () => {
    const data = report()
    data.observations = [{ id: 'o', ticker: 'QUIET', securityId: 'figi:Q', issuerId: 'cik:Q', decisionAt: '2026-09-09T12:00:00Z',
      horizons: [5, 20], arm: 'frozen-existing', armVersion: 'v1', cohort: 'shadow', status: 'rejected', period: 'development',
      rejectionReason: 'rank_capacity', score: 55, rank: 6, price: 100, currency: 'USD', evidenceIds: ['evidence-original'],
      outcomes: [{ horizon: 5, status: 'pending' }, { horizon: 20, status: 'pending' }] }]
    fetch.mockResolvedValue({ ok: true, json: async () => data })
    render(<ResearchEvaluation />)
    expect(await screen.findByText(/QUIET · 2026-09-09/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'accepted' } })
    expect(screen.queryByText(/QUIET · 2026-09-09/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'rejected' } })
    expect(screen.getByText(/QUIET · 2026-09-09/)).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('clears owner data immediately when the signed-in identity changes', async () => {
    const { rerender } = render(<ResearchEvaluation />)
    await screen.findByText('Frozen existing engine')
    auth.user = { uid: 'other', getIdToken: () => new Promise(() => {}) }
    rerender(<ResearchEvaluation />)
    await waitFor(() => expect(screen.queryByText('Frozen existing engine')).not.toBeInTheDocument())
  })
})
