// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createArchive } from './archive.js'
import { evaluationTestStore } from './evaluationTestStore.js'
import {
  EVALUATION_JOB_MAX_ATTEMPTS,
  deserializeEvaluationInputs,
  evaluationJobsByRunId,
  freezeEvaluationJob,
  latestEvaluationJob,
  markJobCompleted,
  markJobFailed,
  markJobStarted,
  pendingEvaluationJobs,
  serializeEvaluationInputs,
} from './evaluationJob.js'

// freezeEvaluationJob/recordStatus stamp records with real `new Date()`. Every
// test below queries by time (claimability, staleness), so the system clock
// is pinned for the whole file — mixing a fictional reference timestamp with
// unpinned real-clock writes would make these assertions depend on the
// offset between the two, which is a false failure waiting to happen.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-10T07:02:00.000Z')) })
afterEach(() => { vi.useRealTimers() })

const at = '2026-09-10T07:02:00.000Z'
const inputs = () => ({
  admission: { candidates: [] }, baselineBoard: [], baselineSignals: [], signals: [], articles: [],
  quotesByTicker: new Map([['RKLB', { price: 25 }]]),
  sectorTrends: new Map([['Industrials', 1.2]]),
  coverageHistory: new Map([['RKLB', { seen: 3 }]]),
  technicals: new Map([['RKLB', { analyzed: true }]]),
  performanceStats: null, performanceBlock: null, discoveryHealthy: true,
})
const archiveFrom = () => createArchive(evaluationTestStore())
const freeze = (archive, overrides = {}) => freezeEvaluationJob(archive, {
  runId: 'nightly-run-1', publicationId: 'pub-1', decisionAt: at, evaluationInputs: inputs(), ...overrides,
})

describe('evaluation input serialization', () => {
  it('round-trips every Map field to arrays and back', () => {
    const raw = inputs()
    const serialized = serializeEvaluationInputs(raw)
    expect(Array.isArray(serialized.quotesByTicker)).toBe(true)
    expect(Array.isArray(serialized.sectorTrends)).toBe(true)
    expect(Array.isArray(serialized.coverageHistory)).toBe(true)
    expect(Array.isArray(serialized.technicals)).toBe(true)
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized) // survives real JSON storage

    const restored = deserializeEvaluationInputs(serialized)
    expect(restored.quotesByTicker).toBeInstanceOf(Map)
    expect(restored.quotesByTicker.get('RKLB')).toEqual({ price: 25 })
    expect(restored.technicals.get('RKLB')).toEqual({ analyzed: true })
    expect(restored.discoveryHealthy).toBe(true)
  })
})

describe('freezing an evaluation job packet', () => {
  it('is content-addressed per publication and idempotent under NX writes', async () => {
    const archive = archiveFrom()
    const first = await freeze(archive)
    const second = await freeze(archive, { decisionAt: '2099-01-01T00:00:00Z' }) // different call, same publicationId
    expect(second.id).toBe(first.id)
    expect(second.decisionAt).toBe(first.decisionAt) // first write wins, exactly like every other archive kind
  })

  it('produces a fresh job id for a different publication', async () => {
    const archive = archiveFrom()
    const a = await freeze(archive, { publicationId: 'pub-1' })
    const b = await freeze(archive, { publicationId: 'pub-2' })
    expect(a.id).not.toBe(b.id)
  })
})

describe('claiming pending work', () => {
  it('reports a freshly frozen job as pending with zero attempts', async () => {
    const archive = archiveFrom()
    await freeze(archive)
    const [job] = await pendingEvaluationJobs(archive, Date.now())
    expect(job).toMatchObject({ status: 'pending', attempt: 0, runId: 'nightly-run-1', publicationId: 'pub-1', retryState: null })
  })

  it('excludes a job once it completes, and idempotently exposes its result runId', async () => {
    const archive = archiveFrom()
    const input = await freeze(archive)
    const [job] = await pendingEvaluationJobs(archive, Date.now())
    const started = await markJobStarted(archive, job)
    expect(started.attempt).toBe(1)
    await markJobCompleted(archive, input.id, started.attempt, { resultRunId: 'evaluation-run-1' })

    expect(await pendingEvaluationJobs(archive, Date.now())).toEqual([])
    const latest = await latestEvaluationJob(archive, Date.now())
    expect(latest).toMatchObject({ status: 'completed', resultRunId: 'evaluation-run-1', attempt: 1 })
  })

  it('keeps a failed job claimable until attempts are exhausted, then marks it retryable', async () => {
    const archive = archiveFrom()
    const input = await freeze(archive)
    for (let attempt = 1; attempt <= EVALUATION_JOB_MAX_ATTEMPTS; attempt++) {
      const [job] = await pendingEvaluationJobs(archive, Date.now())
      expect(job).toBeDefined()
      const started = await markJobStarted(archive, job)
      expect(started.attempt).toBe(attempt)
      await markJobFailed(archive, input.id, started.attempt, { error: new Error(`try ${attempt} failed`) })
    }
    expect(await pendingEvaluationJobs(archive, Date.now())).toEqual([])
    const latest = await latestEvaluationJob(archive, Date.now())
    expect(latest).toMatchObject({ status: 'failed', attempt: EVALUATION_JOB_MAX_ATTEMPTS, retryState: 'retryable' })
    expect(latest.error).toBe(`try ${EVALUATION_JOB_MAX_ATTEMPTS} failed`)
  })

  it('marks a retry as still pending while attempts remain', async () => {
    const archive = archiveFrom()
    const input = await freeze(archive)
    const [job] = await pendingEvaluationJobs(archive, Date.now())
    const started = await markJobStarted(archive, job)
    await markJobFailed(archive, input.id, started.attempt, { error: new Error('boom') })
    const latest = await latestEvaluationJob(archive, Date.now())
    expect(latest).toMatchObject({ status: 'failed', attempt: 1, retryState: 'pending' })
  })

  it('treats a started job as claimable again once it goes stale (crashed mid-run)', async () => {
    const archive = archiveFrom()
    await freeze(archive)
    const [job] = await pendingEvaluationJobs(archive, Date.now())
    await markJobStarted(archive, job)

    vi.setSystemTime(new Date(Date.now() + 60_000)) // 1 minute later: still plausibly running
    expect(await pendingEvaluationJobs(archive, Date.now())).toEqual([])

    vi.setSystemTime(new Date(Date.now() + 10 * 60_000)) // 11 minutes total: presumed crashed
    const [stale] = await pendingEvaluationJobs(archive, Date.now())
    expect(stale).toMatchObject({ status: 'started', attempt: 1 })
  })

  it('maps jobs back to the nightly runId that produced them, for /research/logs', async () => {
    const archive = archiveFrom()
    await freeze(archive, { runId: 'nightly-run-42' })
    const byRunId = await evaluationJobsByRunId(archive, Date.now())
    expect(byRunId.get('nightly-run-42')).toMatchObject({ status: 'pending', publicationId: 'pub-1' })
    expect(byRunId.get('missing-run')).toBeUndefined()
  })

  it('returns the most-recently-frozen job, not the most-recently-updated one', async () => {
    const archive = archiveFrom()
    // Freeze job A at T0
    const jobA = await freeze(archive, { publicationId: 'pub-a' })
    vi.setSystemTime(new Date(Date.now() + 5000)) // Advance 5 seconds
    // Freeze job B at T1 (more recent)
    const jobB = await freeze(archive, { publicationId: 'pub-b' })
    vi.setSystemTime(new Date(Date.now() + 5000)) // Advance another 5 seconds
    // Update job A's status at T2 (but job B is still newer when frozen)
    const [jobAFromList] = await pendingEvaluationJobs(archive, Date.now())
    const started = await markJobStarted(archive, jobAFromList)
    await markJobFailed(archive, jobA.id, started.attempt, { error: new Error('failed') })
    // latestEvaluationJob should return B (frozen most recently), not A (updated most recently)
    const latest = await latestEvaluationJob(archive, Date.now())
    expect(latest).toMatchObject({ publicationId: 'pub-b', status: 'pending' })
  })
})
