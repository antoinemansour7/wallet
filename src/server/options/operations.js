// Owner-only operational diagnostics and quota monitoring (epic #201
// operations section, story #215). Answers "is the scanner healthy, and why
// did today miss its window / come back thin / cost more than expected" --
// for the operator, never for an ordinary user.
//
// Two deliberately different kinds of function live here.
//
// The provider-stat accumulators (`accumulateProviderStats`,
// `finalizeProviderStats`) are threaded through the premarket/opening stage
// functions as they run: they sum request/page/status counts the Alpaca
// adapter already returns per call and that every caller previously
// discarded. Nothing here issues a request of its own. The result rides the
// stage's existing `metrics` object into the scan audit record, which
// scheduler.js already redacts (`safeMetrics`, scalars only) before archival
// -- so a new field here is safe by inheriting a guarantee that already
// exists, not by this module re-implementing it.
//
// `buildOptionsOperationsReport` is the read side: a single on-demand
// recomputation over records the scanner already archived (chain, scenario,
// decision, evidence, scan-attempt) plus one fresh schedule-health and
// kill-switch check. It writes nothing, retries nothing, and never throws --
// a broken archive read degrades to an explicit `unavailable` status, the
// same shape the rest of the options API already uses for that case.
import { OPTIONS_KILL_SWITCH_KEY, optionsScheduleHealth } from './scheduler.js'
import { resolvePremarketContext } from './openingEvidence.js'
import { optionsAuditRecord } from './auditStore.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'

export const OPTIONS_OPERATIONS_POLICY_VERSION = 'options-operations-diagnostics-v1'

// How far back to look for schedule-attempt records when assessing schedule
// health. Generous on purpose: a long weekend or a market holiday can push
// the last *market* day well past a calendar week back, and this is a single
// bounded read either way -- see the "exactly one archive.list call" test.
const SCHEDULE_HISTORY_LOOKBACK_DAYS = 14

function round(value, digits = 3) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits))
}

// ---------------------------------------------------------------------------
// Provider request accounting
// ---------------------------------------------------------------------------

export function emptyProviderStats() {
  return { requestCount: 0, pagesFetched: 0, statusCounts: {} }
}

// `observation` is whatever an Alpaca adapter call returned (optionChain,
// underlyingSnapshots, stockBars all share this shape): `requestCount`,
// `pageCounts` and `diagnostics` (per-request status + rate-limit headers).
// A caller that constructed no adapter, or whose call threw before returning
// anything, passes `null` -- that contributes nothing, not a crash.
export function accumulateProviderStats(stats, observation) {
  if (!observation) return stats
  if (Number.isFinite(observation.requestCount)) stats.requestCount += observation.requestCount
  for (const value of Object.values(observation.pageCounts || {})) {
    if (Number.isFinite(value)) stats.pagesFetched += value
  }
  for (const entry of observation.diagnostics || []) {
    const status = Number(entry?.status)
    if (Number.isFinite(status)) stats.statusCounts[status] = (stats.statusCounts[status] || 0) + 1
  }
  return stats
}

export function finalizeProviderStats(stats) {
  const entries = Object.entries(stats.statusCounts)
  return {
    providerRequestCount: stats.requestCount,
    providerPagesFetched: stats.pagesFetched,
    provider429Count: stats.statusCounts[429] || 0,
    providerServerErrorCount: entries.filter(([code]) => Number(code) >= 500).reduce((sum, [, count]) => sum + count, 0),
  }
}

// ---------------------------------------------------------------------------
// Redis command accounting -- a metrics-only wrapper, never a behavior change
// ---------------------------------------------------------------------------

// Wraps a Redis client so every method call it exposes is counted before
// being forwarded unchanged. Used once per request, around the same client
// object the scheduler's leasing and the archive's reads/writes already
// share, so the count reflects the whole stage attempt rather than one
// module's private view of it. This never retries and never changes a
// return value -- it is purely an observer.
export function instrumentRedisCommandCount(redis) {
  const counter = { count: 0 }
  const handler = {
    get(target, property) {
      const value = target[property]
      if (typeof value !== 'function') return value
      return (...args) => { counter.count += 1; return value.apply(target, args) }
    },
  }
  return { redis: new Proxy(redis, handler), counter }
}

// ---------------------------------------------------------------------------
// Percentiles
// ---------------------------------------------------------------------------

function percentileOf(sorted, p) {
  const rank = (p / 100) * (sorted.length - 1)
  const low = Math.floor(rank), high = Math.ceil(rank)
  if (low === high) return sorted[low]
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low)
}

export function summarizePercentiles(values) {
  const finite = (values || []).filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!finite.length) return { count: 0, p50: null, p90: null, p99: null, max: null }
  return {
    count: finite.length,
    p50: round(percentileOf(finite, 50)),
    p90: round(percentileOf(finite, 90)),
    p99: round(percentileOf(finite, 99)),
    max: finite.at(-1),
  }
}

// ---------------------------------------------------------------------------
// Summaries over already-archived records
// ---------------------------------------------------------------------------

// Quote age/skew percentiles and rejection-reason counts from a scan's chain
// records. Rejected contracts carry only a reason string, not a quote (see
// chainGates.js), so age/skew are necessarily measured over the accepted set
// -- documented here rather than silently read as "the whole chain".
export function summarizeChainQuality(chainRecords = []) {
  const ages = [], skews = []
  let contractsObserved = 0, analyticsAgeUnknownCount = 0
  const rejectionReasons = {}
  for (const chainRecord of chainRecords || []) {
    const payload = chainRecord?.payload
    if (!payload) continue
    for (const contract of payload.contracts || []) {
      contractsObserved += 1
      if (Number.isFinite(contract?.quote?.ageMs)) ages.push(contract.quote.ageMs)
      if (Number.isFinite(contract?.skewMs)) skews.push(contract.skewMs)
      if (contract?.analyticsAgeUnknown) analyticsAgeUnknownCount += 1
    }
    for (const rejection of payload.rejected || []) {
      if (!rejection?.reason) continue
      rejectionReasons[rejection.reason] = (rejectionReasons[rejection.reason] || 0) + 1
    }
  }
  return { contractsObserved, quoteAgeMs: summarizePercentiles(ages), quoteSkewMs: summarizePercentiles(skews), analyticsAgeUnknownCount, rejectionReasons }
}

// Calibration residual magnitude (the "is the model actually fitting the
// synchronized quote" question) kept separate from calibration and
// convergence FAILURE counts (the "did scoring have to reject this contract
// outright" question) -- conflating the two would hide a rising failure rate
// behind an unaffected residual distribution over the survivors.
export function summarizePricingResiduals(scenarioRecords = []) {
  const residuals = []
  let calibrationFailures = 0, convergenceFailures = 0
  for (const scenarioRecord of scenarioRecords || []) {
    for (const scenario of scenarioRecord?.payload?.scenarios || []) {
      const calibration = scenario?.calibration
      if (calibration?.status === 'calibrated' && Number.isFinite(calibration.residual)) residuals.push(calibration.residual)
      else if (calibration?.status && calibration.status !== 'calibrated') calibrationFailures += 1
      if (scenario?.convergence?.converged === false) convergenceFailures += 1
    }
  }
  return { residual: summarizePercentiles(residuals), calibrationFailures, convergenceFailures }
}

// Missing-data reasons from the frozen premarket feature snapshot -- the
// only place per-security "missing events/analytics" actually lives (#211's
// scoring module reads the same field for the same reason).
export function summarizeMissingEvidence(evidenceRecord) {
  const securities = evidenceRecord?.payload?.securities
  if (!Array.isArray(securities)) return { securitiesObserved: null, missingByReason: {} }
  const missingByReason = {}
  for (const security of securities) {
    for (const item of security?.missing || []) {
      if (!item?.reason) continue
      missingByReason[item.reason] = (missingByReason[item.reason] || 0) + 1
    }
  }
  return { securitiesObserved: securities.length, missingByReason }
}

// `null` (not `false`) when the underlying records were never found, so a
// reader can tell "no scan available" apart from "scan ran, watchlist was
// short."
export function summarizeWatchlistCoverage({ watchlistSize, evidenceRecord, decisionRecord }) {
  const securities = evidenceRecord?.payload?.securities
  const candidates = decisionRecord?.payload?.candidates
  const securitiesObserved = Array.isArray(securities) ? securities.length : null
  return {
    watchlistSize,
    securitiesObserved,
    coverageComplete: watchlistSize != null && securitiesObserved != null ? securitiesObserved === watchlistSize : null,
    candidateCount: Array.isArray(candidates) ? candidates.length : null,
  }
}

// Target-vs-actual stage timing straight from the scan-attempt records
// scheduler.js already archives (`createOptionsScheduleAuditRecord`). Their
// `metrics` field is passed through as-is: it was already reduced to
// scalars and redacted for secret-shaped keys before it was ever archived,
// so re-deriving that guarantee here would only be a second, divergent copy
// of it.
export function summarizeStageTimings(scanRecords = []) {
  return (scanRecords || []).map((scanRecord) => {
    const payload = scanRecord?.payload || {}
    const startedLatencyMs = payload.startedAt && payload.scheduledAt ? Date.parse(payload.startedAt) - Date.parse(payload.scheduledAt) : null
    const durationMs = payload.startedAt && payload.endedAt ? Date.parse(payload.endedAt) - Date.parse(payload.startedAt) : null
    return {
      stage: payload.stage ?? null, tradingDate: payload.tradingDate ?? null, status: payload.status ?? null,
      scheduledAt: payload.scheduledAt ?? null, deadlineAt: payload.deadlineAt ?? null,
      startedAt: payload.startedAt ?? null, endedAt: payload.endedAt ?? null, attempt: payload.attempt ?? null,
      startedLatencyMs, durationMs, metrics: payload.metrics ?? null,
    }
  })
}

// ---------------------------------------------------------------------------
// Sanitization -- defense in depth
// ---------------------------------------------------------------------------
//
// Every summarizer above only ever emits counts, percentiles and our own
// enum-shaped reason strings (chainGates.js's rejection reasons, our own
// coverage/calibration statuses) -- structurally, nothing here can carry a
// raw provider message. This pass is the second line, not the first: it
// still strips anything shaped like a credential or a stack trace before a
// report ever reaches the response body.
const SECRET_KEY = /key|token|secret|password|auth|credential|bearer|cookie|session/i
const DROP_KEY = new Set(['stack'])

export function sanitizeOperationsReport(value) {
  if (Array.isArray(value)) return value.map(sanitizeOperationsReport)
  if (!value || typeof value !== 'object') return value
  const clean = {}
  for (const [key, child] of Object.entries(value)) {
    if (DROP_KEY.has(key)) continue
    clean[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitizeOperationsReport(child)
  }
  return clean
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function unavailable(reason) {
  return { policyVersion: OPTIONS_OPERATIONS_POLICY_VERSION, status: 'unavailable', reason, checkedAt: new Date().toISOString() }
}

// Recomputes an owner-facing operations report at read time. Every record it
// reads was already archived by a stage that ran to completion (or recorded
// its own incompleteness); this function performs no retry of its own and,
// on any failure, returns a sanitized `unavailable` state rather than
// throwing -- callers that render an ordinary page must never be able to
// crash because operations diagnostics could not be assembled.
export async function buildOptionsOperationsReport({
  archive, redis, latestManifest, watchlistSize = OPTIONS_WATCHLIST_SNAPSHOT.securities.length,
  now = Date.now, lookbackDays = SCHEDULE_HISTORY_LOOKBACK_DAYS,
} = {}) {
  if (!archive || !redis || typeof latestManifest !== 'function') return unavailable('operations_dependencies_unavailable')
  const nowMs = now()
  const checkedAt = new Date(nowMs).toISOString()

  let killSwitchEngaged = false
  try { killSwitchEngaged = Boolean(await redis.get(OPTIONS_KILL_SWITCH_KEY)) } catch { /* treated as unknown, not engaged; scheduler fails closed independently */ }

  let scheduleHealth
  try {
    const since = new Date(nowMs - lookbackDays * 86400000).toISOString()
    // The one archive read this function makes regardless of how deep the
    // scan history goes -- see the "exactly one archive.list call" test.
    const scanRecords = await archive.list('options-records:scan', nowMs, { since, count: Infinity })
    scheduleHealth = optionsScheduleHealth((scanRecords || []).map((record) => record.payload), nowMs)
    var stageTimings = summarizeStageTimings(scanRecords)
  } catch (error) {
    return sanitizeOperationsReport({ ...unavailable('schedule_history_unavailable'), checkedAt, killSwitchEngaged, detail: String(error?.code || 'read_failed') })
  }

  let manifest
  try { manifest = await latestManifest(archive, redis) } catch { manifest = undefined }
  if (manifest === undefined) return sanitizeOperationsReport({ ...unavailable('latest_scan_unavailable'), checkedAt, killSwitchEngaged, scheduleHealth, stageTimings })
  if (!manifest) {
    return sanitizeOperationsReport({
      policyVersion: OPTIONS_OPERATIONS_POLICY_VERSION, status: 'no_published_scan', checkedAt, killSwitchEngaged, scheduleHealth, stageTimings,
    })
  }

  const byId = new Map((manifest.records || []).map((entry) => [`${entry.type}:${entry.id}`, entry]))
  const read = async (type, id) => (id ? optionsAuditRecord(archive, type, id) : null)
  const chainRecords = await Promise.all([...byId.entries()].filter(([key]) => key.startsWith('chain:')).map(([, entry]) => read('chain', entry.id)))
  const scenarioRecords = await Promise.all([...byId.entries()].filter(([key]) => key.startsWith('scenario:')).map(([, entry]) => read('scenario', entry.id)))
  const decisionEntry = [...byId.values()].find((entry) => entry.type === 'decision')
  const decisionRecord = await read('decision', decisionEntry?.id)

  const tradingDate = manifest.publication?.tradingDate || manifest.scanId?.split(':')[0] || null
  // resolvePremarketContext (openingEvidence.js) already performs the
  // completion-pointer -> scan record -> evidence/decision lookup that the
  // opening stage itself relies on; reusing it here means this report reads
  // no record the scanner would not already have read for the same trading
  // date, and follows exactly one lineage path rather than a second one that
  // could quietly drift from it.
  let evidenceRecord = null, premarketDecisionRecord = null
  try {
    const policyVersion = manifest.scanId?.split(':')[2]
    const premarket = tradingDate && policyVersion ? await resolvePremarketContext({ redis, archive, tradingDate, policyVersion }) : null
    if (premarket) {
      evidenceRecord = { payload: { securities: [...premarket.featuresBySecurity.values()] } }
      premarketDecisionRecord = { payload: { candidates: premarket.candidates } }
    }
  } catch { /* premarket lineage is a bonus view; its absence must not blank the rest of the report */ }

  const report = {
    policyVersion: OPTIONS_OPERATIONS_POLICY_VERSION,
    status: 'ok',
    checkedAt,
    killSwitchEngaged,
    scheduleHealth,
    stageTimings,
    manifestId: manifest.manifestId,
    tradingDate,
    publication: manifest.publication || null,
    r2UncompressedBytes: manifest.storage?.uncompressedBytes ?? null,
    chainQuality: summarizeChainQuality(chainRecords),
    pricingResiduals: summarizePricingResiduals(scenarioRecords),
    finalDecision: { candidateCount: Array.isArray(decisionRecord?.payload?.candidates) ? decisionRecord.payload.candidates.length : null,
      rejectedCount: Array.isArray(decisionRecord?.payload?.rejected) ? decisionRecord.payload.rejected.length : null },
    watchlistCoverage: summarizeWatchlistCoverage({ watchlistSize, evidenceRecord, decisionRecord: premarketDecisionRecord }),
    missingEvidence: summarizeMissingEvidence(evidenceRecord),
  }
  return sanitizeOperationsReport(report)
}

