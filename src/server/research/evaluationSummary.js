import { createArchive } from './archive.js'
import { evaluationReport } from './evaluationPerformance.js'
import { latestEvaluationJob } from './evaluationJob.js'

export const EVALUATION_SUMMARY_KEY = 'research:evaluation:summary:v2'

// Written by evaluation/tracking, read by the owner page. Never expire the last
// usable report during an upstream outage; display its timestamp and staleness.
export async function refreshEvaluationSummary(redis, { archive = createArchive(redis), now = Date.now() } = {}) {
  const report = await evaluationReport(archive, now, { includeObservations: false })
  const summary = { ...report, generatedAt: new Date(now).toISOString() }
  await redis.set(EVALUATION_SUMMARY_KEY, summary)
  return summary
}

export async function readEvaluationSummary(redis) {
  const cached = await redis.get(EVALUATION_SUMMARY_KEY)
  const report = cached || await refreshEvaluationSummary(redis)
  // Queue status is lightweight and must stay current even between reports.
  const job = await latestEvaluationJob(createArchive(redis), Date.now())
  return { ...report, currentJob: job?.status === 'completed' ? null : job,
    status: job?.status === 'failed' ? 'Evaluation failed' : report.status,
    stale: Date.now() - Date.parse(report.generatedAt) > 36 * 3600000 }
}

