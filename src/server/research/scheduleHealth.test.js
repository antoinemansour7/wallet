// @vitest-environment node
import { describe, expect, it } from 'vitest'
import config from '../../../vercel.json'
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

  it('stays aligned with every research cron declared in vercel.json', () => {
    const expected = RESEARCH_SCHEDULES.flatMap(({ job, hours }) => hours.map((hour) => ({
      path: {
        'research-foundation': '/api/research-foundation',
        'nightly-research': '/api/nightly-research',
        'track-performance': '/api/track-performance',
        'research-evaluation': '/api/research-evaluation',
      }[job],
      schedule: `0 ${hour} * * *`,
    })))
    const actual = config.crons.filter((entry) => entry.path.startsWith('/api/research-'))
      .concat(config.crons.filter((entry) => entry.path === '/api/nightly-research' || entry.path === '/api/track-performance'))

    expect(expected).toEqual(expect.arrayContaining(actual))
    expect(actual).toEqual(expect.arrayContaining(expected))
  })
})
