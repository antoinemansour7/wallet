// ─── Persistent run logging ────────────────────────────────────────────────────
// Vercel Hobby retains runtime logs for ~1 hour, so 3 AM cron output is gone
// by morning. Each cron run writes a structured summary to Redis (30-day
// window) — monitoring without new services.

import { Redis } from '@upstash/redis'

const RUNS_KEY = 'logs:runs'
const MAX_RUNS = 90

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

export function buildRunSummary(job, startedAt, { errors = [], ...stats } = {}) {
  return {
    job,
    at: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    ok: errors.length === 0,
    errors,
    ...stats,
  }
}

/** Persist a run summary; call once at the end of each cron handler. */
export async function recordRun(job, startedAt, stats = {}) {
  const run = buildRunSummary(job, startedAt, stats)
  console.log(`[runLog] ${job}: ${run.ok ? 'OK' : `${run.errors.length} ERROR(S)`} in ${run.durationMs}ms`)

  const redis = getRedis()
  if (redis) {
    try {
      await redis.lpush(RUNS_KEY, JSON.stringify(run))
      await redis.ltrim(RUNS_KEY, 0, MAX_RUNS - 1)
    } catch (err) {
      console.error('[runLog] persist failed:', err.message)
    }
  }

  return run
}

/** Recent run history, newest first. */
export async function getRecentRuns(limit = 30) {
  const redis = getRedis()
  if (!redis) return []
  const raw = await redis.lrange(RUNS_KEY, 0, limit - 1)
  return (raw || []).map((entry) => {
    try { return typeof entry === 'string' ? JSON.parse(entry) : entry } catch { return null }
  }).filter(Boolean)
}

/**
 * Extend the same pattern to a request-driven route instead of a cron job.
 * recordRun already does the work; this just calls it at the right moments
 * around a Vercel handler, so nine call sites become the same wrapper instead
 * of nine slightly different copies of the same try/catch/finally.
 *
 * Most of these handlers already catch their own errors and answer with a
 * non-2xx status rather than throwing, so a plain try/catch around the call
 * would rarely see anything — the response's own status is what actually
 * says whether the request succeeded. A 4xx (bad input, unauthorized, rate
 * limited) is ordinary traffic, not a failure worth recording; a 5xx or
 * an uncaught throw is the same class of thing #33 already treats as
 * cron-worthy, so that's the line this draws too.
 */
export function withRunLog(job, handler) {
  return async function wrapped(req, res) {
    const startedAt = Date.now()
    try {
      const result = await handler(req, res)
      const statusCode = res.statusCode ?? 200
      const errors = statusCode >= 500
        ? [{ step: job, error: `Handler returned ${statusCode}` }]
        : []
      await recordRun(job, startedAt, { errors, statusCode })
      return result
    } catch (err) {
      await recordRun(job, startedAt, { errors: [{ step: job, error: err.message }], statusCode: 500 })
      throw err
    }
  }
}
