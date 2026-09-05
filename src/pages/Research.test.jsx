import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'test' } }) }))
vi.mock('../preview/mockMode', () => ({ IS_PREVIEW: false, PREVIEW_RESEARCH: null }))
vi.mock('./research/RegimeGauge', () => ({ default: () => null }))
vi.mock('./research/PickCard', () => ({ default: ({ pick, rank }) => <article aria-label={pick.ticker}>{rank}: {pick.ticker}</article> }))
import Research from './Research.jsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mockResearch(picks) {
  vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, json: async () => url === '/api/get-research'
    ? { picks, generatedAt: '2026-06-12T13:00:00Z', signalCount: 50 }
    : { regime: null, quotes: [] } })))
}

describe('research delivery order', () => {
  it('preserves the server ranking instead of sorting again by LLM conviction', async () => {
    mockResearch([{ ticker: 'VERIFIED', conviction: 7, finalScore: 30 }, { ticker: 'HYPE', conviction: 9, finalScore: 20 }])
    render(<Research />)
    await screen.findByRole('article', { name: 'VERIFIED' })
    expect(screen.getAllByRole('article').map((item) => item.getAttribute('aria-label'))).toEqual(['VERIFIED', 'HYPE'])
    expect(within(screen.getByRole('article', { name: 'VERIFIED' })).getByText('1: VERIFIED')).toBeInTheDocument()
  })

  it('explains a completed scan with no qualifying ideas', async () => {
    mockResearch([])
    render(<Research />)
    expect(await screen.findByText('No qualifying ideas this run')).toBeInTheDocument()
    expect(screen.queryByText('No picks yet')).not.toBeInTheDocument()
  })
})
