import { Redis } from '@upstash/redis'
import { randomUUID } from 'node:crypto'
import { createArchive } from '../src/server/research/archive.js'
import { loadFoundation } from '../src/server/research/foundation.js'
import { prepareEvaluation, freezeEvaluation } from '../src/server/research/evaluation.js'
import {
  EVALUATION_JOB_MAX_ATTEMPTS,
  deserializeEvaluationInputs,
  markJobCompleted,
  markJobFailed,
  markJobStarted,
  pendingEvaluationJobs,
} from '../src/server/research/evaluationJob.js'
import { STAGES, recordResearchRun, researchLog, skipStage, stage } from '../src/server/research/observability.js'
import { createCronBudget, withinCronBudget } from '../src/server/research/runtimeBudget.js'

// Same headroom the six-arm review always needed — it just no longer has to
// fit inside nightly-research's own budget. This cron has the full 300s.
const EVALUATION_MINIMUM_MS = 90_000

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return false
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
}

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return Redis.fromEnv()
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const redis = getRedis()
  if (!redis) return res.status(503).json({ error: 'Redis not configured' })

  const startedAt = Date.now()
  const budget = createCronBudget({ startedAt })
  const lock = 'research:evaluation:lock:v1', token = randomUUID()
  if (!await redis.set(lock, token, { nx: true, ex: 360 })) return res.status(409).json({ error: 'Evaluation already running' })
  try {
    return await recordResearchRun(redis, { job: 'research-evaluation' }, () => stage(STAGES.evaluation_job, () => runPending(redis, budget, res)))
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [lock], [token])
  }
}

async function runPending(redis, budget, res) {
  const archive = createArchive(redis)
  let master
  try { ({ master } = await loadFoundation({ redis, archive, refresh: false })) }
  catch (error) { return res.status(503).json({ error: `Security master unavailable: ${error.message}` }) }

  const jobs = await pendingEvaluationJobs(archive, Date.now())
  const results = []
  for (const job of jobs) {
    if (!budget.canStart(EVALUATION_MINIMUM_MS)) {
      skipStage(STAGES.evaluation_snapshot, 'time_budget', { availableMs: budget.availableMs(), jobId: job.jobId })
      results.push({ jobId: job.jobId, status: 'deferred' })
      continue
    }
    results.push(await processJob(archive, master, budget, job))
  }
  console.log(`[research-evaluation] processed ${results.length} job(s)`)
  return res.status(200).json({ processed: results.length, results })
}

async function processJob(archive, master, budget, job) {
  const started = await markJobStarted(archive, job)
  researchLog({ event: 'evaluation_started', stage: STAGES.evaluation_snapshot, metrics: { jobId: job.jobId, attempt: started.attempt } })
  try {
    const input = await archive.get('evaluation-job-input', job.jobId)
    const publication = await archive.get('publication', job.publicationId)
    if (!publication) throw new Error('Publication record unavailable for this evaluation job')
    const evaluationInputs = deserializeEvaluationInputs(input.evaluationInputs)

    const evaluationRun = await stage(STAGES.evaluation_snapshot, () => withinCronBudget(budget, 'Evaluation snapshot', async (signal, timeout) => {
      const snapshot = await prepareEvaluation(evaluationInputs, { archive, master, requestOptions: { signal, timeout } })
      return freezeEvaluation(archive, snapshot, publication)
    }), { metrics: (run) => ({ jobId: job.jobId, observations: run.observations.length }) })

    await archive.put('evaluation-delivery', evaluationRun.id, { runId: evaluationRun.id, availableAt: new Date().toISOString() }, 'evaluation-deliveries')

    const byArm = new Map()
    for (const observation of evaluationRun.observations) {
      const bucket = byArm.get(observation.arm) || { arm: observation.arm, accepted: 0, rejected: 0, total: 0 }
      bucket.total++
      bucket[observation.status === 'accepted' ? 'accepted' : 'rejected']++
      byArm.set(observation.arm, bucket)
    }
    for (const bucket of byArm.values()) researchLog({ event: 'evaluation_arm_completed', stage: STAGES.evaluation_snapshot, metrics: bucket })

    await markJobCompleted(archive, job.jobId, started.attempt, { resultRunId: evaluationRun.id })
    researchLog({ event: 'evaluation_completed', stage: STAGES.evaluation_snapshot, metrics: { jobId: job.jobId, runId: evaluationRun.id, arms: byArm.size } })
    return { jobId: job.jobId, status: 'completed', runId: evaluationRun.id }
  } catch (error) {
    await markJobFailed(archive, job.jobId, started.attempt, { error })
    const retrying = started.attempt < EVALUATION_JOB_MAX_ATTEMPTS
    researchLog({ level: 'error', event: retrying ? 'evaluation_retry_scheduled' : 'evaluation_failed',
      stage: STAGES.evaluation_snapshot, error, metrics: { jobId: job.jobId, attempt: started.attempt } })
    return { jobId: job.jobId, status: 'failed', error: error.message }
  }
}
