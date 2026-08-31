// ─── Persistent run logging ────────────────────────────────────────────────────
// Vercel Hobby retains runtime logs for ~1 hour, so 3 AM cron output is gone
// by morning. Each cron run writes a structured summary to Redis (30-day
// window) and failures push a Slack alert — monitoring without new services.

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

async function alertSlackOnFailure(run) {
  const token = process.env.SLACK_BOT_TOKEN
  const channel = process.env.SLACK_CHANNEL_ID
  if (!token || !channel || run.ok) return

  const errorList = run.errors.map((e) => `• *${e.step || e.name}*: ${e.error}`).join('\n')
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel,
        text: `⚠️ ${run.job} run finished with ${run.errors.length} error(s)`,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `⚠️ *${run.job}* run at ${run.at} — ${run.errors.length} error(s), ${Math.round(run.durationMs / 1000)}s\n${errorList}` },
        }],
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    console.error('[runLog] slack alert failed:', err.message)
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

  await alertSlackOnFailure(run)
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
