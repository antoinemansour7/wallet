// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { RESEARCH_SCHEDULE_GRACE_MS, RESEARCH_SCHEDULES, researchScheduleHealth } from './scheduleHealth.js'

const at = (iso) => Date.parse(iso)
const run = (job, startedAt) => ({ job, startedAt })

describe('researchScheduleHealth', () => {
  it('reports a grace-expired nightly slot when only an earlier manual run exists', () => {
    const health = researchScheduleHealth([
      run('nightly-research', '2026-09-16T02:44:46.296Z'),
      run('track-performance', '2026-09-16T09:42:28.113Z'),
      run('research-foundation', '2026-09-16T10:45:40.727Z'),
    ], at('2026-09-16T10:50:00.000Z'))

    expect(health.missing).toContainEqual(expect.objectContaining({
      job: 'nightly-research',
      expectedAt: '2026-09-16T07:00:00.000Z',
      lastRunAt: '2026-09-16T02:44:46.296Z',
    }))
    expect(health.missing.map((item) => item.job)).not.toContain('track-performance')
    expect(health.missing.map((item) => item.job)).not.toContain('research-foundation')
  })

  it('accepts a delayed run inside the operational window once it is recorded', () => {
    const health = researchScheduleHealth([
      run('nightly-research', '2026-09-16T07:52:00.000Z'),
      run('track-performance', '2026-09-16T09:42:00.000Z'),
      run('research-foundation', '2026-09-16T10:45:00.000Z'),
    ], at('2026-09-16T10:50:00.000Z'))

    expect(health.missing.map((item) => item.job)).not.toContain('nightly-research')
  })

  it('does not call a slot missing until its grace period has ended', () => {
    const before = researchScheduleHealth([], at('2026-09-16T08:29:59.999Z'))
    const after = researchScheduleHealth([], at('2026-09-16T08:30:00.000Z'))

    expect(before.missing.find((item) => item.job === 'nightly-research')?.expectedAt).toBe('2026-09-15T07:00:00.000Z')
    expect(after.missing.find((item) => item.job === 'nightly-research')?.expectedAt).toBe('2026-09-16T07:00:00.000Z')
    expect(RESEARCH_SCHEDULE_GRACE_MS).toBe(90 * 60 * 1000)
  })

  it('keeps every research job on the UTC hour and route it had as a Vercel cron', () => {
    // The eleven vercel.json entries these replaced, one per (path, hour).
    const former = [
      ...[1, 4, 10, 13, 16, 19, 22].map((hour) => ['/api/research-foundation', hour]),
      ['/api/nightly-research', 7], ['/api/nightly-research?mode=reports', 9],
      ['/api/track-performance', 9], ['/api/research-evaluation', 11],
    ]
    expect(RESEARCH_SCHEDULES.flatMap(({ path, hours }) => hours.map((hour) => [path, hour]))).toEqual(former)
    expect(RESEARCH_SCHEDULES.map((entry) => entry.job)).toEqual(['research-foundation', 'nightly-research', 'research-reports', 'track-performance', 'research-evaluation'])
  })

  it('opens the research cycle at the nightly run', async () => {
    const { DEFAULT_CYCLE_HOUR_UTC } = await import('../researchCycle.js')
    expect(RESEARCH_SCHEDULES.find((entry) => entry.job === 'nightly-research').hours).toEqual([DEFAULT_CYCLE_HOUR_UTC])
  })
})
