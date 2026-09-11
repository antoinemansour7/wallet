# Research Evaluation Cron Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the six-arm evaluation experiment out of `nightly-research`'s 300s request into its own daily `/api/research-evaluation` cron, so evaluation reliably runs without competing with the main research pipeline for time budget, and investigate whether the ~50s of nightly headroom this frees up should fund richer research quality work.

**Architecture:** `nightly-research` keeps capturing `evaluationInputs` exactly as it does today, but instead of immediately running the expensive six-arm review (`prepareEvaluation` + `freezeEvaluation`, ~90s of Claude/frozen-engine calls), it freezes them into an immutable, content-addressed "evaluation job" packet (new archive kind `evaluation-job-input`) and returns. A new `/api/research-evaluation` cron, modeled directly on the existing `track-performance.js` pattern (own lock, own `createCronBudget`, own budget-gated loop), claims pending/failed/stale-started packets and runs the unchanged `prepareEvaluation`/`freezeEvaluation` pipeline against them, recording append-only status transitions (`pending → started → completed|failed`) in a second new archive kind (`evaluation-job-status`) so retries are idempotent by construction. `/research/evaluation` and `/research/logs` are extended to surface this pending/failed state instead of looking blank.

**Tech Stack:** Vercel Functions (Node.js, Hobby plan — 300s max duration, once-daily cron, hour-level scheduling precision), Upstash Redis (`@upstash/redis`) as the only datastore, the existing hand-rolled content-addressed `archive.js` (`SET NX` + sorted-set indexes, no ORM/SQL), Vitest (`npm run test:run` — **never** raw `vitest`, since that boots without `NODE_ENV=test`/`VITE_MOCK_AUTH=false` and loads production React, producing phantom failures).

**Spec:** GitHub issue #172 ("Research evaluation: split evaluation into its own cron and investigate nightly headroom"), reproduced in full in this repo's issue tracker. Key excerpts are inlined into the relevant tasks below; the full acceptance-criteria list is restated in Task 12.

## Global Constraints

- Do not change the six-arm experiment definitions, frozen baseline, horizons, or delivered-vs-shadow semantics in `src/server/research/evaluation.js`, `evaluationPolicy.js`, or `frozen/*` — those files are not touched by this plan at all.
- Do not increase the 30-candidate review budget (`src/server/research/policy.js` `STRATEGIES`) — that is issue #171's scope, not this one's.
- Do not consume all ~50s of apparent nightly headroom just because one run finished at ~242s — Part B (Tasks 10–11) must measure real runtime distribution before recommending any new nightly work, and any recommended addition keeps a minimum 30s safety reserve.
- Every new nightly-side step must have its own runtime budget/timeout via the existing `createCronBudget`/`withinCronBudget`/`canStart` primitives (`src/server/research/runtimeBudget.js`) and must fail soft (push to `errors`, never throw past its own `try`).
- Vercel Hobby constraints (confirmed, and must be documented in Task 5's implementation notes): up to 100 cron jobs per project, each Hobby cron schedule runs at most once per day, Hobby cron timing has hour-level precision (not guaranteed minute precision), Vercel Functions on Hobby have a 300-second maximum duration. No Vercel Pro upgrade is required or in scope.
- Run tests with `npm run test:run`, never bare `vitest` (project convention — raw `vitest` loads production React and produces phantom failures).
- Server-side test files use the `// @vitest-environment node` pragma as their first line, matching `runtimeBudget.test.js` and `evaluation.test.js`.

---

## Part A — Split evaluation into its own cron

### Task 1: Add new observability stage names

**Files:**
- Modify: `src/server/research/observability.js:15-37` (the `STAGES` object)
- Test: `src/server/research/observability.test.js`

**Interfaces:**
- Produces: `STAGES.evaluation_input_freeze` (used by nightly-research's new cheap freeze step) and `STAGES.evaluation_job` (used by the new cron's top-level invocation, mirroring how `track-performance.js` wraps its whole handler in `STAGES.performance_tracking`). `STAGES.evaluation_snapshot` already exists and is reused (moved from nightly to the new cron) — no rename needed for it.

- [ ] **Step 1: Write the failing test**

Add to `src/server/research/observability.test.js` (find the existing `describe` block that asserts on `STAGES` — if none exists, add a new one near the top of the file):

```js
describe('STAGES vocabulary', () => {
  it('names the evaluation hand-off stages the cron split introduces', () => {
    expect(STAGES.evaluation_input_freeze).toBe('evaluation_input_freeze')
    expect(STAGES.evaluation_job).toBe('evaluation_job')
    expect(STAGES.evaluation_snapshot).toBe('evaluation_snapshot')
  })
})
```

Make sure `STAGES` is imported at the top of the test file (it already is, since the file tests `observability.js`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/server/research/observability.test.js`
Expected: FAIL — `STAGES.evaluation_input_freeze` and `STAGES.evaluation_job` are `undefined`.

- [ ] **Step 3: Add the two stage names**

In `src/server/research/observability.js`, extend the array literal at line 15-37:

```js
export const STAGES = Object.freeze(Object.fromEntries([
  'foundation_load',
  'x_discovery',
  'news_discovery',
  'screener_discovery',
  'exa_discovery',
  'day_trade_signals',
  'market_regime',
  'claude_review',
  'contrarian_review',
  'catalyst_verification',
  'final_ranking',
  'publication',
  'persistence',
  'report_generation',
  'evaluation_input_freeze',
  'evaluation_snapshot',
  'evaluation_job',
  'slack_alerts',
  'premarket_check',
  'foundation_sync',
  'foundation_followup',
  'performance_tracking',
  'performance_evaluation',
].map((name) => [name, name])))
```

(Only the two new entries — `evaluation_input_freeze` and `evaluation_job` — are additions; every other line is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/server/research/observability.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/research/observability.js src/server/research/observability.test.js
git commit -m "feat(research): add evaluation_input_freeze and evaluation_job stage names

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Evaluation job packet — freeze, status tracking, claiming

This is the core new module. It never imports or modifies `evaluation.js`/`evaluationPolicy.js`/`frozen/*`.

**Files:**
- Create: `src/server/research/evaluationJob.js`
- Test: `src/server/research/evaluationJob.test.js`

**Interfaces:**
- Consumes: `digest` from `./archive.js` (`digest(value)` → sha256 hex string), `EVALUATION_ID` from `./evaluationPolicy.js` (string constant `'discovery-matrix-v1'`), and an `archive` object shaped like `createArchive(redis)`'s return value: `{ put(kind, id, record, index, availableAt), list(index, asOf, opts), get(kind, id) }`.
- Produces (consumed by Tasks 3, 4, 6, 8):
  - `EVALUATION_JOB_MAX_ATTEMPTS` (number, `3`)
  - `serializeEvaluationInputs(inputs): object` / `deserializeEvaluationInputs(raw): object`
  - `freezeEvaluationJob(archive, { runId, publicationId, decisionAt, evaluationInputs }): Promise<{id, runId, publicationId, decisionAt, frozenAt, availableAt, evaluationInputs}>`
  - `markJobStarted(archive, job): Promise<{jobId, status:'started', attempt, at, availableAt, error:null, resultRunId:null}>` where `job` is a job descriptor from `describeJob` (needs `.jobId` and `.attempt`)
  - `markJobCompleted(archive, jobId, attempt, { resultRunId }): Promise<statusRecord>`
  - `markJobFailed(archive, jobId, attempt, { error }): Promise<statusRecord>`
  - `pendingEvaluationJobs(archive, now = Date.now(), { limit = 5 } = {}): Promise<Array<jobDescriptor>>` — jobs claimable right now
  - `latestEvaluationJob(archive, now = Date.now()): Promise<jobDescriptor | null>` — the single most-recently-frozen job regardless of status
  - `evaluationJobsByRunId(archive, now = Date.now()): Promise<Map<runId, jobDescriptor>>`
  - A `jobDescriptor` shape: `{ jobId, runId, publicationId, decisionAt, frozenAt, status: 'pending'|'started'|'completed'|'failed', attempt, statusAt, error, resultRunId, retryState: 'pending'|'retryable'|null }`

- [ ] **Step 1: Write the failing tests**

Create `src/server/research/evaluationJob.test.js`:

```js
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/server/research/evaluationJob.test.js`
Expected: FAIL — `Cannot find module './evaluationJob.js'`

- [ ] **Step 3: Write the implementation**

Create `src/server/research/evaluationJob.js`:

```js
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
  return archive.put('evaluation-job-input', id, record, 'evaluation-job-inputs', frozenAt)
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

async function latestJobStatuses(archive, now) {
  const events = await archive.list('evaluation-job-status', now, { since: now - JOB_LOOKBACK_MS })
  const latest = new Map()
  for (const event of events) {
    const current = latest.get(event.jobId)
    if (!current || Date.parse(event.at) >= Date.parse(current.at)) latest.set(event.jobId, event)
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
  const jobs = await allEvaluationJobs(archive, now)
  return jobs.at(-1) || null
}

export async function evaluationJobsByRunId(archive, now = Date.now()) {
  const jobs = await allEvaluationJobs(archive, now)
  return new Map(jobs.map((job) => [job.runId, job]))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/server/research/evaluationJob.test.js`
Expected: PASS (all 8 cases)

- [ ] **Step 5: Commit**

```bash
git add src/server/research/evaluationJob.js src/server/research/evaluationJob.test.js
git commit -m "feat(research): add evaluation job packet freeze/status/claim module

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Nightly research freezes the packet instead of running evaluation

**Files:**
- Modify: `api/nightly-research.js:1-31` (imports/constants), `api/nightly-research.js:399` (remove unused `evaluationRun` variable), `api/nightly-research.js:494-517` (the evaluation block)
- Modify: `src/server/research/nightly.test.js` (mocks + two existing tests + one new test)

**Interfaces:**
- Consumes: `freezeEvaluationJob` from Task 2's `./evaluationJob.js`; `currentResearchRun`, `researchLog` from `./observability.js` (both already exported, just not previously imported here); `STAGES.evaluation_input_freeze` from Task 1.
- Produces: nightly-research no longer imports or calls `prepareEvaluation`/`freezeEvaluation` at all, and no longer writes the `evaluation-delivery` archive kind (that responsibility moves to Task 4's cron).

- [ ] **Step 1: Update imports and constants**

In `api/nightly-research.js`, replace line 20-22:

```js
import { prepareEvaluation, freezeEvaluation } from '../src/server/research/evaluation.js'
import { STAGES, candidateTraces, recordCandidates, recordResearchRun, skipStage, stage } from '../src/server/research/observability.js'
import { createCronBudget, withinCronBudget } from '../src/server/research/runtimeBudget.js'
```

with:

```js
import { freezeEvaluationJob } from '../src/server/research/evaluationJob.js'
import { STAGES, candidateTraces, currentResearchRun, recordCandidates, recordResearchRun, researchLog, skipStage, stage } from '../src/server/research/observability.js'
import { createCronBudget, withinCronBudget } from '../src/server/research/runtimeBudget.js'
```

Replace line 30 (`const EVALUATION_MINIMUM_MS = 90_000`) with:

```js
// Freezing the packet is one archive write with no model calls — the six-arm
// review that used to need ~90s here now runs in the separate
// research-evaluation cron, which has its own full 300s budget.
const EVALUATION_FREEZE_MINIMUM_MS = 5_000
```

- [ ] **Step 2: Remove the now-unused `evaluationRun` variable**

Delete line 399 (`let evaluationRun = null`) — nothing in the rewritten block below needs it.

- [ ] **Step 3: Replace the evaluation block**

Replace `api/nightly-research.js:494-517` (from `// The experiment is deliberately last and optional.` through the closing `}` of the `else { try {...} catch {...} }`) with:

```js
  // The experiment is deliberately last and optional. Freezing its inputs is
  // the only work left here — the six-arm review itself runs in the separate
  // research-evaluation cron, so a slow provider night no longer has to
  // reserve ~90s here just to start that review.
  if (!evaluationInputs) {
    skipStage(STAGES.evaluation_input_freeze, 'inputs_unavailable')
    errors.push({ step: 'evaluation', error: 'Decision inputs unavailable' })
  } else if (!budget.canStart(EVALUATION_FREEZE_MINIMUM_MS)) {
    skipStage(STAGES.evaluation_input_freeze, 'time_budget', { availableMs: budget.availableMs() })
    errors.push({ step: 'evaluation', error: 'deferred to preserve the cron completion budget' })
  } else {
    try {
      const job = await stage(STAGES.evaluation_input_freeze, () => freezeEvaluationJob(foundation.archive, {
        runId: currentResearchRun()?.runId ?? null,
        publicationId: payload.publicationId,
        decisionAt: payload.generatedAt,
        evaluationInputs,
      }), { metrics: (record) => ({ jobId: record.id }) })
      researchLog({ event: 'evaluation_input_frozen', stage: STAGES.evaluation_input_freeze, metrics: { jobId: job.id } })
      researchLog({ event: 'evaluation_job_pending', stage: STAGES.evaluation_input_freeze, metrics: { jobId: job.id } })
    } catch (err) {
      console.error('[nightly-research] evaluation input freeze failed:', err.message)
      errors.push({ step: 'evaluation', error: err.message })
    }
  }
```

- [ ] **Step 4: Update `nightly.test.js`'s mocks**

In `src/server/research/nightly.test.js`, replace line 17-18's `mocks` hoisted object (only the evaluation-related entries):

```js
  return { values, publications, redis, archive, master, load: vi.fn(), extract: vi.fn(), reports: vi.fn(), record: vi.fn(), quotes: vi.fn(),
    yahoo: vi.fn(), freezeEvaluationJob: vi.fn() }
```

Replace line 21's mock:

```js
vi.mock('./evaluationJob.js', () => ({ freezeEvaluationJob: mocks.freezeEvaluationJob }))
```

Replace line 48 (`mocks.prepareEvaluation.mockResolvedValue(...); mocks.freezeEvaluation.mockResolvedValue(...)`):

```js
  mocks.freezeEvaluationJob.mockResolvedValue({ id: 'job-1' })
```

- [ ] **Step 5: Rewrite the "cannot be frozen" test**

Replace the test at lines 116-127 (`it('still publishes the briefing when the shadow experiment cannot be frozen', ...)`) with:

```js
  it('still publishes the briefing when the evaluation packet cannot be frozen', async () => {
    mocks.freezeEvaluationJob.mockRejectedValue(new Error('archive unavailable'))
    mocks.extract.mockImplementation(async (_s, _a, options) => { options.onPrimaryReview(primary({ 20: [pick('QUIET', 20)] })); return [] })
    const res = response()
    await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.values.get('research:latest').picksByHorizon[20][0].ticker).toBe('QUIET')
    expect(mocks.freezeEvaluationJob).toHaveBeenCalledOnce()
    expect(res.json.mock.calls[0][0].errors).toContainEqual({ step: 'evaluation', error: 'archive unavailable' })
  })
```

- [ ] **Step 6: Update the time-budget test's stage expectations**

In the test at lines 141-167 (`it('publishes within five minutes by skipping optional work when the finishing reserve is reached', ...)`), replace this line inside the `expect(summary.stages).toEqual(...)` array (currently `expect.objectContaining({ stage: 'evaluation_snapshot', status: 'skipped' })`):

```js
      expect.objectContaining({ stage: 'evaluation_input_freeze', status: 'success' }),
```

(Remove the old `evaluation_snapshot: skipped` line — freezing the packet only needs 5s, not 90s, so at ~45s remaining in this scenario it now succeeds instead of being skipped. This is the exact behavior the issue reports as broken today.) Also add, right after that `expect(summary.stages).toEqual(...)` assertion:

```js
    expect(mocks.freezeEvaluationJob).toHaveBeenCalledOnce()
```

- [ ] **Step 7: Add a regression test matching the issue's own production numbers**

Add a new test in the `describe('nightly foundation integration', ...)` block, after the test from Step 6:

```js
  it('freezes the evaluation packet even with only ~30 seconds left — the exact Sep 10 production shortfall', async () => {
    mocks.extract.mockImplementation(async (_s, _a, options) => {
      options.onPrimaryReview(primary())
      vi.setSystemTime(new Date('2026-09-09T12:04:03Z')) // ~32s left before the 275s work deadline
      return [pick('FAST')]
    })
    await handler(request(), response())
    expect(mocks.freezeEvaluationJob).toHaveBeenCalledOnce()
    const [, line] = mocks.redis.lpush.mock.calls.find(([key]) => key === 'research:runs:v1')
    const summary = JSON.parse(line)
    expect(summary.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'evaluation_input_freeze', status: 'success' }),
    ]))
  })
```

- [ ] **Step 8: Run the full nightly test file**

Run: `npm run test:run -- src/server/research/nightly.test.js`
Expected: PASS — all existing tests plus the new one.

- [ ] **Step 9: Commit**

```bash
git add api/nightly-research.js src/server/research/nightly.test.js
git commit -m "feat(research): freeze evaluation inputs in nightly instead of running the six-arm review

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: New `/api/research-evaluation` cron

**Files:**
- Create: `api/research-evaluation.js`
- Test: `src/server/research/researchEvaluationCron.test.js` (placed alongside `nightly.test.js`, matching that file's own convention of testing an `api/*.js` handler via relative import from `src/server/research/`)

**Interfaces:**
- Consumes: `pendingEvaluationJobs`, `markJobStarted`, `markJobCompleted`, `markJobFailed`, `deserializeEvaluationInputs`, `EVALUATION_JOB_MAX_ATTEMPTS` from Task 2's `evaluationJob.js`; `prepareEvaluation`, `freezeEvaluation` (unchanged) from `./evaluation.js`; `loadFoundation` from `./foundation.js`; `createArchive` from `./archive.js`; `STAGES`, `recordResearchRun`, `researchLog`, `skipStage`, `stage` from `./observability.js`; `createCronBudget`, `withinCronBudget` from `./runtimeBudget.js`.
- Produces: `GET/POST /api/research-evaluation` → `{ processed: number, results: Array<{jobId, status: 'completed'|'failed'|'deferred', runId?, error?}> }`.

- [ ] **Step 1: Write the failing tests**

Create `src/server/research/researchEvaluationCron.test.js`:

```js
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluationTestStore } from './evaluationTestStore.js'
import { createArchive } from './archive.js'
import { freezeEvaluationJob, latestEvaluationJob, pendingEvaluationJobs } from './evaluationJob.js'

const mocks = vi.hoisted(() => ({ store: null, load: vi.fn(), prepareEvaluation: vi.fn(), freezeEvaluation: vi.fn() }))
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: () => mocks.store } }))
vi.mock('./foundation.js', () => ({ loadFoundation: mocks.load }))
vi.mock('./evaluation.js', () => ({ prepareEvaluation: mocks.prepareEvaluation, freezeEvaluation: mocks.freezeEvaluation }))
import handler from '../../../api/research-evaluation.js'

function fakeRedis() {
  const store = evaluationTestStore()
  return { ...store, async eval(_script, [key], [token]) { if (store.values.get(key) === token) store.values.delete(key) },
    async lpush() {}, async ltrim() {} }
}

const at = '2026-09-10T07:02:00.000Z'
const evaluationInputs = () => ({ admission: { candidates: [] }, baselineBoard: [], baselineSignals: [], signals: [], articles: [],
  quotesByTicker: new Map(), sectorTrends: new Map(), coverageHistory: new Map(), technicals: new Map(),
  performanceStats: null, performanceBlock: null, discoveryHealthy: true })
const request = () => ({ method: 'POST', headers: { authorization: 'Bearer test' }, query: {} })
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() })

async function seedPendingJob(archive, overrides = {}) {
  const job = await freezeEvaluationJob(archive, {
    runId: 'nightly-run-1', publicationId: 'pub-1', decisionAt: at, evaluationInputs: evaluationInputs(), ...overrides,
  })
  await archive.put('publication', job.publicationId, { publicationId: job.publicationId, generatedAt: job.decisionAt, picksByHorizon: {} }, 'publications', job.decisionAt)
  return job
}

const sixArms = () => ['frozen-existing', 'fundamentals-only', 'combined', 'no-attention', 'no-quiet', 'constrained']
  .flatMap((arm) => [{ arm, status: 'accepted' }, { arm, status: 'rejected' }])

beforeEach(() => {
  vi.clearAllMocks()
  mocks.store = fakeRedis()
  vi.stubEnv('CRON_SECRET', 'test'); vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fixture.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test')
  mocks.load.mockResolvedValue({ master: { resolve: () => [] } })
  mocks.prepareEvaluation.mockResolvedValue({ id: 'snapshot-1' })
  mocks.freezeEvaluation.mockResolvedValue({ id: 'evaluation-run-1', observations: sixArms() })
})
afterEach(() => vi.unstubAllEnvs())

describe('research-evaluation cron', () => {
  it('processes a pending job end-to-end and marks it completed', async () => {
    const archive = createArchive(mocks.store)
    await seedPendingJob(archive)

    const res = response()
    await handler(request(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ processed: 1, results: [{ jobId: expect.any(String), status: 'completed', runId: 'evaluation-run-1' }] })
    expect(mocks.prepareEvaluation).toHaveBeenCalledOnce()
    expect(await pendingEvaluationJobs(archive, Date.now())).toEqual([])
    const latest = await latestEvaluationJob(archive, Date.now())
    expect(latest).toMatchObject({ status: 'completed', resultRunId: 'evaluation-run-1' })
    expect(await archive.get('evaluation-delivery', 'evaluation-run-1')).toMatchObject({ runId: 'evaluation-run-1' })
  })

  it('does not reprocess an already-completed job on a retried invocation', async () => {
    const archive = createArchive(mocks.store)
    await seedPendingJob(archive)
    await handler(request(), response())
    const res = response()
    await handler(request(), res)

    expect(res.json).toHaveBeenCalledWith({ processed: 0, results: [] })
    expect(mocks.prepareEvaluation).toHaveBeenCalledOnce() // not called a second time
  })

  it('marks a job failed without creating an observation record, and succeeds on retry', async () => {
    const archive = createArchive(mocks.store)
    await seedPendingJob(archive)
    mocks.prepareEvaluation.mockRejectedValueOnce(new Error('anthropic unavailable'))

    const first = response()
    await handler(request(), first)
    expect(first.json).toHaveBeenCalledWith({ processed: 1, results: [{ jobId: expect.any(String), status: 'failed', error: 'anthropic unavailable' }] })
    expect(mocks.freezeEvaluation).not.toHaveBeenCalled()

    const second = response()
    await handler(request(), second)
    expect(second.json).toHaveBeenCalledWith({ processed: 1, results: [{ jobId: expect.any(String), status: 'completed', runId: 'evaluation-run-1' }] })
  })

  it('gives up automatic retries after the attempt limit and reports the job as retryable', async () => {
    const archive = createArchive(mocks.store)
    await seedPendingJob(archive)
    mocks.prepareEvaluation.mockRejectedValue(new Error('anthropic unavailable'))

    for (let attempt = 1; attempt <= 3; attempt++) await handler(request(), response())
    const exhausted = response()
    await handler(request(), exhausted)
    expect(exhausted.json).toHaveBeenCalledWith({ processed: 0, results: [] })

    const latest = await latestEvaluationJob(archive, Date.now())
    expect(latest).toMatchObject({ status: 'failed', attempt: 3, retryState: 'retryable' })
  })

  it('defers a claimed job to preserve its own time budget instead of failing it', async () => {
    const archive = createArchive(mocks.store)
    await seedPendingJob(archive)
    vi.stubEnv('RESEARCH_CRON_MAX_DURATION_MS', '1000') // budget exhausted before any job can start

    const res = response()
    await handler(request(), res)
    expect(res.json).toHaveBeenCalledWith({ processed: 1, results: [{ jobId: expect.any(String), status: 'deferred' }] })
    expect(mocks.prepareEvaluation).not.toHaveBeenCalled()

    vi.unstubAllEnvs(); vi.stubEnv('CRON_SECRET', 'test'); vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fixture.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test')
    const retried = response()
    await handler(request(), retried)
    expect(retried.json).toHaveBeenCalledWith({ processed: 1, results: [{ jobId: expect.any(String), status: 'completed', runId: 'evaluation-run-1' }] })
  })

  it('refuses to run concurrently with another invocation', async () => {
    mocks.store.values.set('research:evaluation:lock:v1', 'other-run')
    const res = response()
    await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(mocks.prepareEvaluation).not.toHaveBeenCalled()
  })

  it('rejects unauthorized requests and reports missing Redis configuration', async () => {
    const unauthorized = response()
    await handler({ ...request(), headers: {} }, unauthorized)
    expect(unauthorized.status).toHaveBeenCalledWith(401)

    vi.unstubAllEnvs()
    const misconfigured = response()
    await handler(request(), misconfigured)
    expect(misconfigured.status).toHaveBeenCalledWith(401) // CRON_SECRET unset now denies before Redis is even checked
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/server/research/researchEvaluationCron.test.js`
Expected: FAIL — `Cannot find module '../../../api/research-evaluation.js'`

- [ ] **Step 3: Write the implementation**

Create `api/research-evaluation.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/server/research/researchEvaluationCron.test.js`
Expected: PASS (all 8 cases)

- [ ] **Step 5: Commit**

```bash
git add api/research-evaluation.js src/server/research/researchEvaluationCron.test.js
git commit -m "feat(research): add the research-evaluation cron endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Register the cron and document Hobby constraints

**Files:**
- Modify: `vercel.json`
- Create: `docs/research/evaluation-cron-scheduling.md`

**Interfaces:** none (config + documentation only).

- [ ] **Step 1: Add the cron entry and function config**

In `vercel.json`, add a new entry to the `crons` array (after the `/api/nightly-research` entry, before `/api/track-performance`):

```json
    {
      "path": "/api/research-evaluation",
      "schedule": "0 11 * * *"
    },
```

And add to the `functions` object:

```json
    "api/research-evaluation.js": {
      "maxDuration": 300
    },
```

- [ ] **Step 2: Verify the JSON is valid and the cron table is as expected**

Run: `node -e "console.log(JSON.stringify(require('./vercel.json').crons, null, 2))"`
Expected output includes all of: `research-foundation` at hours 1,4,10,13,16,19,22; `nightly-research` at hour 7; `research-evaluation` at hour 11 (new); `track-performance` at hour 9. Confirm no two entries share an hour.

- [ ] **Step 3: Write the implementation-notes doc**

Create `docs/research/evaluation-cron-scheduling.md`:

```markdown
# Evaluation cron scheduling — implementation notes

## Vercel Hobby constraints (confirmed, as of this change)

- Up to 100 cron jobs per project.
- Each Hobby cron schedule runs **at most once per day**.
- Hobby cron timing has **hour-level precision**, not guaranteed minute
  precision — a job scheduled for `0 11 * * *` may fire anywhere within the
  11:00–11:59 UTC window, not necessarily at :00.
- Vercel Functions on Hobby have a **300-second maximum duration**.
- None of the above requires a Vercel Pro upgrade; this project stays on
  Hobby.

## Current cron table (UTC)

| Hour | Path | Purpose |
|------|------|---------|
| 1, 4, 10, 13, 16, 19, 22 | `/api/research-foundation` | SEC ingestion / durable evidence |
| 7 | `/api/nightly-research` | Discovery, admission, review, publication, evaluation-input freeze |
| 9 | `/api/track-performance` | 5/20-session outcome tracking |
| 11 | `/api/research-evaluation` | Six-arm evaluation review of frozen packets (new) |

## Why hour 11

`nightly-research` starts somewhere in the 7:00–7:59 window and can run up to
300s, so in the worst case it is still finishing around 8:04. `research-evaluation`
is scheduled four hours later, at 11:00–11:59, so even full-hour drift on both
jobs cannot bring them close to overlapping. Hour 8 (immediately after
nightly-research) was considered and rejected for having a materially tighter
margin against documented drift.

Exact timing is not safety-critical to correctness, only to promptness: the
evaluation job queue (`evaluation-job-input` + `evaluation-job-status` in
`src/server/research/evaluationJob.js`) is durable and idempotent, so if
`research-evaluation` ever ran before a given night's packet was frozen, or
missed a day entirely, the packet simply stays `pending` and is picked up the
next time the cron runs — no data is lost, and no duplicate observations are
created. Hour 11 is chosen for comfortable safety margin, not because a
tighter schedule would be unsafe.

`track-performance` (hour 9) can run before that night's `research-evaluation`
(hour 11) has produced an `evaluation-run` record yet. This is fine:
`trackEvaluation` (`src/server/research/evaluationPerformance.js`) processes
whatever `evaluation-run` records already exist and is idempotent per
observation/horizon — it simply picks up a newly created run's observations
on its next invocation.
```

- [ ] **Step 4: Commit**

```bash
git add vercel.json docs/research/evaluation-cron-scheduling.md
git commit -m "feat(research): register the research-evaluation cron at hour 11 UTC

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Surface pending/failed evaluation state in the report API

**Files:**
- Modify: `src/server/research/evaluationPerformance.js:197-228` (`evaluationReport`)
- Modify: `src/server/research/evaluationPerformance.test.js`

**Interfaces:**
- Consumes: `latestEvaluationJob` from Task 2's `evaluationJob.js`.
- Produces: `evaluationReport(archive, now)` return value gains one new field: `currentJob: jobDescriptor | null` — non-null only when the most recently frozen job has **not** completed (i.e., its six-arm review is pending, in progress, or failed). Once it completes, `currentJob` reverts to `null` and the existing `latestRun`/`arms`/`observations` fields already reflect it — no change to any existing field.

- [ ] **Step 1: Write the failing test**

Add to `src/server/research/evaluationPerformance.test.js` (new `describe` block near the `evaluationReport` tests — search the file for its existing `describe('experiment report', ...)` or similar and add alongside it):

```js
describe('surfacing pending/failed evaluation jobs', () => {
  // freezeEvaluationJob/markJob* stamp records with real `new Date()`. Pin the
  // system clock for this block so every query-by-time call below (evaluationReport,
  // pendingEvaluationJobs) shares the same clock as those writes — otherwise
  // whether a freshly frozen job even falls inside the query's time window
  // depends on the real wall-clock offset from `at`, which is exactly the class
  // of bug the pre-flight review caught in Task 2's original draft.
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(at)) })
  afterEach(() => { vi.useRealTimers() })

  it('reports a frozen-but-not-yet-processed job instead of looking blank', async () => {
    const archive = createArchive(evaluationTestStore())
    const { freezeEvaluationJob } = await import('./evaluationJob.js')
    await freezeEvaluationJob(archive, { runId: 'run-1', publicationId: 'pub-1', decisionAt: at, evaluationInputs: {} })

    const report = await evaluationReport(archive, Date.now())
    expect(report.currentJob).toMatchObject({ status: 'pending', publicationId: 'pub-1' })
  })

  it('reports a failed job with its retry state', async () => {
    const archive = createArchive(evaluationTestStore())
    const { freezeEvaluationJob, markJobStarted, markJobFailed, pendingEvaluationJobs } = await import('./evaluationJob.js')
    const input = await freezeEvaluationJob(archive, { runId: 'run-1', publicationId: 'pub-1', decisionAt: at, evaluationInputs: {} })
    const [job] = await pendingEvaluationJobs(archive, Date.now())
    const started = await markJobStarted(archive, job)
    await markJobFailed(archive, input.id, started.attempt, { error: new Error('anthropic unavailable') })

    const report = await evaluationReport(archive, Date.now())
    expect(report.currentJob).toMatchObject({ status: 'failed', error: 'anthropic unavailable', retryState: 'pending' })
  })

  it('clears currentJob once the job has completed, since latestRun already reflects it', async () => {
    const archive = createArchive(evaluationTestStore())
    const { freezeEvaluationJob, markJobStarted, markJobCompleted, pendingEvaluationJobs } = await import('./evaluationJob.js')
    const input = await freezeEvaluationJob(archive, { runId: 'run-1', publicationId: 'pub-1', decisionAt: at, evaluationInputs: {} })
    const [job] = await pendingEvaluationJobs(archive, Date.now())
    const started = await markJobStarted(archive, job)
    await markJobCompleted(archive, input.id, started.attempt, { resultRunId: 'evaluation-run-1' })

    const report = await evaluationReport(archive, Date.now())
    expect(report.currentJob).toBeNull()
  })
})
```

Confirm `createArchive` and `evaluationTestStore` are already imported at the top of this test file (they are, per the existing `evaluationReport` tests); confirm an `at` constant already exists near the top (it does: `const at = '2026-09-04T22:00:00.000Z'`) — reuse it, don't redeclare. The `beforeEach`/`afterEach` inside this `describe` block are scoped to it by Vitest and do not affect the file's other, pre-existing tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/server/research/evaluationPerformance.test.js`
Expected: FAIL — `report.currentJob` is `undefined` in all three new cases.

- [ ] **Step 3: Add `currentJob` to `evaluationReport`**

In `src/server/research/evaluationPerformance.js`, add the import at the top of the file (alongside the existing imports at lines 1-2):

```js
import { latestEvaluationJob } from './evaluationJob.js'
```

Then modify `evaluationReport` (lines 197-228) — change the `Promise.all` at lines 198-200 to also fetch the latest job, and add `currentJob` to the returned object:

```js
export async function evaluationReport(archive, now = Date.now()) {
  const [definition, { runs, observations }, results, currentJob] = await Promise.all([
    archive.get('evaluation-definition', EVALUATION_ID), evaluationObservations(archive, now), archive.list('evaluation-outcomes', now),
    latestEvaluationJob(archive, now),
  ])
  const sealed = finalSealed(definition, now)
  const hidden = new Set(observations.filter((o) => sealed && o.period === 'final-untouched').map((o) => o.id))
  const outcomes = latestOutcomes(results.filter((r) => !hidden.has(r.observationId)))
  const groups = [...ARMS.map((arm) => ({ ...arm, cohort: 'shadow' })), { id: 'delivered', name: 'WallAI delivered', cohort: 'delivered' }]
    .map((arm) => {
      const rows = observations.filter((o) => o.arm === arm.id && o.cohort === arm.cohort)
      const periods = [...new Set(rows.map((r) => r.period))]
      return { ...arm, observations: rows.length, accepted: rows.filter((r) => r.status === 'accepted').length,
        rejected: rows.filter((r) => r.status === 'rejected').length,
        // Versions and periods are never pooled. Delivered model versions may change.
        cohorts: [...new Set(rows.map((r) => r.armVersion))].flatMap((version) => periods.map((period) => {
          const sample = rows.filter((r) => r.period === period && r.armVersion === version)
          return { version, period, observations: sample.length, accepted: sample.filter((r) => r.status === 'accepted').length,
            sealed: sealed && period === 'final-untouched', turnover: selectionTurnover(sample),
            horizons: [5, 20].map((h) => horizonSummary(sample, outcomes, h)),
            portfolio: arm.id === 'constrained' ? portfolioSummary(sample, outcomes) : null }
        }).filter((c) => c.observations)),
        emptyHorizons: [5, 20].map((h) => horizonSummary([], outcomes, h)) }
    })
  return { experimentId: EVALUATION_ID, definition: definition || null, variantsTried: definition?.variantsTried || 6,
    status: runs.length ? 'Collecting data' : 'Insufficient data', latestRun: runs.at(-1) ? {
      id: runs.at(-1).id, availableAt: runs.at(-1).availableAt, status: runs.at(-1).status, failures: runs.at(-1).failures,
    } : null, finalSealed: sealed, arms: groups,
    // A job that already completed is already reflected in latestRun/arms
    // above; only surface it here while it is still pending, in progress or
    // failed, so /research/evaluation shows why nothing new has appeared yet.
    currentJob: currentJob && currentJob.status !== 'completed' ? currentJob : null,
    // The API provides stock-level inspection, including retained rejections.
    observations: observations.map((o) => ({ ...o, outcomes: o.horizons.map((h) => hidden.has(o.id)
      ? { horizon: h, status: 'sealed', reason: 'Untouched evaluation' }
      : outcomes.get(`${o.id}:${h}`) || { horizon: h, status: 'pending' }) })) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/server/research/evaluationPerformance.test.js`
Expected: PASS — the three new cases plus every pre-existing test in the file (confirm nothing else broke, since `currentJob` is additive).

- [ ] **Step 5: Commit**

```bash
git add src/server/research/evaluationPerformance.js src/server/research/evaluationPerformance.test.js
git commit -m "feat(research): surface pending/failed evaluation jobs in evaluationReport

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `/research/evaluation` shows pending/failed state

**Files:**
- Modify: `src/pages/ResearchEvaluation.jsx:84-94` (header block)
- Modify: `src/pages/ResearchEvaluation.test.jsx`

**Interfaces:**
- Consumes: `data.currentJob` from Task 6 (`null | { status, frozenAt, error, retryState }`).

- [ ] **Step 1: Write the failing tests**

Add to `src/pages/ResearchEvaluation.test.jsx`, inside the existing `describe('private evaluation page', ...)` block:

```js
  it('shows a pending banner instead of looking blank when a job is frozen but not yet processed', async () => {
    const data = report()
    data.currentJob = { status: 'pending', frozenAt: '2026-09-10T07:02:00.000Z', error: null, retryState: null }
    fetch.mockResolvedValue({ ok: true, json: async () => data })
    renderEvaluation()
    expect(await screen.findByText(/Evaluation: pending/)).toBeInTheDocument()
    expect(screen.getByText(/Next step: scheduled evaluation job/)).toBeInTheDocument()
  })

  it('shows a failed banner with the reason and retry state', async () => {
    const data = report()
    data.currentJob = { status: 'failed', frozenAt: '2026-09-10T07:02:00.000Z', error: 'anthropic unavailable', retryState: 'retryable' }
    fetch.mockResolvedValue({ ok: true, json: async () => data })
    renderEvaluation()
    expect(await screen.findByText(/Evaluation: failed/)).toBeInTheDocument()
    expect(screen.getByText(/anthropic unavailable/)).toBeInTheDocument()
    expect(screen.getByText(/Retry state: retryable/)).toBeInTheDocument()
  })

  it('shows no banner once the job has completed', async () => {
    const data = report()
    data.currentJob = null
    fetch.mockResolvedValue({ ok: true, json: async () => data })
    renderEvaluation()
    await screen.findByText('Frozen existing engine')
    expect(screen.queryByText(/Evaluation: pending/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Evaluation: failed/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/pages/ResearchEvaluation.test.jsx`
Expected: FAIL — the pending/failed text is never rendered yet.

- [ ] **Step 3: Render the banner**

In `src/pages/ResearchEvaluation.jsx`, add a `CurrentJob` component above `ResearchEvaluation` (after the `Eyebrow` declaration at line 49):

```jsx
function CurrentJob({ job }) {
  if (!job) return null
  if (job.status === 'failed') {
    return <p className="evaluation-alert" role="status">
      Evaluation: failed · Reason: {job.error || 'Unknown'} · Retry state: {job.retryState}
    </p>
  }
  return <p className="evaluation-alert" role="status">
    Evaluation: pending · Frozen at: {new Date(job.frozenAt).toLocaleString()} · Next step: scheduled evaluation job
  </p>
}
```

Then in the `header` block (lines 85-94), add `<CurrentJob job={data.currentJob} />` immediately after the closing `</dl>` and before the existing `{data.latestRun?.failures...}` line:

```jsx
    <header className="evaluation-head"><Eyebrow /><h1>Research evaluation</h1>
      <p className="evaluation-lede">Returns are hypothetical next-open fills. This experiment is collecting evidence; fundamentals has not proven itself.</p>
      <dl className="evaluation-run">
        <div><dt>Status</dt><dd>{data.status}</dd></div>
        <div><dt>Experiment</dt><dd>{data.experimentId}</dd></div>
        <div><dt>Variants tried</dt><dd>{data.variantsTried}</dd></div>
        <div><dt>Latest run</dt><dd>{data.latestRun ? new Date(data.latestRun.availableAt).toLocaleString() : 'No forward observations yet'}</dd></div>
      </dl>
      <CurrentJob job={data.currentJob} />
      {data.latestRun?.failures?.some(Boolean) && <p className="evaluation-alert" role="status">Some arms could not complete their review: {data.latestRun.failures.filter(Boolean).join(' · ')}</p>}
    </header>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/pages/ResearchEvaluation.test.jsx`
Expected: PASS — all new and existing tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ResearchEvaluation.jsx src/pages/ResearchEvaluation.test.jsx
git commit -m "feat(research): show pending/failed evaluation state on /research/evaluation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Attach evaluation handoff status to `/research/logs`'s run list

**Files:**
- Modify: `src/server/research/runsApi.js`
- Modify: `src/server/research/runsApi.test.js`

**Interfaces:**
- Consumes: `evaluationJobsByRunId` from Task 2's `evaluationJob.js`; `createArchive` from `./archive.js`.
- Produces: each run object in the `GET /api/get-research?runs=1` response gains an `evaluation` field (`null | jobDescriptor`) when `run.job === 'nightly-research'`; runs for other jobs are unchanged.

- [ ] **Step 1: Write the failing test**

In `src/server/research/runsApi.test.js`, add the mock declaration alongside the existing `vi.mock` calls at lines 4-7, and import the mocked function at the top of the file (alongside the existing `import handler from '../../../api/get-research.js'` at line 8):

```js
vi.mock('./evaluationJob.js', () => ({ evaluationJobsByRunId: vi.fn() }))
```

```js
import { evaluationJobsByRunId } from './evaluationJob.js'
```

Add a default to the existing `beforeEach` (lines 22-29), right after `mocks.redis.mockReturnValue(...)`, so every pre-existing test in the file keeps working without needing to know about evaluation jobs:

```js
  vi.mocked(evaluationJobsByRunId).mockResolvedValue(new Map())
```

Then add two new tests inside `describe('private research run log', ...)`:

```js
  it('attaches the evaluation handoff status to each nightly-research run', async () => {
    const map = new Map([['run-1', { jobId: 'job-1', status: 'pending', frozenAt: '2026-09-10T07:02:00.000Z', error: null, retryState: null }]])
    vi.mocked(evaluationJobsByRunId).mockResolvedValue(map)

    const res = response(); await handler(request(), res)
    expect(body(res).runs[0]).toMatchObject({ runId: 'run-1', evaluation: { jobId: 'job-1', status: 'pending' } })
  })

  it('reports no evaluation handoff for a run the packet freeze never reached', async () => {
    const res = response(); await handler(request(), res) // beforeEach already stubs an empty map
    expect(body(res).runs[0].evaluation).toBeNull()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/server/research/runsApi.test.js`
Expected: FAIL — `body(res).runs[0].evaluation` is `undefined`.

- [ ] **Step 3: Implement the attachment**

In `src/server/research/runsApi.js`, add imports and wire the lookup:

```js
import { Redis } from '@upstash/redis'
import { verifyOwner } from './evaluationApi.js'
import { createArchive } from './archive.js'
import { evaluationJobsByRunId } from './evaluationJob.js'
import { RESEARCH_RUNS_KEY } from './observability.js'

const DEFAULT_LIMIT = 30

function parseRun(entry) {
  try {
    return typeof entry === 'string' ? JSON.parse(entry) : entry
  } catch {
    return null
  }
}

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
    const redis = Redis.fromEnv()
    const stored = await redis.lrange(RESEARCH_RUNS_KEY, 0, DEFAULT_LIMIT - 1)
    const parsed = (stored || []).map(parseRun).filter(Boolean)

    // Only nightly-research runs hand off to an evaluation job; attaching a
    // null elsewhere keeps the shape predictable for the frontend either way.
    const byRunId = await evaluationJobsByRunId(createArchive(redis))
    const runs = parsed.map((run) => ({ ...run, evaluation: run.job === 'nightly-research' ? (byRunId.get(run.runId) || null) : null }))

    const ticker = String(req.query?.ticker || '').trim().toUpperCase()
    if (!ticker) return res.status(200).json({ runs })

    const traces = runs.flatMap((run) => (run.candidates || [])
      .filter((candidate) => candidate.ticker === ticker)
      .map((candidate) => ({ ...candidate, runId: run.runId, job: run.job, startedAt: run.startedAt })))
    return res.status(200).json({ runs, traces })
  } catch {
    return res.status(503).json({ error: 'Run history is unavailable' })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/server/research/runsApi.test.js`
Expected: PASS — all new and existing tests, including the pre-existing `'survives a corrupt entry rather than failing the whole history'` test, which now passes through the `beforeEach` default (empty map) added in Step 1.

- [ ] **Step 5: Commit**

```bash
git add src/server/research/runsApi.js src/server/research/runsApi.test.js
git commit -m "feat(research): attach evaluation handoff status to the run log API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `/research/logs` renders the cross-cron handoff

**Files:**
- Modify: `src/pages/ResearchLogs.jsx`
- Modify: `src/pages/ResearchLogs.test.jsx`

**Interfaces:**
- Consumes: `run.evaluation` from Task 8 (`null | { status, frozenAt, error, retryState }`) on each `run` object already rendered by the `Run` component.

- [ ] **Step 1: Write the failing test**

Check `src/pages/ResearchLogs.test.jsx` for its existing run fixture shape (it will mirror `runsApi.test.js`'s `run()` helper); add a new test to its main `describe` block:

```js
  it('shows the nightly → frozen input → evaluation job handoff', async () => {
    const withEvaluation = { ...run(), evaluation: { jobId: 'job-1', status: 'pending', frozenAt: '2026-09-10T07:02:00.000Z', error: null, retryState: null } }
    fetch.mockResolvedValue({ ok: true, json: async () => ({ runs: [withEvaluation] }) })
    renderLogs()
    expect(await screen.findByText(/Evaluation input/)).toBeInTheDocument()
    expect(screen.getByText(/Evaluation job/)).toBeInTheDocument()
    expect(screen.getByText(/pending/)).toBeInTheDocument()
  })

  it('says the input was never frozen when there is no evaluation handoff at all', async () => {
    const withoutEvaluation = { ...run(), evaluation: null }
    fetch.mockResolvedValue({ ok: true, json: async () => ({ runs: [withoutEvaluation] }) })
    renderLogs()
    await screen.findByText(withoutEvaluation.job)
    expect(screen.getByText(/not frozen/)).toBeInTheDocument()
  })
```

(Match whatever local helper names — `run()`, `renderLogs()` — the existing file already defines; if the file's fixture helper has a different name, use that name instead, keeping the shape: an object with at least `runId`, `job: 'nightly-research'`, `status`, `startedAt`, `durationMs`, `stages`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/pages/ResearchLogs.test.jsx`
Expected: FAIL — neither "Evaluation input" nor "not frozen" text exists yet.

- [ ] **Step 3: Render the handoff block**

In `src/pages/ResearchLogs.jsx`, add a small component after `Stage` (around line 35):

```jsx
function EvaluationHandoff({ run }) {
  if (run.job !== 'nightly-research') return null
  const evaluation = run.evaluation
  return <div className="logs-handoff" aria-label="Evaluation handoff">
    <span>Nightly research {run.status === 'failed' ? '❌' : '✅'} {run.status}</span>
    {!evaluation
      ? <span>Evaluation input — not frozen (inputs unavailable or time budget)</span>
      : <>
        <span>Evaluation input ✅ frozen · {when(evaluation.frozenAt)}</span>
        <span>Evaluation job {evaluation.status === 'completed' ? '✅' : evaluation.status === 'failed' ? '❌' : '⏳'} {evaluation.status}
          {evaluation.status === 'failed' && ` · ${evaluation.error} · retry: ${evaluation.retryState}`}
        </span>
      </>}
  </div>
}
```

Then in the `Run` component (around line 169-176), render it right after the `logs-run-head` div and before `<Funnel .../>`:

```jsx
    <div className="logs-run-head">
      <h2>{run.job}</h2>
      <span className={`logs-status logs-status-${run.status}`}>{run.status}</span>
      <span>{when(run.startedAt)}</span>
      <span>{seconds(run.durationMs)}</span>
    </div>
    <EvaluationHandoff run={run} />
    <Funnel admission={run.admission} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/pages/ResearchLogs.test.jsx`
Expected: PASS — all new and existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ResearchLogs.jsx src/pages/ResearchLogs.test.jsx
git commit -m "feat(research): render the nightly-to-evaluation handoff on /research/logs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Part B — Nightly headroom investigation

This part is data analysis and documentation, not TDD-style feature code — there is no failing test to write first. Each task still produces a concrete, committed artifact.

### Task 10: Runtime percentile analysis script

**Files:**
- Create: `scripts/nightly-runtime-percentiles.mjs` (modeled directly on the existing `scripts/research-evaluation-status.mjs`)

- [ ] **Step 1: Write the script**

```js
// Read-only operator report. Run with trusted server credentials, for example:
// node --env-file=.env scripts/nightly-runtime-percentiles.mjs
import { Redis } from '@upstash/redis'
import { RESEARCH_RUNS_KEY } from '../src/server/research/observability.js'

const percentile = (sorted, p) => {
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[index]
}

const redis = Redis.fromEnv()
const stored = await redis.lrange(RESEARCH_RUNS_KEY, 0, 499)
const runs = stored.map((entry) => { try { return typeof entry === 'string' ? JSON.parse(entry) : entry } catch { return null } })
  .filter((run) => run?.job === 'nightly-research')

const durations = runs.map((run) => run.durationMs).filter(Number.isFinite).sort((a, b) => a - b)
const byStage = new Map()
for (const run of runs) {
  for (const stage of run.stages || []) {
    if (!Number.isFinite(stage.durationMs)) continue
    if (!byStage.has(stage.stage)) byStage.set(stage.stage, [])
    byStage.get(stage.stage).push(stage.durationMs)
  }
}

const stageSummary = [...byStage.entries()].map(([stage, values]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return { stage, samples: sorted.length, p50: percentile(sorted, 50), p90: percentile(sorted, 90), p95: percentile(sorted, 95), max: sorted.at(-1) }
}).sort((a, b) => (b.p90 || 0) - (a.p90 || 0))

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  sampleSize: durations.length,
  totalRuntimeMs: {
    p50: percentile(durations, 50), p90: percentile(durations, 90), p95: percentile(durations, 95), max: durations.at(-1),
  },
  exceeded250s: durations.filter((d) => d > 250_000).length,
  exceeded260s: durations.filter((d) => d > 260_000).length,
  exceeded270s: durations.filter((d) => d > 270_000).length,
  degradedRuns: runs.filter((run) => run.status !== 'success').length,
  slowestStages: stageSummary.slice(0, 8),
}, null, 2))
```

- [ ] **Step 2: Verify it runs syntactically**

Run: `node --check scripts/nightly-runtime-percentiles.mjs`
Expected: no output (syntax valid). This does not require live credentials since `--check` only parses the file.

- [ ] **Step 3: Commit**

```bash
git add scripts/nightly-runtime-percentiles.mjs
git commit -m "feat(research): add a nightly runtime percentile analysis script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Run the analysis and write the recommendation

**Files:**
- Create: `docs/research/nightly-headroom-investigation.md`

- [ ] **Step 1: Run the script against production data**

Run: `node --env-file=.env scripts/nightly-runtime-percentiles.mjs`

If `.env` in this repo holds real `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` credentials, this prints real percentiles. If it does not (or the sample size is too small to be meaningful — fewer than, say, 10 nightly-research runs recorded), record that explicitly in the doc below rather than fabricating numbers, and default to the conservative "do not add work yet" recommendation.

- [ ] **Step 2: Write the findings and recommendation doc**

Create `docs/research/nightly-headroom-investigation.md`, filling in the `<...>` placeholders with the script's actual output from Step 1 (do not leave them as literal placeholder text in the committed file — replace every one with the real number or the explicit "insufficient sample" statement):

```markdown
# Nightly headroom investigation (issue #172, Part B)

## Method

Ran `scripts/nightly-runtime-percentiles.mjs` against the `research:runs:v1`
history (`src/server/research/observability.js`), which records every
`nightly-research` invocation's total duration and per-stage durations.

## Findings

- Sample size: <N> nightly-research runs.
- Total runtime: p50 = <Xs>, p90 = <Xs>, p95 = <Xs>, max = <Xs>.
- Runs exceeding 250s / 260s / 270s: <a> / <b> / <c> out of <N>.
- Degraded (non-`success` status) runs: <d> out of <N>.
- Slowest stages by p90: <list from the script's `slowestStages`>.

## Recommendation

<Pick exactly one of the following two forms, based on the real numbers above
— do not average them together or hedge between both.>

**If p95 total runtime is comfortably under ~270s and stage variance is not
dominated by provider latency spikes:**

> Keep a 30s minimum safety reserve. Use up to 15–20s for richer
> representative X context on the top reviewed candidates admitted this run
> (issue #166), added as its own budget-gated stage using
> `withinCronBudget`/`canStart`, with its own `skipStage(..., 'time_budget')`
> fallback. Leave the remainder unused for provider/runtime variance. This is
> a follow-up ticket, not part of #172 — #172 only frees the ~90s that used
> to be reserved for evaluation; it does not itself add new nightly work.

**If p95 total runtime is already close to 300s, or driven by unpredictable
provider latency spikes:**

> Do not add work yet; p95 nightly runtime is already too close to 300s. The
> headroom freed by moving evaluation out should be left as safety margin for
> slow provider nights and persistence/finalization, not spent on new
> research-quality work.

## Guardrails honored

- No change was made to the 30-candidate review budget (`policy.js`
  `STRATEGIES`) — that remains issue #171's scope.
- No change was made to the six-arm experiment definitions, frozen baseline,
  horizons, or delivered-vs-shadow semantics (`evaluation.js`,
  `evaluationPolicy.js`, `frozen/*`).
- This document is a recommendation only; issue #166 (richer X context) is
  implemented, if at all, as its own separately reviewed change.
```

- [ ] **Step 3: Commit**

```bash
git add docs/research/nightly-headroom-investigation.md
git commit -m "docs(research): analyze nightly runtime headroom and recommend next step

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: PASS — every test file in the repo, including all files touched or created in Tasks 1–9.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Re-check every acceptance criterion from issue #172**

Confirm each of the following against the actual committed state (not from memory):

- [ ] `nightly-research` no longer depends on leftover request time to execute the six-arm evaluation (Task 3 — `EVALUATION_FREEZE_MINIMUM_MS = 5_000` replaces the old `EVALUATION_MINIMUM_MS = 90_000` gate; `prepareEvaluation`/`freezeEvaluation` are no longer imported by `api/nightly-research.js`).
- [ ] Nightly research persists immutable decision-time evaluation input before returning (Task 3 — `freezeEvaluationJob`, content-addressed on `publicationId`).
- [ ] A separate daily `/api/research-evaluation` cron/job processes pending frozen evaluation work (Tasks 4–5).
- [ ] The evaluation job has its own function invocation/execution window, scheduled safely relative to nightly research under Hobby timing precision (Task 5, hour 11 vs. hour 7, documented rationale).
- [ ] Evaluation retries are idempotent and cannot duplicate a run (Task 2's `EVALUATION_JOB_MAX_ATTEMPTS`/status tracking + Task 4's "does not reprocess an already-completed job" test).
- [ ] Partial arm completion can be resumed or safely retried (Task 2's stale-`started` reclaim logic + Task 4's failed-then-retried test; documented in Task 2 code comments that the six arms are computed synchronously from two already-resolved async legs inside `prepareEvaluation`, so job-level retry — not per-arm — is the correct and sufficient granularity here).
- [ ] Deferred evaluation never re-runs discovery or substitutes newer data for decision-time data (Task 4's `processJob` only ever reads `input.evaluationInputs` frozen by Task 3 and the immutable `publication` record by id — it calls no discovery/news/SEC/quote-fetching code).
- [ ] Existing #101 experiment definitions, horizons and frozen baseline remain unchanged (`evaluation.js`, `evaluationPolicy.js`, `frozen/*` are never modified by this plan — confirm with `git diff main -- src/server/research/evaluation.js src/server/research/evaluationPolicy.js src/server/research/frozen/` returning empty).
- [ ] `/research/evaluation` shows pending/failed/completed state instead of appearing blank (Task 7).
- [ ] `/research/logs` shows the nightly → frozen input → separate evaluation-job handoff (Task 9).
- [ ] Current Hobby cron/function constraints are documented in the implementation notes (Task 5's `docs/research/evaluation-cron-scheduling.md`).
- [ ] Recent nightly runtimes are analyzed before spending the apparent ~50s headroom (Task 10–11).
- [ ] The issue produces a concrete recommendation for whether any of that headroom should be used for richer context/verification or kept as safety reserve (Task 11).
- [ ] No review-budget increase is made as part of this ticket (`policy.js` untouched — confirm with `git diff main -- src/server/research/policy.js` returning empty).
- [ ] Tests cover frozen-input correctness, idempotency, retry/resume, pending/failed evaluation UI states and cross-cron observability (Tasks 2, 4, 6, 7, 8, 9).
- [ ] Tests, lint and build pass (Steps 1–3 above).

- [ ] **Step 5: Confirm nothing else changed unexpectedly**

Run: `git status` and `git diff main --stat`
Expected: only the files listed across Tasks 1–11 appear.
