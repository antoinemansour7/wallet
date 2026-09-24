import { HORIZONS, horizonPicks, storeProjection } from './publication.js'
import { withinCronBudget } from './runtimeBudget.js'

// Reports are written by their own daily invocation, after the nightly run has
// published its picks, so they get a full function budget instead of whatever
// the nightly run had left. They enrich the stored projection only; the frozen
// publication and its evaluation sample never change. Reports are written one
// at a time (see researchEngine.js), so each is stored as it finishes: a time
// cutoff loses only the report in flight, and the next scheduled run resumes
// with whatever is left.
export const DEFERRED_REPORTS_POLICY = Object.freeze({
  maxAgeMs: 20 * 60 * 60 * 1000,
  batchSize: 1,
  batchMinimumMs: 60_000,
})

const RESEARCH_KEY = 'research:latest'

/** This run's picks, once each, that still have no report. */
export function pendingReportPicks(payload) {
  const byId = new Map()
  for (const horizon of HORIZONS) {
    for (const pick of horizonPicks(payload, horizon)) {
      if (pick.generatedAt === payload.generatedAt && !pick.report && pick.candidateId && !byId.has(pick.candidateId)) byId.set(pick.candidateId, pick)
    }
  }
  return [...byId.values()]
}

/** Applies written reports (and recorded failures) to the picks they belong to. */
export function mergeReports(payload, results) {
  const byId = new Map(results.map((result) => [result.candidateId, result]))
  const apply = (pick) => {
    const result = pick.generatedAt === payload.generatedAt && !pick.report ? byId.get(pick.candidateId) : null
    if (!result) return pick
    const { reportError, ...rest } = pick
    return result.report
      ? { ...rest, report: result.report, citations: result.citations || [] }
      : { ...rest, report: null, citations: [], reportError: result.reportError || 'report_not_written' }
  }
  const picksByHorizon = Object.fromEntries(HORIZONS.map((horizon) => [horizon, horizonPicks(payload, horizon).map(apply)]))
  const merged = { ...payload, picks: picksByHorizon[5], picksByHorizon }
  return { ...merged, reportsPending: pendingReportPicks(merged).length > 0 }
}

export async function runDeferredReports({ redis, budget, generate, now = Date.now, policy = DEFERRED_REPORTS_POLICY }) {
  const latest = await redis.get(RESEARCH_KEY)
  if (!latest?.generatedAt) return { status: 'nothing_published', candidates: 0, written: 0, failed: 0, deferred: 0 }
  if (now() - Date.parse(latest.generatedAt) > policy.maxAgeMs) {
    return { status: 'stale', generatedAt: latest.generatedAt, candidates: 0, written: 0, failed: 0, deferred: 0 }
  }
  const pending = pendingReportPicks(latest)
  if (!pending.length) {
    if (latest.reportsPending) await storeProjection(redis, { ...latest, reportsPending: false })
    return { status: 'complete', generatedAt: latest.generatedAt, candidates: 0, written: 0, failed: 0, deferred: 0 }
  }

  let written = 0, failed = 0, done = 0, stopped = null
  for (let index = 0; index < pending.length; index += policy.batchSize) {
    if (!budget.canStart(policy.batchMinimumMs)) { stopped = 'time_budget'; break }
    const batch = pending.slice(index, index + policy.batchSize)
    let results
    try {
      results = await withinCronBudget(budget, 'Report generation', (signal, timeout) => generate(batch, { requestOptions: { signal, timeout } }))
    } catch (error) {
      stopped = error.code === 'CRON_TIME_BUDGET_EXCEEDED' ? 'time_budget' : 'generation_failed'
      break
    }
    // Merge into what is stored now, not the copy read at start, so a later
    // write to the same run (premarket re-rank) is kept rather than reverted.
    const current = await redis.get(RESEARCH_KEY)
    if (current?.generatedAt !== latest.generatedAt) return { status: 'superseded', generatedAt: latest.generatedAt, candidates: pending.length, written, failed, deferred: pending.length - done }
    await storeProjection(redis, mergeReports(current, results))
    written += results.filter((result) => result.report).length
    failed += results.filter((result) => !result.report).length
    done += batch.length
  }
  const deferred = pending.length - done
  return {
    status: failed || deferred ? 'partial' : 'complete', generatedAt: latest.generatedAt,
    candidates: pending.length, written, failed, deferred, ...(stopped ? { stopped } : {}),
  }
}
