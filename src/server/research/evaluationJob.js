import { digest } from './archive.js'
import { EVALUATION_ID } from './evaluationPolicy.js'

// Automatic retries stop here; the job then reports as "retryable" instead
// of "pending" so an operator knows it will not resolve itself.
export const EVALUATION_JOB_MAX_ATTEMPTS = 3
// A 'started' status older than this is presumed crashed (the invocation was
// killed before it could record 'completed' or 'failed') and is safe to retry
// — the archive's content-addressed writes make re-running idempotent.
const STALE_STARTED_MS = 10 * 60 * 1000
// Bounds the daily scan the same way foundation.js bounds its evidence window.
const JOB_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000

const MAP_FIELDS = ['quotesByTicker', 'sectorTrends', 'coverageHistory', 'technicals']

export function serializeEvaluationInputs(inputs) {
  const out = { ...inputs }
  for (const field of MAP_FIELDS) if (inputs[field] instanceof Map) out[field] = [...inputs[field]]
  return out
}

export function deserializeEvaluationInputs(raw) {
  const out = { ...raw }
  for (const field of MAP_FIELDS) if (Array.isArray(raw[field])) out[field] = new Map(raw[field])
  return out
}

export function evaluationJobId(publicationId) {
  return digest([EVALUATION_ID, 'job', publicationId])
}

// Cheap and synchronous relative to the six-arm run: one archive write, no
// model calls, no re-fetched evidence. The id is content-addressed on the
// publication alone, so re-freezing after a retried nightly run is a no-op.
export async function freezeEvaluationJob(archive, { runId, publicationId, decisionAt, evaluationInputs }) {
  const id = evaluationJobId(publicationId)
  const frozenAt = new Date().toISOString()
  const record = {
    id, runId, publicationId, decisionAt, frozenAt, availableAt: frozenAt,
    evaluationInputs: serializeEvaluationInputs(evaluationInputs),
  }
  const stored = await archive.put('evaluation-job-input', id, record, 'evaluation-job-inputs', frozenAt)
  const { evaluationInputs: _inputs, ...metadata } = stored
  await archive.put('evaluation-job-metadata', id, metadata, 'evaluation-job-metadata', stored.frozenAt)
  return stored
}

async function recordStatus(archive, jobId, status, { attempt, error = null, resultRunId = null }) {
  const at = new Date().toISOString()
  const record = {
    jobId, status, attempt, at, availableAt: at,
    error: error ? String(error.message || error) : null, resultRunId,
  }
  const id = digest([jobId, status, attempt])
  return archive.put('evaluation-job-status', id, record, 'evaluation-job-status', at)
}

export const markJobStarted = (archive, job) => recordStatus(archive, job.jobId, 'started', { attempt: job.attempt + 1 })
export const markJobCompleted = (archive, jobId, attempt, { resultRunId }) => recordStatus(archive, jobId, 'completed', { attempt, resultRunId })
export const markJobFailed = (archive, jobId, attempt, { error }) => recordStatus(archive, jobId, 'failed', { attempt, error })

// Explicit operator recovery. Preserve prior attempts and immutable decisions;
// a new review will have its actual completion timestamp, never a backdated fill.
export async function requeueEvaluationJob(archive, job) {
  const at = new Date().toISOString()
  return archive.put('evaluation-job-status', digest([job.jobId, 'pending', at]), {
    jobId: job.jobId, status: 'pending', attempt: job.attempt, at, availableAt: at,
    error: null, resultRunId: job.resultRunId,
  }, 'evaluation-job-status', at)
}

async function latestJobStatuses(archive, now, since = now - JOB_LOOKBACK_MS) {
  const events = await archive.list('evaluation-job-status', now, { since })
  const latest = new Map()
  const statusPriority = { completed: 3, failed: 2, started: 1, pending: 0 }
  for (const event of events) {
    const current = latest.get(event.jobId)
    if (!current) {
      latest.set(event.jobId, event)
    } else {
      const currentTs = Date.parse(current.at)
      const eventTs = Date.parse(event.at)
      // Prioritize: newer timestamp > higher attempt > higher status priority
      if (eventTs > currentTs || (eventTs === currentTs && event.attempt > current.attempt) || (eventTs === currentTs && event.attempt === current.attempt && statusPriority[event.status] > statusPriority[current.status])) {
        latest.set(event.jobId, event)
      }
    }
  }
  return latest
}

function retryState(status, attempt) {
  if (status !== 'failed') return null
  return attempt < EVALUATION_JOB_MAX_ATTEMPTS ? 'pending' : 'retryable'
}

function describeJob(input, status) {
  const state = status?.status || 'pending'
  const attempt = status?.attempt ?? 0
  return {
    jobId: input.id, runId: input.runId, publicationId: input.publicationId, decisionAt: input.decisionAt,
    frozenAt: input.frozenAt, status: state, attempt, statusAt: status?.at || input.frozenAt,
    error: status?.error || null, resultRunId: status?.resultRunId || null,
    retryState: retryState(state, attempt),
  }
}

function isClaimable(job, now) {
  if (job.status === 'pending') return true
  if (job.status === 'failed') return job.attempt < EVALUATION_JOB_MAX_ATTEMPTS
  if (job.status === 'started') return now - Date.parse(job.statusAt) > STALE_STARTED_MS
  return false
}

async function allEvaluationJobs(archive, now) {
  const [inputs, statuses] = await Promise.all([
    archive.list('evaluation-job-inputs', now, { since: now - JOB_LOOKBACK_MS }),
    latestJobStatuses(archive, now),
  ])
  return inputs.map((input) => describeJob(input, statuses.get(input.id)))
}

export async function pendingEvaluationJobs(archive, now = Date.now(), { limit = 5 } = {}) {
  const jobs = await allEvaluationJobs(archive, now)
  return jobs.filter((job) => isClaimable(job, now)).slice(0, limit)
}

export async function latestEvaluationJob(archive, now = Date.now()) {
  const input = await archive.latest('evaluation-job-metadata', now) || await archive.latest('evaluation-job-inputs', now)
  if (!input) return null
  const statuses = await latestJobStatuses(archive, now, Date.parse(input.frozenAt))
  return describeJob(input, statuses.get(input.id))
}

export async function evaluationJobsByRunId(archive, now = Date.now()) {
  const jobs = await allEvaluationJobs(archive, now)
  return new Map(jobs.map((job) => [job.runId, job]))
}
