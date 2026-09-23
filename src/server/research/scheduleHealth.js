const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// Vercel invokes cron schedules in UTC. Production runs have arrived as much
// as an hour after their declared minute, so absence is actionable only after
// a deliberately wider grace period.
export const RESEARCH_SCHEDULE_GRACE_MS = 90 * 60 * 1000

// Keep this small operational view beside the run log. The deployment test
// below protects it from drifting away from vercel.json.
export const RESEARCH_SCHEDULES = Object.freeze([
  { job: 'research-foundation', hours: [1, 4, 10, 13, 16, 19, 22] },
  { job: 'nightly-research', hours: [7] },
  { job: 'research-reports', hours: [9] },
  { job: 'track-performance', hours: [9] },
  { job: 'research-evaluation', hours: [11] },
])

function latestExpectedAt(hours, cutoff) {
  const day = Math.floor(cutoff / DAY_MS) * DAY_MS
  const candidates = hours.flatMap((hour) => [day + hour * HOUR_MS, day - DAY_MS + hour * HOUR_MS])
  return Math.max(...candidates.filter((time) => time <= cutoff))
}

const runTime = (run) => Date.parse(run?.startedAt || run?.at)

/**
 * Report scheduled jobs whose latest grace-expired slot has no recorded run.
 * A manual recovery after the slot counts: the operational question is
 * whether the job executed after it became due, not who invoked it.
 */
export function researchScheduleHealth(runs = [], now = Date.now(), { graceMs = RESEARCH_SCHEDULE_GRACE_MS } = {}) {
  const cutoff = now - graceMs
  const validRuns = runs.map((run) => ({ ...run, time: runTime(run) })).filter((run) => Number.isFinite(run.time) && run.time <= now)
  const missing = RESEARCH_SCHEDULES.flatMap(({ job, hours }) => {
    const expectedAt = latestExpectedAt(hours, cutoff)
    const matching = validRuns.filter((run) => run.job === job)
    if (matching.some((run) => run.time >= expectedAt)) return []
    const lastRunAt = matching.length ? Math.max(...matching.map((run) => run.time)) : null
    return [{
      job,
      expectedAt: new Date(expectedAt).toISOString(),
      graceEndedAt: new Date(expectedAt + graceMs).toISOString(),
      lastRunAt: lastRunAt === null ? null : new Date(lastRunAt).toISOString(),
    }]
  })
  return {
    checkedAt: new Date(now).toISOString(),
    graceMinutes: Math.round(graceMs / 60000),
    missing,
  }
}
