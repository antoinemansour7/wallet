import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { readFileSync } from 'node:fs'
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
  startedAt: '2026-09-10T07:00:00.000Z', finishedAt: '2026-09-10T07:02:14.000Z', durationMs: 134000,
  stages: [
    { stage: 'x_discovery', status: 'success', durationMs: 900, metrics: { signals: 24 } },
    { stage: 'claude_review', status: 'success', durationMs: 42000, metrics: { accepted: 4 } },
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

const serve = (runs) => vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runs }) })
const card = () => screen.getAllByRole('article')[0]

async function ready() {
  return screen.findByRole('heading', { name: 'Research activity' })
}
async function openRun() {
  await ready()
  fireEvent.click(screen.getByRole('button', { name: /View details/ }))
}
const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }))

function candidateCard(ticker) {
  const details = screen.getByText(ticker, { selector: '.logs-symbol' }).closest('details')
  fireEvent.click(details.querySelector('summary'))
  return details
}

describe('research activity page', () => {
  /* ------------------------------------------------ 1. compact successful run */
  it('answers what ran, whether it worked and what it produced in one collapsed card', async () => {
    renderLogs()
    expect(await screen.findByRole('heading', { name: 'Nightly Research' })).toBeVisible()
    const collapsed = card()
    expect(within(collapsed).getByText('Completed')).toBeVisible()
    expect(within(collapsed).getByTitle(run().startedAt)).toHaveTextContent('Today ·')
    expect(within(collapsed).getByTitle('Run duration')).toHaveTextContent('2m 14s')

    const summary = within(collapsed).getByLabelText('Run summary')
    expect(summary).toHaveTextContent('82 discovered')
    expect(summary).toHaveTextContent('15 reviewed')
    expect(summary).toHaveTextContent('4 accepted')
    expect(summary).toHaveTextContent('4 published')
    expect(within(collapsed).getByText(/Published:/).closest('p')).toHaveTextContent('RKLB')

    // Collapsed means collapsed: no stage internals, no candidate rows.
    expect(screen.queryByText('x_discovery')).not.toBeInTheDocument()
    expect(screen.queryByText('RKLB', { selector: '.logs-symbol' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /View details/ })).toHaveAttribute('aria-expanded', 'false')
    expect(fetch).toHaveBeenCalledWith('/api/get-research?runs=1&hours=720', expect.objectContaining({
      method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer signed-token' },
    }))
  })

  /* --------------------------------------------- 2. partial, failed Claude run */
  it('reduces a failed Claude stage to one plain sentence on the card', async () => {
    serve([run({ status: 'partial', admission: null, candidates: [], stages: [
      { stage: 'x_discovery', status: 'success', durationMs: 900 },
      { stage: 'claude_review', status: 'failed', durationMs: 4200, error: { message: 'anthropic 529 overloaded' } },
    ] })])
    renderLogs()
    await ready()
    const collapsed = card()
    expect(within(collapsed).getByText('Partial')).toBeVisible()
    expect(within(collapsed).getByText('Claude review failed')).toBeVisible()
    expect(within(collapsed).getByText('Research stopped before candidate review.')).toBeVisible()
    expect(collapsed).toHaveClass('logs-run-warning')

    // One message, said once. The old page repeated the same absence four ways.
    expect(within(collapsed).queryByText(/some steps were skipped/)).not.toBeInTheDocument()
    expect(screen.queryByText(/not recorded/)).not.toBeInTheDocument()
    expect(screen.queryByText(/View candidates/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Technical details/)).not.toBeInTheDocument()
    // The exact error stays available, but not on the first screen.
    expect(screen.queryByText(/anthropic 529/)).not.toBeInTheDocument()
  })

  /* ------------------------------------------- 3. unknown counts render nothing */
  it('renders no metric at all for counts that were never recorded', async () => {
    serve([run({ status: 'failed', admission: null, candidates: [], stages: [
      { stage: 'claude_review', status: 'failed', error: { message: 'boom' } },
    ] })])
    renderLogs()
    await ready()
    const collapsed = card()
    expect(within(collapsed).queryByLabelText('Run summary')).not.toBeInTheDocument()
    expect(within(collapsed).queryByText('—')).not.toBeInTheDocument()
    expect(within(collapsed).queryByText(/= not recorded/)).not.toBeInTheDocument()
    expect(within(collapsed).getByText('Failed')).toBeVisible()
    expect(within(collapsed).getByText('Claude review failed')).toBeVisible()
  })

  /* --------------------------------------------------- 4. recorded zero is zero */
  it('keeps a recorded zero visible as zero rather than hiding it as unknown', async () => {
    serve([run({ candidates: [], admission: { funnel: { discovered: 0, eligible: 0, sentToClaude: 0, claudeAccepted: 0, published: 0 } } })])
    renderLogs()
    await ready()
    const summary = within(card()).getByLabelText('Run summary')
    expect(summary).toHaveTextContent('0 discovered')
    expect(summary).toHaveTextContent('0 published')

    await openRun()
    const funnel = screen.getByLabelText('Research admission funnel')
    expect(within(funnel).getAllByText('0', { selector: 'strong' })).toHaveLength(5)
  })

  /* ------------------------------------------ 5. zero candidates hides the area */
  it('hides the Candidates area entirely when no candidate was recorded', async () => {
    serve([run({ candidates: [] })])
    renderLogs()
    await openRun()
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Diagnostics' })).toBeVisible()
    expect(screen.queryByRole('tab', { name: /Candidates/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/No candidate details were recorded/)).not.toBeInTheDocument()
  })

  /* ------------------------------------------------------------ 6. legacy runs */
  it('stays usable for a legacy run and notes the missing metrics quietly in Diagnostics', async () => {
    serve([run({ admission: null, candidates: [] })])
    renderLogs()
    await openRun()
    // Overview still answers the basic questions; the status stays on the card.
    expect(within(card()).getByText('Completed')).toBeVisible()
    const overview = screen.getByRole('tabpanel')
    expect(within(overview).getByText('Started').nextElementSibling).toHaveTextContent('Today ·')
    expect(within(overview).getByText('Finished').nextElementSibling).toHaveTextContent('Today ·')
    expect(within(overview).getByText('Duration').nextElementSibling).toHaveTextContent('2m 14s')
    expect(screen.queryByLabelText('Research admission funnel')).not.toBeInTheDocument()
    expect(screen.queryByText(/Admission funnel unavailable/)).not.toBeInTheDocument()

    openTab('Diagnostics')
    expect(screen.getByText('Some detailed metrics were not recorded for this older run.')).toBeVisible()
  })

  /* --------------------------------------- 7. ticker search inside collapsed runs */
  it('finds candidates inside collapsed runs, including beyond a truncated group', async () => {
    const candidates = Array.from({ length: 11 }, (_, index) => ({
      ticker: `WAIT${index}`, securityId: `figi:WAIT${index}`, outcome: 'not_reviewed', sentToClaude: false,
      priority: 100 - index, overallRank: index + 1, reason: 'review_budget_exhausted',
    }))
    serve([run({ admission: null, candidates })])
    renderLogs()
    await openRun()
    openTab(/Candidates/)
    expect(screen.getByText('Show all 11 eligible candidates')).toBeVisible()
    expect(screen.getByText('WAIT10')).not.toBeVisible()

    fireEvent.change(screen.getByLabelText('Search ticker'), { target: { value: ' wait10 ' } })
    expect(screen.getByText('WAIT10')).toBeVisible()
    expect(screen.queryByText('WAIT0')).not.toBeInTheDocument()
    // Summary counts still describe the whole run, not the filtered subset.
    expect(within(card()).getByLabelText('Run summary')).toHaveTextContent('11 discovered')
  })

  /* ---------------------------------------------------- 8. time-window filtering */
  it.each([['12H', 12], ['24H', 24], ['3D', 72], ['7D', 168], ['30D', 720]])('includes the %s boundary and excludes older and future runs', async (label, hours) => {
    serve([
      run({ runId: 'boundary', startedAt: new Date(NOW - hours * 3600000).toISOString() }),
      run({ runId: 'older', startedAt: new Date(NOW - hours * 3600000 - 1).toISOString() }),
      run({ runId: 'future', startedAt: new Date(NOW + 1).toISOString() }),
    ])
    renderLogs()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(screen.getByRole('status')).toHaveTextContent('1 run ·')
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
  })

  /* ------------------------------------------------------- 9. run-type filtering */
  it.each([['Nightly Research', 'nightly-research'], ['SEC Ingestion', 'research-foundation'], ['Evaluation', 'research-evaluation'], ['Performance', 'track-performance']])('filters %s by its unchanged job ID', async (label, job) => {
    serve([run(), run({ runId: 'job', job, candidates: [], admission: null })])
    renderLogs()
    await ready()
    fireEvent.change(screen.getByLabelText('Run type'), { target: { value: label } })
    expect(screen.getAllByRole('heading', { level: 2 }).every((heading) => heading.textContent === label)).toBe(true)
    expect(screen.getByLabelText('Run type')).toHaveValue(label)
  })

  it('combines ticker, time and job filters across the full retained window', async () => {
    serve([
      run({ runId: 'recent', startedAt: new Date(NOW - 3600000).toISOString() }),
      run({ runId: 'old', startedAt: new Date(NOW - 20 * 86400000).toISOString() }),
      run({ runId: 'sec', job: 'research-foundation', startedAt: new Date(NOW - 2 * 3600000).toISOString() }),
    ])
    renderLogs()
    await ready()
    fireEvent.change(screen.getByLabelText('Search ticker'), { target: { value: 'rklb' } })
    expect(screen.getAllByText('RKLB', { selector: '.logs-symbol' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '30D' }))
    expect(screen.getAllByText('RKLB', { selector: '.logs-symbol' })).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Run type'), { target: { value: 'Nightly Research' } })
    expect(screen.getAllByText('RKLB', { selector: '.logs-symbol' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '12H' }))
    expect(screen.getAllByText('RKLB', { selector: '.logs-symbol' })).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Run type'), { target: { value: 'Performance' } })
    expect(screen.getByText(/No runs mention/)).toBeVisible()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  /* ------------------------------------------------ 10. job-specific summaries */
  it('summarizes SEC ingestion in companies and source errors, not review counts', async () => {
    serve([run({ job: 'research-foundation', admission: null, candidates: [], stages: [
      { stage: 'foundation_sync', status: 'success', durationMs: 199000, metrics: { completed: 17, pending: 0, errors: 1 } },
    ] })])
    renderLogs()
    await ready()
    const collapsed = card()
    expect(within(collapsed).getByRole('heading', { level: 2 })).toHaveTextContent('SEC Ingestion')
    expect(within(collapsed).getByLabelText('Run summary')).toHaveTextContent('17 companies processed · 1 source error')
    expect(within(collapsed).getByText('SEC ingestion completed with 1 source error')).toBeVisible()
    expect(within(collapsed).queryByText(/discovered/)).not.toBeInTheDocument()
  })

  it('summarizes evaluation in observations and performance in plain words', async () => {
    serve([
      run({ runId: 'eval', job: 'research-evaluation', admission: null, candidates: [], stages: [
        { stage: 'evaluation_snapshot', status: 'success', metrics: { observations: 12 } },
        { stage: 'evaluation_snapshot', status: 'success', metrics: { observations: 9 } },
      ] }),
      run({ runId: 'perf', job: 'track-performance', admission: null, candidates: [],
        startedAt: new Date(NOW - 3600000).toISOString(), stages: [{ stage: 'performance_tracking', status: 'success' }] }),
    ])
    renderLogs()
    await ready()
    const articles = screen.getAllByRole('article')
    const byJob = (name) => articles.find((article) => within(article).getByRole('heading', { level: 2 }).textContent === name)
    const evaluation = byJob('Evaluation')
    const performance = byJob('Performance')
    expect(within(evaluation).getByLabelText('Run summary')).toHaveTextContent('21 observations across 2 snapshots')
    expect(within(performance).queryByLabelText('Run summary')).not.toBeInTheDocument()
    expect(within(performance).getByText(/Tracks outcomes for previously published research/)).toBeVisible()
  })

  /* --------------------------------------------------- 11. Diagnostics complete */
  it('keeps every stage error, ID, cutoff and the raw record under Diagnostics', async () => {
    serve([run({ status: 'partial', stages: [
      { stage: 'x_discovery', status: 'success', durationMs: 900, metrics: { signals: 24 } },
      { stage: 'catalyst_verification', status: 'failed', durationMs: 4200, error: { message: 'exa timeout' } },
    ], evaluation: { jobId: 'job-1', status: 'failed', frozenAt: run().startedAt, error: 'evaluation_error', retryState: 'pending' } })])
    renderLogs()
    await openRun()
    openTab('Diagnostics')
    const panel = screen.getByRole('tabpanel')

    expect(within(panel).getByText('X discovery')).toBeVisible()
    expect(within(panel).getByText('x_discovery')).toBeVisible()
    expect(within(panel).getByText('exa timeout')).toBeVisible()
    expect(within(panel).getByText('run-1', { selector: 'code' })).toBeVisible()
    expect(within(panel).getByText('nightly-research · partial')).toBeVisible()
    expect(within(panel).getByText('job-1')).toBeVisible()
    expect(within(panel).getByText('evaluation_error')).toBeVisible()
    expect(within(panel).getByText('Evaluation retry state').nextElementSibling).toHaveTextContent('pending')

    // Every recorded issue is listed here, not only the primary one.
    const issues = within(panel).getByLabelText('Warnings and failures')
    expect(issues).toHaveTextContent('Catalyst verification failed')
    expect(issues).toHaveTextContent('The separate evaluation job failed')
    expect(issues).toHaveTextContent('67 eligible candidates did not receive a Claude review slot')

    // Admission budgets, reallocation and cutoffs.
    expect(within(panel).getByText(/10 \/ 10 used/)).toBeVisible()
    fireEvent.click(within(panel).getByText('Inspect candidates immediately below each cutoff'))
    expect(within(panel).getByText(/Lowest admitted: #10 ABC · priority 78/)).toBeVisible()
    expect(within(panel).getByText(/gap 1/)).toBeVisible()

    // Raw JSON is the deepest layer.
    fireEvent.click(within(panel).getByText('Complete run record'))
    expect(within(panel).getByText(/"retryState": "pending"/)).toBeVisible()
  })

  it('shows the primary issue once on the card and counts the rest', async () => {
    serve([run({ status: 'partial', candidates: [], stages: [
      { stage: 'evaluation_input_freeze', status: 'skipped', metrics: { reason: 'time_budget' } },
      { stage: 'foundation_sync', status: 'failed', error: { message: 'internal failure' } },
    ] })])
    renderLogs()
    await ready()
    const collapsed = card()
    expect(within(collapsed).getByText('SEC ingestion failed')).toBeVisible()
    expect(within(collapsed).getByText('2 additional issues')).toBeVisible()
    expect(within(collapsed).queryByText(/Evaluation snapshot was not saved/)).not.toBeInTheDocument()
    expect(screen.queryByText('time_budget')).not.toBeInTheDocument()
    expect(screen.queryByText('internal failure')).not.toBeInTheDocument()
  })

  /* --------------------------------------------------- candidate detail intact */
  it('preserves identity, admission, rank, budget, source, evidence and raw reasons', async () => {
    renderLogs()
    await openRun()
    openTab(/Candidates/)
    const candidate = candidateCard('LATE')
    expect(within(candidate).getByText('Late Holdings')).toBeVisible()
    expect(within(candidate).getByText('Eligible, not reviewed')).toBeVisible()
    expect(within(candidate).getByText('Priority').nextElementSibling).toHaveTextContent('77')
    expect(within(candidate).getByText('Overall #18')).toBeVisible()
    expect(within(candidate).getByText('Fundamentals #11')).toBeVisible()
    expect(within(candidate).getByText('SEC')).toBeVisible()
    expect(within(candidate).getByText('5, 20 sessions')).toBeVisible()
    expect(within(candidate).getByText('Admitted to review budget').nextElementSibling).toHaveTextContent('No')
    expect(within(candidate).getByText('Sent to Claude').nextElementSibling).toHaveTextContent('No')
    expect(within(candidate).getByText('Published').nextElementSibling).toHaveTextContent('No')
    expect(within(candidate).getByText('review_budget_exhausted')).not.toBeVisible()
    fireEvent.click(within(candidate).getByText('Technical details'))
    expect(within(candidate).getByText('review_budget_exhausted')).toBeVisible()
    expect(within(candidate).getByText('figi:LATE', { selector: 'code' })).toBeVisible()
    expect(within(candidate).getByText(/10\/10 reserved/)).toBeVisible()
    expect(within(candidate).getByText(/Used for admission · attention-review-priority-v2/)).toBeVisible()
    expect(within(candidate).getByText('Legacy priority').nextElementSibling).toHaveTextContent('77')
    expect(within(candidate).getByText('Overall #12')).toBeVisible()
    expect(within(candidate).getByText('Fundamentals #9')).toBeVisible()
    fireEvent.click(within(candidate).getByText('1 evidence item'))
    expect(within(candidate).getByText(/10-Q/, { selector: 'li' })).toBeVisible()
    expect(within(candidate).getByText('ev-late')).toBeVisible()
  })

  it('makes the first candidate row scannable and keeps the full record one level down', async () => {
    renderLogs()
    await openRun()
    openTab(/Candidates/)
    const row = screen.getByText('RKLB', { selector: '.logs-symbol' }).closest('summary')
    expect(row).toHaveTextContent('Attention · priority 68 · Claude 84 · final #2')
    expect(row).toHaveTextContent('Published')

    const candidate = candidateCard('RKLB')
    expect(within(candidate).getByText('Sent to Claude').nextElementSibling).toHaveTextContent('Yes')
    expect(within(candidate).getByText('Accepted')).toBeVisible()
    expect(within(candidate).getByText('Score 84')).toBeVisible()
    expect(within(candidate).getByText('Verified')).toBeVisible()
    fireEvent.click(within(candidate).getByText('Technical details'))
    expect(within(candidate).getByText(/Evidence quality \+20/)).toBeVisible()
    expect(within(candidate).getByText('Legacy priority').nextElementSibling).toHaveTextContent('100')
    fireEvent.click(within(candidate).getByText('Complete candidate record'))
    expect(within(candidate).getByText(/"securityId": "figi:RKLB"/)).toBeVisible()
  })

  /* ------------------------------------------------------ keyboard / structure */
  it('exposes the three areas as a keyboard-navigable tablist', async () => {
    renderLogs()
    await openRun()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'Candidates · 2', 'Diagnostics'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' })
    expect(screen.getAllByRole('tab')[2]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'run-1-tab-diagnostics')

    fireEvent.click(screen.getByRole('button', { name: /Hide details/ }))
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('names each status in words, not by colour alone', async () => {
    serve([run({ status: 'partial', candidates: [], admission: null, stages: [{ stage: 'claude_review', status: 'failed' }] })])
    renderLogs()
    await ready()
    const badge = within(card()).getByText('Partial')
    expect(badge).toHaveClass('logs-tone-warning')
    expect(badge.textContent).toContain('Partial')
  })

  /* --------------------------------------------------------- 12. owner-only UX */
  it('redirects without fetching when a session cannot prove ownership', async () => {
    auth.user = { uid: 'preview' }
    renderLogs()
    expect(await screen.findByText('PORTFOLIO')).toBeInTheDocument()
    expect(screen.queryByText(/Research activity/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Private · Read only/)).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('redirects away when the API denies access', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Owner access required' }) })
    renderLogs()
    expect(await screen.findByText('PORTFOLIO')).toBeInTheDocument()
    expect(screen.queryByText(/Research activity/)).not.toBeInTheDocument()
  })

  it('never renders the page title while ownership is still being checked', () => {
    renderLogs()
    expect(screen.queryByText(/Research activity/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Private · Read only/)).not.toBeInTheDocument()
  })

  it('says plainly when no run has been recorded in the available window', async () => {
    serve([])
    renderLogs()
    expect(await screen.findByText(/No research runs recorded in the last 30 days/)).toBeVisible()
  })

  it('keeps the evaluation handoff on the overview', async () => {
    serve([run({ evaluation: { jobId: 'job-1', status: 'completed', frozenAt: run().startedAt } })])
    renderLogs()
    await openRun()
    const handoff = screen.getByLabelText('Evaluation handoff')
    expect(within(handoff).getByText('Evaluation input').nextElementSibling).toHaveTextContent('Frozen')
    expect(within(handoff).getByText('Evaluation job').nextElementSibling).toHaveTextContent('Completed')
  })

  it('says when evaluation inputs were never frozen', async () => {
    renderLogs()
    await openRun()
    expect(screen.getByText(/not frozen/)).toBeVisible()
  })

  /* ---------------------------------------------------------- 13. responsive UX */
  it('keeps a mobile layout for the toolbar, funnel, facts and wide tables', () => {
    // Read from disk: vitest stubs CSS imports, so the rule text is the
    // only way to assert the responsive contract still exists.
    const css = readFileSync('src/pages/ResearchLogs.css', 'utf8')
    const mobile = css.slice(css.indexOf('@media (max-width: 640px)'))
    expect(mobile).not.toBe('')
    // Multi-column grids collapse, the funnel stacks, the search takes its own row.
    expect(mobile).toContain('.logs-facts { grid-template-columns: minmax(0, 1fr); }')
    expect(mobile).toContain('.logs-funnel { flex-direction: column;')
    expect(mobile).toContain(".logs-funnel-arrow::before { content: '↓'; }")
    expect(mobile).toContain('.logs-search { flex: 1 1 100%; }')
    // Touch targets stay at least 40px on the controls that shrink on desktop.
    expect(mobile).toContain('.logs-segmented button, .logs-tablist button, .logs-expand { min-height: 40px; }')
    // The toolbar wraps instead of overflowing, and only tables scroll sideways.
    expect(css).toContain('.logs-toolbar { display: flex; flex-wrap: wrap;')
    expect(css).toContain('.logs-table-wrap { overflow-x: auto;')
  })
})
