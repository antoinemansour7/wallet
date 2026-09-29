// One-time additive migration and optional recovery after deploying OpenAI evals.
// node --env-file=.env scripts/repair-research-evaluation.mjs [--retry-latest]
import { Redis } from '@upstash/redis'
import { createArchive } from '../src/server/research/archive.js'
import { evaluationObservations } from '../src/server/research/evaluationPerformance.js'
import { latestEvaluationJob, requeueEvaluationJob } from '../src/server/research/evaluationJob.js'
import { refreshEvaluationSummary } from '../src/server/research/evaluationSummary.js'

const redis = Redis.fromEnv(), archive = createArchive(redis), now = Date.now()
if (!await archive.get('evaluation-index', 'accepted-outcomes-v1')) {
  const { observations } = await evaluationObservations(archive, now)
  const accepted = new Set(observations.filter((o) => o.status === 'accepted').map((o) => o.id))
  console.log(`Indexing outcomes for ${accepted.size} accepted observations`)
  let indexed = 0
  const total = await redis.zcount('research:archive:v1:index:evaluation-outcomes', '-inf', now)
  for (let offset = 0; offset < total; offset += 500) {
    const records = await archive.list('evaluation-outcomes', now, { offset, count: 500 })
    if (records.length !== Math.min(500, total - offset)) throw new Error('Outcome archive is incomplete; refusing to mark the index ready')
    const batch = records.filter((o) => accepted.has(o.observationId))
    if (batch.length) {
      const pipeline = redis.pipeline()
      for (const record of batch) {
        if (!record.id) throw new Error('Outcome is missing its immutable ID')
        pipeline.zadd('research:archive:v1:index:evaluation-accepted-outcomes', {
          score: Date.parse(record.availableAt), member: `research:archive:v1:evaluation-outcome:${record.id}`,
        })
      }
      await pipeline.exec()
      indexed += batch.length
    }
  }
  await archive.put('evaluation-index', 'accepted-outcomes-v1', { availableAt: new Date(now).toISOString(), indexed }, 'evaluation-index')
  console.log(`Indexed ${indexed} outcome records; historical records preserved`)
}
if (process.argv.includes('--retry-latest')) {
  const job = await latestEvaluationJob(archive)
  const run = job?.resultRunId ? await archive.get('evaluation-run', job.resultRunId) : null
  if (job && (job.status === 'failed' || (job.status === 'completed' && run?.failures?.some(Boolean)))) {
    await requeueEvaluationJob(archive, job)
    console.log(`Queued recovery for ${job.jobId}`)
  } else console.log('No failed latest review to requeue')
}
const summary = await refreshEvaluationSummary(redis, { archive })
console.log(JSON.stringify({ generatedAt: summary.generatedAt, status: summary.status,
  latestRun: summary.latestRun, bytes: Buffer.byteLength(JSON.stringify(summary)) }, null, 2))
