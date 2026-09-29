// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createArchive } from './archive.js'
import { evaluationTestStore } from './evaluationTestStore.js'
import { EVALUATION_SUMMARY_KEY, readEvaluationSummary, refreshEvaluationSummary } from './evaluationSummary.js'
import { evaluationOutcomeRecords } from './evaluationOutcomeIndex.js'
import { freezeEvaluationJob, markJobStarted, markJobFailed } from './evaluationJob.js'

describe('saved evaluation summaries', () => {
  it('serves the saved report with current queue status without rebuilding outcomes', async () => {
    const redis = evaluationTestStore(), archive = createArchive(redis)
    const job = await freezeEvaluationJob(archive, { runId: 'night', publicationId: 'pub', decisionAt: new Date().toISOString(), evaluationInputs: {} })
    const started = await markJobStarted(archive, { jobId: job.id, attempt: 0 })
    await markJobFailed(archive, job.id, started.attempt, { error: new Error('temporary failure') })
    const summary = { status: 'Collecting data', arms: [], generatedAt: new Date().toISOString() }
    await redis.set(EVALUATION_SUMMARY_KEY, summary)
    const reads = vi.spyOn(redis, 'get')
    const result = await readEvaluationSummary(redis)
    expect(result).toMatchObject({ status: 'Evaluation failed', currentJob: { status: 'failed' }, stale: false })
    expect(reads.mock.calls.flat().some((key) => /evaluation-(run|outcome|job-input):/.test(key))).toBe(false)
  })

  it('builds a summary without stock detail and clearly marks an old saved report', async () => {
    const redis = evaluationTestStore()
    const result = await refreshEvaluationSummary(redis, { now: Date.now() - 48 * 3600000 })
    expect(result).not.toHaveProperty('observations')
    expect(result.arms).toHaveLength(7)
    expect((await readEvaluationSummary(redis)).stale).toBe(true)
  })

  it('only switches summary outcome reads after the historical index is complete', async () => {
    const archive = createArchive(evaluationTestStore()), now = Date.now()
    await archive.put('evaluation-outcome', 'accepted', { id: 'accepted' }, ['evaluation-outcomes', 'evaluation-accepted-outcomes'], now)
    await archive.put('evaluation-outcome', 'rejected', { id: 'rejected' }, 'evaluation-outcomes', now)
    expect(await evaluationOutcomeRecords(archive, now, { acceptedOnly: true })).toHaveLength(2)
    await archive.put('evaluation-index', 'accepted-outcomes-v1', { availableAt: new Date(now).toISOString() })
    expect(await evaluationOutcomeRecords(archive, now, { acceptedOnly: true })).toEqual([{ id: 'accepted' }])
    expect(await evaluationOutcomeRecords(archive, now)).toHaveLength(2)
  })
})
