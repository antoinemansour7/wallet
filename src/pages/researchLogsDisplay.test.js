import { describe, expect, it } from 'vitest'
import {
  duration, friendlyTime, isLegacyRun, primaryIssue, publishedTickers, runFunnel, runIssues,
  runSummary, scheduleAlert, stageName, statusName, statusTone,
} from './researchLogsDisplay'

describe('research log presentation', () => {
  it('formats local calendar dates and handles missing or invalid timestamps', () => {
    const now = new Date(2026, 8, 10, 12).getTime()
    expect(friendlyTime(new Date(2026, 8, 10, 3, 21).toISOString(), now)).toBe('Today · 3:21 AM')
    expect(friendlyTime(new Date(2026, 8, 9, 23, 59).toISOString(), now)).toBe('Yesterday · 11:59 PM')
    expect(friendlyTime(new Date(2026, 8, 1, 3, 21).toISOString(), now)).toBe('Sep 1 · 3:21 AM')
    expect(friendlyTime(new Date(2025, 8, 1, 3, 21).toISOString(), now)).toBe('Sep 1, 2025 · 3:21 AM')
    expect(friendlyTime('invalid', now)).toBe('Time unavailable')
    expect(friendlyTime(null, now)).toBe('Time unavailable')
  })

  it.each([
    ['x_discovery', 'X discovery'], ['foundation_sync', 'SEC ingestion'],
    ['claude_review', 'Candidate review'], ['evaluation_input_freeze', 'Save evaluation snapshot'],
    ['performance_tracking', 'Performance tracking'],
  ])('translates %s for display', (internal, label) => expect(stageName(internal)).toBe(label))

  it.each([
    [275000, '4m 35s'], [146000, '2m 26s'], [19400, '19s'], [3725000, '1h 2m'],
  ])('renders %i ms as a human duration', (ms, text) => expect(duration(ms)).toBe(text))

  it('returns no duration rather than a placeholder when it was never recorded', () => {
    expect(duration(undefined)).toBeNull()
    expect(duration(null)).toBeNull()
  })

  // A partial run named "Completed with gaps" read healthier than its warning.
  it('names and tones each status without dressing a partial run as a success', () => {
    expect(statusName('success')).toBe('Completed')
    expect(statusName('partial')).toBe('Partial')
    expect(statusName('failed')).toBe('Failed')
    expect(statusTone('success')).toBe('positive')
    expect(statusTone('partial')).toBe('warning')
    expect(statusTone('failed')).toBe('negative')
    expect(statusTone('skipped')).toBe('muted')
  })

  describe('primary run message', () => {
    it('leads with the failed stage and says plainly what it was', () => {
      const issue = primaryIssue({ status: 'partial', candidates: [], stages: [
        { stage: 'x_discovery', status: 'success' },
        { stage: 'claude_review', status: 'failed', error: { message: 'anthropic 529' } },
      ] })
      expect(issue.headline).toBe('Candidate review failed')
      expect(issue.detail).toBe('Research stopped before candidate review.')
    })

    it('maps a skipped evaluation freeze to the reason it was skipped for', () => {
      expect(primaryIssue({ status: 'partial', stages: [
        { stage: 'evaluation_input_freeze', status: 'skipped', metrics: { reason: 'time_budget' } },
      ] }).headline).toBe('Evaluation snapshot was not saved because the run ran out of time')
      expect(primaryIssue({ status: 'partial', stages: [
        { stage: 'evaluation_input_freeze', status: 'skipped', metrics: { reason: 'inputs_unavailable' } },
      ] }).headline).toBe('Evaluation snapshot was not saved because its inputs were unavailable')
    })

    it('counts recorded source errors on a stage that still reports success', () => {
      expect(primaryIssue({ status: 'success', stages: [
        { stage: 'foundation_sync', status: 'success', metrics: { completed: 17, errors: 1 } },
      ] }).headline).toBe('SEC ingestion completed with 1 source error')
    })

    it('falls back to the stage name rather than inventing a cause', () => {
      expect(primaryIssue({ status: 'partial', stages: [
        { stage: 'report_generation', status: 'skipped', metrics: { reason: 'something_new' } },
      ] }).headline).toBe('Report generation was skipped')
    })

    it('says a fatal run failed even when no stage recorded the failure', () => {
      const issue = primaryIssue({ status: 'failed', stages: [] })
      expect(issue.headline).toBe('The run stopped because of a failure')
      expect(issue.detail).toContain('Diagnostics')
    })

    it('ranks failures above skips, and skips above budget and evaluation notes', () => {
      const headlines = runIssues({
        status: 'partial',
        evaluation: { status: 'failed' },
        admission: { funnel: { notReviewed: 67 } },
        stages: [
          { stage: 'evaluation_input_freeze', status: 'skipped', metrics: { reason: 'time_budget' } },
          { stage: 'claude_review', status: 'failed' },
        ],
      }).map((issue) => issue.headline)
      expect(headlines[0]).toBe('Candidate review failed')
      expect(headlines[1]).toBe('Evaluation snapshot was not saved because the run ran out of time')
      expect(headlines.slice(2)).toEqual([
        'The separate evaluation job failed',
        '67 eligible candidates did not receive a model review slot',
      ])
    })

    it('reports nothing at all for a clean run', () => {
      expect(runIssues({ status: 'success', stages: [{ stage: 'x_discovery', status: 'success' }] })).toEqual([])
      expect(primaryIssue({ status: 'success', stages: [] })).toBeNull()
    })
  })

  describe('funnel and summary', () => {
    it('drops steps that were never recorded instead of rendering a placeholder', () => {
      expect(runFunnel({ admission: { funnel: { discovered: 85, eligible: 85, sentToClaude: 30 } } }))
        .toEqual([['Discovered', 85], ['Eligible', 85], ['Reviewed', 30]])
      expect(runFunnel({ admission: null })).toBeNull()
      expect(runFunnel({ admission: { funnel: {} } })).toBeNull()
    })

    it('keeps a recorded zero as zero and never turns an absent count into one', () => {
      expect(runFunnel({ admission: { funnel: { discovered: 0, published: 0 } } }))
        .toEqual([['Discovered', 0], ['Published', 0]])
      expect(runSummary({ job: 'nightly-research', admission: null, candidates: [] }).steps).toEqual([])
    })

    it('summarizes nightly research as its review funnel', () => {
      expect(runSummary({ job: 'nightly-research', admission: { funnel: { discovered: 85, sentToClaude: 30, claudeAccepted: 4, published: 3 } } }).steps)
        .toEqual([['discovered', 85], ['reviewed', 30], ['accepted', 4], ['published', 3]])
    })

    it('summarizes ingestion, evaluation and performance in their own units', () => {
      expect(runSummary({ job: 'research-foundation', stages: [
        { stage: 'foundation_sync', metrics: { completed: 17, errors: 1 } },
      ] }).facts).toEqual(['17 companies processed', '1 source error'])
      expect(runSummary({ job: 'research-evaluation', stages: [
        { stage: 'evaluation_snapshot', metrics: { observations: 3 } },
        { stage: 'evaluation_snapshot', metrics: { observations: 5 } },
      ] }).facts).toEqual(['8 observations across 2 snapshots'])
      const performance = runSummary({ job: 'track-performance', stages: [{ stage: 'performance_tracking' }] })
      expect(performance.facts).toEqual([])
      expect(performance.note).toContain('Tracks outcomes')
    })

    it('never borrows nightly research metrics for another job', () => {
      const sec = runSummary({ job: 'research-foundation', stages: [], candidates: [{ outcome: 'published' }] })
      expect(sec.steps).toBeUndefined()
      expect(sec.facts).toEqual([])
    })

    it('lists published tickers and recognises a legacy nightly record', () => {
      expect(publishedTickers({ candidates: [
        { ticker: 'META', outcome: 'published' }, { ticker: 'GME', outcome: 'published' },
        { ticker: 'LATE', outcome: 'not_reviewed' },
      ] })).toEqual(['META', 'GME'])
      expect(isLegacyRun({ job: 'nightly-research', admission: null, candidates: [] })).toBe(true)
      expect(isLegacyRun({ job: 'nightly-research', admission: { funnel: { discovered: 1 } }, candidates: [] })).toBe(false)
    })
  })

  describe('missed schedule alert', () => {
    it('stays silent when every slot produced a run', () => {
      expect(scheduleAlert(undefined)).toBeNull()
      expect(scheduleAlert({ missing: [] })).toBeNull()
    })

    it('names how many slots were missed and how long the grace period was', () => {
      const one = scheduleAlert({ graceMinutes: 90, missing: [{ job: 'nightly-research', expectedAt: 'x' }] })
      expect(one.headline).toBe('A scheduled research run did not arrive')
      expect(one.detail).toBe('Nothing was recorded 90 minutes after the scheduled slot.')
      expect(scheduleAlert({ graceMinutes: 90, missing: [{ job: 'a' }, { job: 'b' }] }).headline)
        .toBe('2 scheduled research runs did not arrive')
    })

    it('drops the grace figure rather than inventing one', () => {
      expect(scheduleAlert({ missing: [{ job: 'nightly-research' }] }).detail)
        .toBe('Nothing was recorded after the scheduled slot.')
    })
  })
})
