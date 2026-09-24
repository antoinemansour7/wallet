const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// Every research job fires at minute 0 of its hours, in UTC. The grace period
// dates from Vercel Hobby cron, whose runs arrived up to an hour late; QStash
// now fires on the minute, but absence stays actionable only after the same
// window so a slow run is not reported as a missing one.
export const RESEARCH_SCHEDULE_GRACE_MS = 90 * 60 * 1000

// The one definition of when each research job runs and which route it calls.
// src/server/qstashSchedules.js installs a QStash schedule from each entry, and
// the health check below reads the same hours, so the two cannot drift.
export const RESEARCH_SCHEDULES = Object.freeze([
  { job: 'research-foundation', path: '/api/research-foundation', hours: [1, 4, 10, 13, 16, 19, 22] },
  { job: 'nightly-research', path: '/api/nightly-research', hours: [7] },
  // Same function as the nightly run; the mode is what selects the report job.
  // Reports are written one at a time and eight do not fit one 300s run, so the
  // job fires four times in its hour; each run resumes whatever is still pending.
  { job: 'research-reports', path: '/api/nightly-research?mode=reports', hours: [9], minutes: [0, 15, 30, 45] },
  { job: 'track-performance', path: '/api/track-performance', hours: [9] },
  { job: 'research-evaluation', path: '/api/research-evaluation', hours: [11] },
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
