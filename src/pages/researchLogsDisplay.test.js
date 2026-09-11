import { describe, expect, it } from 'vitest'
import { friendlyTime, stageName, summaryCounts, runDescription, runWarnings } from './researchLogsDisplay'

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
    ['claude_review', 'Claude review'], ['evaluation_input_freeze', 'Save evaluation snapshot'],
    ['performance_tracking', 'Performance tracking'],
  ])('translates %s for display', (internal, label) => expect(stageName(internal)).toBe(label))

  it('summarizes ingestion and evaluation using their recorded units, not candidate review counts', () => {
    expect(runDescription({ job: 'research-foundation', stages: [{ stage: 'foundation_sync', metrics: { completed: 12 } }] })).toContain('SEC filings processed for 12 companies.')
    expect(runDescription({ job: 'research-evaluation', stages: [
      { stage: 'evaluation_snapshot', metrics: { observations: 3 } },
      { stage: 'evaluation_snapshot', metrics: { observations: 5 } },
    ] })).toBe('Evaluation recorded 8 observations across 2 snapshots.')
  })

  it('counts reviewed SEC/fundamental candidates once and excludes eligible candidates never sent', () => {
    const run = { admission: { funnel: { discovered: 90, sentToClaude: 8, published: 2 } }, candidates: [
      { sources: ['SEC'], strategies: ['fundamentals', 'filing_changes'], sentToClaude: true },
      { sources: ['News'], strategies: ['insider'], reviewed: true },
      { sources: ['SEC'], strategies: ['fundamentals'], sentToClaude: false, reviewed: true },
      { sources: ['X / attention'], strategies: ['attention'], sentToClaude: true },
    ] }
    expect(summaryCounts(run).map(([, value]) => value)).toEqual([90, 8, 2, 2])
  })

  it('distinguishes unavailable metrics from recorded zeroes', () => {
    expect(summaryCounts({ candidates: [] }).map(([, value]) => value)).toEqual([null, null, null, null])
    expect(summaryCounts({ admission: { funnel: { discovered: 0, sentToClaude: 0, published: 0 } } }).map(([, value]) => value)).toEqual([0, 0, 0, 0])
  })

  it('surfaces failed runs, degraded stages and source errors even when a stage reports success', () => {
    const warnings = runWarnings({ status: 'failed', stages: [
      { stage: 'x_discovery', status: 'degraded' },
      { stage: 'foundation_sync', status: 'success', metrics: { errors: 2 } },
      { stage: 'evaluation_input_freeze', status: 'skipped', metrics: { reason: 'inputs_unavailable' } },
    ] })
    expect(warnings).toContain('This run stopped because of a failure. Some work may be incomplete.')
    expect(warnings).toContain('X discovery completed with reduced coverage.')
    expect(warnings).toContain('SEC ingestion reported 2 errors. See Technical details.')
    expect(warnings).toContain('Save evaluation snapshot was skipped because the required inputs were unavailable.')
  })
})
