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
    { ticker: 'RKLB', securityId: 'figi:RKLB', name: 'Rocket Lab USA', outcome: 'published', sentToClaude: true, claudeStatus: 'accepted', rank: 2, finalScore: 84, catalystVerified: true,
      sources: ['X / attention'], strategies: ['attention'], priority: 68, legacyPriority: 100,
      priorityModel: { version: 'attention-review-priority-v2', usedForAdmission: true, score: 68, streamScores: { attention: 68 },
        components: { evidenceQuality: 20, sourceIndependence: 16, repetitionPenalty: -8 } } },
    { ticker: 'LATE', securityId: 'figi:LATE', name: 'Late Holdings', outcome: 'not_reviewed', sentToClaude: false, admitted: false,
      sources: ['SEC'], strategies: ['fundamentals'], horizons: [5, 20], priority: 77, overallRank: 18,
      legacyPriority: 77, priorityModel: { version: 'attention-review-priority-v2', usedForAdmission: true, score: 77, streamScores: { fundamentals: 77 } },
      legacyOverallRank: 12, legacyStreamRanks: { fundamentals: 9 },
      streamRanks: { fundamentals: 11 }, budgetUsage: { fundamentals: { configured: 10, reservedUsed: 10, selected: 10, reallocatedIn: 0, reallocatedOut: 0 } },
      evidenceCount: 1, evidence: [{ id: 'ev-late', strategy: 'fundamentals', horizon: 20, source: 'SEC', type: '10-Q' }],
      reason: 'review_budget_exhausted' },
  ],
  ...extra,
})

const NOW = new Date(2026, 8, 10, 12).getTime()

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  auth.user = { uid: 'owner', getIdToken: vi.fn(async () => 'signed-token') }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ runs: [run()] }) })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function openRun() {
  await screen.findByRole('heading', { name: 'Research logs' })
  fireEvent.click(screen.getByRole('button', { name: 'View run details' }))
}

function openCandidates() {
  fireEvent.click(screen.getByText('View candidates'))
}

function candidateCard(ticker) {
  const card = screen.getByText(ticker, { selector: '.logs-symbol' }).closest('details')
  fireEvent.click(card.querySelector('summary'))
  return card
}

describe('private research logs page', () => {
  it('leads with friendly summaries and keeps every run collapsed by default', async () => {
    renderLogs()
    expect(await screen.findByRole('heading', { name: 'Nightly Research' })).toBeVisible()
    expect(screen.getByText('Completed')).toBeVisible()
    expect(screen.getByText('134.0s')).toBeVisible()
    expect(screen.getByTitle(run().startedAt)).toHaveTextContent('Today ·')
    const summary = screen.getByLabelText('Run summary')
    expect(within(summary).getByText('82')).toBeVisible()
    expect(within(summary).getByText('15')).toBeVisible()
    expect(within(summary).getByText('4')).toBeVisible()
    expect(screen.queryByText('x_discovery')).not.toBeInTheDocument()
    expect(screen.queryByText('RKLB')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View run details' })).toHaveAttribute('aria-expanded', 'false')
    expect(fetch).toHaveBeenCalledWith('/api/get-research?runs=1&hours=720', expect.objectContaining({
      method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer signed-token' },
    }))
    await openRun()
    const technical = screen.getAllByText('Technical details').at(-1).closest('details')
    expect(technical).not.toHaveAttribute('open')
    fireEvent.click(technical.querySelector('summary'))
    expect(within(technical).getByText('X discovery')).toBeVisible()
    expect(within(technical).getByText('x_discovery')).toBeVisible()
    expect(within(technical).getByText('exa timeout')).toBeVisible()
    expect(within(technical).getByText('run-1', { selector: 'code' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Run details' }))
    expect(screen.queryByText('exa timeout')).not.toBeInTheDocument()
  })

  it('preserves identity, admission, rank, budget, source, evidence and raw reasons', async () => {
    renderLogs()
    await openRun()
    openCandidates()
    const card = candidateCard('LATE')
    expect(within(card).getByText('Late Holdings')).toBeVisible()
    expect(within(card).getByText('Eligible, not reviewed')).toBeVisible()
    expect(within(card).getByText('Priority').nextElementSibling).toHaveTextContent('77')
    expect(within(card).getByText('Overall #18')).toBeVisible()
    expect(within(card).getByText('Fundamentals #11')).toBeVisible()
    expect(within(card).getByText('SEC')).toBeVisible()
    expect(within(card).getByText('5, 20 sessions')).toBeVisible()
    expect(within(card).getByText('Admitted to review budget').nextElementSibling).toHaveTextContent('No')
    expect(within(card).getByText('Sent to Claude').nextElementSibling).toHaveTextContent('No')
    expect(within(card).getByText('Published').nextElementSibling).toHaveTextContent('No')
    expect(within(card).getByText('review_budget_exhausted')).not.toBeVisible()
    fireEvent.click(within(card).getByText('Technical details'))
    expect(within(card).getByText('review_budget_exhausted')).toBeVisible()
    expect(within(card).getByText('figi:LATE', { selector: 'code' })).toBeVisible()
    expect(within(card).getByText(/10\/10 reserved/)).toBeVisible()
    expect(within(card).getByText(/Used for admission · attention-review-priority-v2/)).toBeVisible()
    expect(within(card).getByText('Legacy priority').nextElementSibling).toHaveTextContent('77')
    expect(within(card).getByText('Overall #12')).toBeVisible()
    expect(within(card).getByText('Fundamentals #9')).toBeVisible()
    fireEvent.click(within(card).getByText('1 evidence item'))
    expect(within(card).getByText(/10-Q/, { selector: 'li' })).toBeVisible()
    expect(within(card).getByText('ev-late')).toBeVisible()
  })

  it('preserves Claude result and score, catalyst, final rank and publication', async () => {
    renderLogs()
    await openRun()
    openCandidates()
    const card = candidateCard('RKLB')
    expect(within(card).getByText('Sent to Claude').nextElementSibling).toHaveTextContent('Yes')
    expect(within(card).getByText('Accepted')).toBeVisible()
    expect(within(card).getByText('Score 84')).toBeVisible()
    expect(within(card).getByText('Verified')).toBeVisible()
    expect(within(card).getByText('#2')).toBeVisible()
    expect(within(card).getByText('Published', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Yes')
    fireEvent.click(within(card).getByText('Technical details'))
    expect(within(card).getByText(/Used for admission · attention-review-priority-v2/)).toBeVisible()
    expect(within(card).getByText(/Evidence quality \+20/)).toBeVisible()
    expect(within(card).getByText('Legacy priority').nextElementSibling).toHaveTextContent('100')
  })

  it('keeps the exact funnel, stream usage and cutoff diagnostics with candidates', async () => {
    renderLogs()
    await openRun()
    openCandidates()
    fireEvent.click(screen.getByText('Technical details · admission and cutoffs'))
    const funnel = screen.getByLabelText('Research admission funnel')
    expect(within(funnel).getAllByText('82', { selector: 'strong' })).toHaveLength(2)
    expect(within(funnel).getAllByText('15', { selector: 'strong' })).toHaveLength(2)
    expect(within(funnel).getByText('67')).toBeVisible()
    expect(screen.getByText(/It is not a cron-runtime timeout/)).toBeVisible()
    expect(screen.getByText(/10 \/ 10 used/)).toBeVisible()
    fireEvent.click(screen.getByText('Inspect candidates immediately below each cutoff'))
    expect(screen.getByText(/Lowest admitted: #10 ABC · priority 78/)).toBeVisible()
    expect(screen.getByText(/gap 1/)).toBeVisible()
  })

  it('handles legacy records, missing counts and stable IDs without inventing zeroes', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runs: [run({ admission: null, candidates: [
      { ticker: null, securityId: 'figi:BBG00UNKNOWN', outcome: 'discovered', sentToClaude: false, evidenceCount: 3, reason: 'unresolved_identity' },
    ] })] }) })
    renderLogs()
    await openRun()
    openCandidates()
    expect(screen.getByText('figi:BBG00UNKNOWN', { selector: '.logs-symbol' })).toBeVisible()
    fireEvent.click(screen.getByText('Technical details · admission and cutoffs'))
    expect(screen.getByText(/Admission funnel unavailable for this legacy run/)).toBeVisible()
    candidateCard('figi:BBG00UNKNOWN')
    expect(screen.getByText('3 evidence items (details unavailable)')).toBeVisible()
  })

  it('searches hidden candidates beyond the first ten and keeps full-run counts', async () => {
    const candidates = Array.from({ length: 11 }, (_, index) => ({
      ticker: `WAIT${index}`, securityId: `figi:WAIT${index}`, outcome: 'not_reviewed', sentToClaude: false,
      priority: 100 - index, overallRank: index + 1, reason: 'review_budget_exhausted',
    }))
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runs: [run({ admission: null, candidates })] }) })
    renderLogs()
    await openRun()
    openCandidates()
    expect(screen.getByText('Show all 11 eligible candidates')).toBeVisible()
    expect(screen.getByText('WAIT10')).not.toBeVisible()
    fireEvent.change(screen.getByLabelText(/Search ticker/i), { target: { value: ' wait10 ' } })
    expect(screen.getByText('WAIT10')).toBeVisible()
    expect(screen.queryByText('WAIT0')).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('Run summary')).getByText('11')).toBeVisible()
  })

  it('combines ticker, time and job filters across the full retained window', async () => {
    const history = [
      run({ runId: 'recent', startedAt: new Date(NOW - 3600000).toISOString() }),
      run({ runId: 'old', startedAt: new Date(NOW - 20 * 86400000).toISOString() }),
      run({ runId: 'sec', job: 'research-foundation', startedAt: new Date(NOW - 2 * 3600000).toISOString() }),
    ]
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runs: history }) })
    renderLogs()
    await screen.findByRole('heading', { name: 'Research logs' })
    fireEvent.change(screen.getByLabelText(/Search ticker/i), { target: { value: 'rklb' } })
    expect(screen.getAllByText('RKLB', { selector: '.logs-symbol' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '30D' }))
    expect(screen.getAllByText('RKLB', { selector: '.logs-symbol' })).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Nightly Research' }))
    expect(screen.getAllByText('RKLB', { selector: '.logs-symbol' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '12H' }))
    expect(screen.getAllByText('RKLB', { selector: '.logs-symbol' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Performance' }))
    expect(screen.getByText(/No runs mention/)).toBeVisible()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([['12H', 12], ['24H', 24], ['3D', 72], ['7D', 168], ['30D', 720]])('includes the %s boundary and excludes older and future runs', async (label, hours) => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runs: [
      run({ runId: 'boundary', startedAt: new Date(NOW - hours * 3600000).toISOString() }),
      run({ runId: 'older', startedAt: new Date(NOW - hours * 3600000 - 1).toISOString() }),
      run({ runId: 'future', startedAt: new Date(NOW + 1).toISOString() }),
    ] }) })
    renderLogs()
    await screen.findByRole('heading', { name: 'Research logs' })
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(screen.getByRole('status')).toHaveTextContent('1 run ·')
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
  })

  it.each([['Nightly Research', 'nightly-research'], ['SEC Ingestion', 'research-foundation'], ['Evaluation', 'research-evaluation'], ['Performance', 'track-performance']])('filters %s by its unchanged job ID', async (label, job) => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runs: [run(), run({ runId: 'job', job, candidates: [], admission: null })] }) })
    renderLogs()
    await screen.findByRole('heading', { name: 'Research logs' })
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(screen.getAllByRole('heading', { level: 2 }).every((h) => h.textContent === label)).toBe(true)
  })

  it('explains partial runs, skipped work, failures and budget limits without raw codes in the summary', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runs: [run({ status: 'partial', stages: [
      { stage: 'evaluation_input_freeze', status: 'skipped', metrics: { reason: 'time_budget' } },
      { stage: 'foundation_sync', status: 'failed', error: { message: 'internal failure' } },
    ] })] }) })
    renderLogs()
    expect(await screen.findByText('Completed with gaps')).toBeVisible()
    expect(screen.getByText(/This run finished, but some steps/)).toBeVisible()
    expect(screen.getByText(/Save evaluation snapshot was skipped because there was not enough time/)).toBeVisible()
    expect(screen.getByText(/SEC ingestion failed/)).toBeVisible()
    expect(screen.getByText(/67 eligible candidates did not receive a Claude review slot/)).toBeVisible()
    expect(screen.queryByText('time_budget')).not.toBeInTheDocument()
    expect(screen.queryByText('internal failure')).not.toBeInTheDocument()
  })

  it('redirects without fetching when a session cannot prove ownership', async () => {
    auth.user = { uid: 'preview' }
    renderLogs()
    expect(await screen.findByText('PORTFOLIO')).toBeInTheDocument()
    expect(screen.queryByText(/Research logs/)).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('redirects away when the API denies access', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Owner access required' }) })
    renderLogs()
    expect(await screen.findByText('PORTFOLIO')).toBeInTheDocument()
    expect(screen.queryByText(/Research logs/)).not.toBeInTheDocument()
  })

  it('never renders the page title while ownership is still being checked', () => {
    renderLogs()
    expect(screen.queryByText(/Research logs/)).not.toBeInTheDocument()
  })

  it('says plainly when no run has been recorded in the available window', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runs: [] }) })
    renderLogs()
    expect(await screen.findByText(/No research runs recorded in the last 30 days/)).toBeVisible()
  })

  it('preserves the evaluation handoff and failure diagnostics', async () => {
    const evaluation = { jobId: 'job-1', status: 'failed', frozenAt: run().startedAt, error: 'evaluation_error', retryState: 'pending' }
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runs: [run({ evaluation })] }) })
    renderLogs()
    expect(await screen.findByText(/The separate evaluation job failed/)).toBeVisible()
    await openRun()
    expect(screen.getByText(/Evaluation input/)).toBeVisible()
    expect(within(screen.getByLabelText('Evaluation handoff')).getByText(/Evaluation job/)).toBeVisible()
    const technical = screen.getAllByText('Technical details').at(-1).closest('details')
    fireEvent.click(technical.querySelector('summary'))
    expect(within(technical).getByText('evaluation_error')).toBeVisible()
    expect(within(technical).getByText('Evaluation retry state').nextElementSibling).toHaveTextContent('pending')
    fireEvent.click(screen.getByText('Complete run record'))
    expect(within(technical).getByText(/"retryState": "pending"/)).toBeVisible()
  })

  it('says when evaluation inputs were never frozen', async () => {
    renderLogs()
    await openRun()
    expect(screen.getByText(/not frozen/)).toBeVisible()
  })
})
