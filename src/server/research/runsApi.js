import { Redis } from '@upstash/redis'
import { verifyOwner } from './evaluationApi.js'
import { RESEARCH_RUNS_KEY } from './observability.js'

const DEFAULT_LIMIT = 30

// One malformed entry is a lost record, not a lost history.
function parseRun(entry) {
  try {
    return typeof entry === 'string' ? JSON.parse(entry) : entry
  } catch {
    return null
  }
}

// Mounted on the existing research API to stay within the deployment's
// function limit, and gated by the same owner check as the evaluation view:
// stage errors and rejection reasons are internal research data.
export default async function runsHandler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Vary', 'Authorization')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const caller = await verifyOwner(req)
  if (caller.error) return res.status(caller.status).json({ error: caller.error })
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(503).json({ error: 'Run history is unavailable' })
  }

  try {
    const stored = await Redis.fromEnv().lrange(RESEARCH_RUNS_KEY, 0, DEFAULT_LIMIT - 1)
    const runs = (stored || []).map(parseRun).filter(Boolean)

    const ticker = String(req.query?.ticker || '').trim().toUpperCase()
    if (!ticker) return res.status(200).json({ runs })

    // A trace carries the run it came from, so one ticker's path can be read
    // across several runs without opening each of them.
    const traces = runs.flatMap((run) => (run.candidates || [])
      .filter((candidate) => candidate.ticker === ticker)
      .map((candidate) => ({ ...candidate, runId: run.runId, job: run.job, startedAt: run.startedAt })))
    return res.status(200).json({ runs, traces })
  } catch {
    return res.status(503).json({ error: 'Run history is unavailable' })
  }
}
