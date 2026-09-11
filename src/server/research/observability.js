import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

// Deliberately not `logs:runs`. That list is shared with request-level routes
// whose polling evicts the nightly run before morning, which is the blind spot
// this key exists to close.
export const RESEARCH_RUNS_KEY = 'research:runs:v1'
const DEFAULT_RUN_HISTORY = 500

// The shared vocabulary. #167's smoke test reports against these same names, so
// the E2E run and production speak one language. Stages are the awaited steps
// the pipeline actually has: admission and review-budget selection happen
// inside `claude_review` and are reported as its metrics rather than invented
// as a boundary the code does not have.
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
  'premarket_check',
  'foundation_sync',
  'foundation_followup',
  'performance_tracking',
  'performance_evaluation',
].map((name) => [name, name])))

const context = new AsyncLocalStorage()

export const withResearchRun = (run, fn) => context.run(run, fn)
export const currentResearchRun = () => context.getStore()

// Bounds, not cosmetics: these records are kept 500-deep, and an HTTP client
// that puts a response body in the message would otherwise carry it into
// storage on every failure.
const MAX_MESSAGE = 600
const MAX_STACK = 2000
const clip = (value, limit) => (typeof value === 'string' && value.length > limit ? `${value.slice(0, limit - 1)}…` : value)

// An Error serializes to `{}`, so every error is flattened to plain fields
// before it reaches JSON.stringify.
function normalizeError(error) {
  if (error == null) return null
  if (error instanceof Error) {
    return { name: error.name, message: clip(error.message, MAX_MESSAGE), stack: clip(error.stack, MAX_STACK) }
  }
  return { name: 'Error', message: clip(String(error), MAX_MESSAGE) }
}

// Metrics are counts and flags, never payloads. Restricting them to scalars
// structurally prevents a model response, filing or post corpus from being
// serialized, rather than relying on every call site to remember.
//
// Redaction errs towards false positives: a wrongly hidden count costs a
// number on a dashboard, a wrongly published token costs the credential.
const SECRET_KEY = /key|token|secret|password|auth|credential|bearer|cookie|session/i

function scalarMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return null
  const safe = {}
  for (const [key, value] of Object.entries(metrics)) {
    if (SECRET_KEY.test(key)) safe[key] = '[redacted]'
    else if (typeof value === 'boolean' || typeof value === 'string') safe[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value
  }
  return safe
}

export function researchLog({ level, error, metrics, ...event }) {
  const run = currentResearchRun()
  const failure = normalizeError(error)
  const counts = scalarMetrics(metrics)
  const severity = level ?? (failure ? 'error' : 'info')
  const record = {
    service: 'research',
    runId: run?.runId ?? null,
    job: run?.job ?? null,
    level: severity,
    ...event,
  }
  if (counts) record.metrics = counts
  if (failure) record.error = failure
  const line = JSON.stringify(record)
  if (severity === 'error') console.error(line)
  else console.log(line)
  return record
}

// A throwing stage is recorded and then propagates. Callers that absorb a
// failure keep doing so in their own catch, which is what keeps the `errors`
// array the API already returns byte-for-byte unchanged.
export async function stage(name, work, { metrics } = {}) {
  researchLog({ stage: name, event: 'stage_started' })
  const startedAt = Date.now()
  try {
    const result = await work()
    remember(researchLog({
      stage: name,
      event: 'stage_completed',
      status: 'success',
      durationMs: Date.now() - startedAt,
      metrics: typeof metrics === 'function' ? metrics(result) : metrics,
    }))
    return result
  } catch (error) {
    remember(researchLog({
      stage: name,
      event: 'stage_failed',
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error,
    }))
    throw error
  }
}

/** Record deliberately deferred optional work without pretending it succeeded. */
export function skipStage(name, reason, metrics) {
  const record = researchLog({
    stage: name,
    event: 'stage_skipped',
    status: 'skipped',
    metrics: { reason, ...metrics },
  })
  remember(record)
  return record
}

// The persisted stage record reuses the emitted one, so redaction and the
// scalar filter apply to storage exactly as they apply to the log line.
function remember({ stage: name, status, durationMs, metrics, error }) {
  const run = currentResearchRun()
  if (!run?.stages) return
  run.stages.push({ stage: name, status, durationMs, ...(metrics && { metrics }), ...(error && { error }) })
}

const OUTCOME_PRIORITY = { discovered: 1, not_reviewed: 2, reviewed_rejected: 3, accepted: 4, published: 5 }
const unique = (values) => [...new Set(values.filter((value) => value !== null && value !== undefined))]
const DISCOVERY_SOURCES = new Set(['SEC', 'Exa / news', 'Screener / technical', 'News', 'X / attention', 'Attention'])

const catalystMetadata = (pick = {}) => Object.fromEntries([
  'catalystVerified', 'catalystDetail', 'catalystDate', 'catalystTimeline',
  'catalystPricedIn', 'catalystConfidence', 'catalystInWindow', 'catalystSources',
].filter((key) => pick[key] !== undefined).map((key) => [key, pick[key]]))

function traceMetadata(candidate = {}) {
  const rawEvidence = Array.isArray(candidate.evidence) ? candidate.evidence : []
  const rawSources = Array.isArray(candidate.sources) ? candidate.sources : [...(candidate.sources || [])]
  const evidence = rawEvidence.slice(0, 10).map((item) => ({
    id: item.id,
    strategy: item.strategy || item.strategyFamily,
    horizon: item.horizon,
    source: item.source?.url ? undefined : item.source,
    type: item.type || item.source?.form || (item.source?.accession ? 'SEC filing' : undefined),
  }))
  return {
    ticker: candidate.ticker ?? null,
    securityId: candidate.securityId ?? null,
    name: candidate.name ?? null,
    ...(candidate.priority !== undefined && { priority: candidate.priority }),
    ...(candidate.priorityProposal && { priorityProposal: candidate.priorityProposal }),
    ...(candidate.overallRank !== undefined && { overallRank: candidate.overallRank }),
    ...(candidate.proposedOverallRank !== undefined && { proposedOverallRank: candidate.proposedOverallRank }),
    ...(candidate.streamRanks && { streamRanks: candidate.streamRanks }),
    ...(candidate.proposedStreamRanks && { proposedStreamRanks: candidate.proposedStreamRanks }),
    ...(candidate.admission && { admission: candidate.admission }),
    ...(candidate.budgetUsage && { budgetUsage: candidate.budgetUsage }),
    ...(candidate.evidenceCount !== undefined && { evidenceCount: candidate.evidenceCount }),
    ...(candidate.evidenceTruncated && { evidenceTruncated: true }),
    ...(evidence.length && { evidence }),
    strategies: unique([...(candidate.strategies || []), ...(candidate.streams || []), candidate.strategyFamily]),
    horizons: unique([...(candidate.horizons || []), candidate.horizon]).sort((a, b) => a - b),
    sources: unique(rawSources.filter((source) => DISCOVERY_SOURCES.has(source))),
    duplicateAcrossStreams: candidate.duplicateAcrossStreams ?? (candidate.streams || []).length > 1,
  }
}

// One coherent trace per security. Admission metadata is laid down first, then
// review and publication facts upgrade that same row. Ticker fallback joins a
// pick that omitted its stable ID, while two different stable IDs are never
// merged merely because a ticker was reused.
export function candidateTraces({ board = [], admission, primaryReview, accepted = [], published = [] } = {}) {
  const audit = admission?.audit || {}
  const traces = [], bySecurity = new Map(), byTicker = new Map()
  const add = (candidate, outcome = {}) => {
    const metadata = traceMetadata(candidate)
    if (!metadata.securityId && !metadata.ticker) return
    let index = metadata.securityId ? bySecurity.get(metadata.securityId) : undefined
    const tickerIndex = metadata.ticker ? byTicker.get(metadata.ticker) : undefined
    if (index === undefined && tickerIndex !== undefined) {
      const existingId = traces[tickerIndex].securityId
      if (!existingId || !metadata.securityId || existingId === metadata.securityId) index = tickerIndex
    }
    if (index === undefined) {
      index = traces.length
      traces.push(metadata)
    } else {
      const current = traces[index]
      traces[index] = {
        ...current,
        ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined)),
        strategies: unique([...(current.strategies || []), ...(metadata.strategies || [])]),
        horizons: unique([...(current.horizons || []), ...(metadata.horizons || [])]).sort((a, b) => a - b),
        sources: unique([...(current.sources || []), ...(metadata.sources || [])]),
        evidence: metadata.evidence?.length ? metadata.evidence : current.evidence,
      }
    }
    const current = traces[index]
    if (outcome.outcome && (OUTCOME_PRIORITY[outcome.outcome] || 0) >= (OUTCOME_PRIORITY[current.outcome] || 0)) {
      traces[index] = { ...current, ...outcome }
    } else {
      const descriptive = Object.fromEntries(Object.entries(outcome).filter(([key]) => !['outcome', 'reason', 'reviewed', 'sentToClaude', 'claudeStatus'].includes(key)))
      traces[index] = { ...current, ...descriptive }
    }
    if (traces[index].securityId) bySecurity.set(traces[index].securityId, index)
    if (traces[index].ticker) byTicker.set(traces[index].ticker, index)
  }

  const selected = audit.selected?.length ? audit.selected : admission?.candidates || []
  selected.forEach((candidate) => add(candidate, {
    outcome: 'discovered', discovered: true, eligible: true, admitted: true,
    reviewed: false, sentToClaude: false, claudeStatus: 'not_sent',
    reason: 'Admitted to the review budget',
  }))
  ;(audit.rejected || []).forEach((entry) => add(entry, {
    outcome: 'discovered', discovered: true, eligible: false, admitted: false,
    reviewed: false, sentToClaude: false, claudeStatus: 'not_sent', reason: entry.reason,
  }))
  ;(audit.notReviewed || []).forEach((entry) => add(entry, {
    outcome: 'not_reviewed', discovered: true, eligible: true, admitted: false,
    reviewed: false, sentToClaude: false, claudeStatus: 'not_sent', reason: entry.reason,
  }))
  // This is the exact board serialized into the attention-review prompt.
  board.forEach((entry) => add(entry, {
    outcome: 'reviewed_rejected', discovered: true, eligible: true, admitted: true,
    reviewed: true, sentToClaude: true, claudeStatus: 'reviewed_not_selected',
    reason: 'Claude reviewed this candidate but did not select it',
  }))

  const primarySent = new Set(primaryReview?.reviewedSecurityIds || [])
  ;(primaryReview?.decisions || []).forEach((decision) => {
    const sentToClaude = primarySent.has(decision.securityId) || Boolean(decision.completedAt)
    const acceptedByClaude = sentToClaude && decision.status === 'accepted'
    add(decision, {
      outcome: acceptedByClaude ? 'accepted' : sentToClaude ? 'reviewed_rejected' : 'discovered',
      reviewed: sentToClaude,
      sentToClaude,
      claudeStatus: acceptedByClaude ? 'accepted' : sentToClaude ? 'reviewed_not_selected' : 'not_sent',
      reason: decision.reason,
      finalScore: decision.score,
    })
  })
  Object.values(primaryReview?.picksByHorizon || {}).flat().forEach((pick) => add(pick, {
    outcome: 'accepted',
    reviewed: true,
    sentToClaude: true,
    claudeStatus: 'accepted',
    reason: pick.reason,
    finalScore: pick.finalScore,
    catalystVerified: pick.catalystVerified,
  }))
  accepted.forEach((pick) => add(pick, {
    outcome: 'accepted', reviewed: true, sentToClaude: true, claudeStatus: 'accepted',
    reason: pick.reason, finalScore: pick.finalScore, ...catalystMetadata(pick),
  }))
  const horizonRanks = new Map()
  published.forEach((pick) => {
    const horizon = pick.horizon || 5
    const rank = (horizonRanks.get(horizon) || 0) + 1
    horizonRanks.set(horizon, rank)
    add(pick, {
      outcome: 'published', reviewed: true, sentToClaude: true, claudeStatus: 'accepted',
      rank, reason: pick.reason, finalScore: pick.finalScore, ...catalystMetadata(pick),
    })
  })

  return traces.sort((a, b) => (OUTCOME_PRIORITY[b.outcome] || 0) - (OUTCOME_PRIORITY[a.outcome] || 0)
    || (a.overallRank ?? Number.MAX_SAFE_INTEGER) - (b.overallRank ?? Number.MAX_SAFE_INTEGER)
    || String(a.ticker || a.securityId).localeCompare(String(b.ticker || b.securityId)))
}

export function admissionRunSummary(admission, traces = []) {
  const audit = admission?.audit || {}
  if (!audit.funnel && !audit.streams) return null
  return {
    ...(audit.priorityProposal && { priorityProposal: audit.priorityProposal }),
    funnel: {
      ...audit.funnel,
      sentToClaude: traces.filter((candidate) => candidate.sentToClaude).length,
      claudeAccepted: traces.filter((candidate) => candidate.claudeStatus === 'accepted').length,
      published: traces.filter((candidate) => candidate.outcome === 'published').length,
    },
    streams: audit.streams || [],
    reallocations: audit.reallocations || [],
  }
}

/** Attach this run's candidate traces and admission diagnostic to its summary. */
export function recordCandidates(traces, admission) {
  const run = currentResearchRun()
  if (run) {
    run.candidates = traces
    run.admission = admissionRunSummary(admission, traces)
  }
}

function runHistoryLimit(raw = process.env.RESEARCH_RUN_LOG_LIMIT) {
  const configured = Number(raw)
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_RUN_HISTORY
}

async function persistRun(redis, summary) {
  if (!redis) return
  try {
    await redis.lpush(RESEARCH_RUNS_KEY, JSON.stringify(summary))
    await redis.ltrim(RESEARCH_RUNS_KEY, 0, runHistoryLimit() - 1)
  } catch (error) {
    // Observability must never be the reason a research run fails.
    console.error(`[research] run summary not persisted: ${error.message}`)
  }
}

export async function recordResearchRun(redis, { job, runId = randomUUID() }, work) {
  const run = { runId, job, startedAt: new Date().toISOString(), stages: [] }
  const startedAt = Date.now()
  let fatal = false
  try {
    return await withResearchRun(run, work)
  } catch (error) {
    fatal = true
    throw error
  } finally {
    await persistRun(redis, {
      runId,
      job,
      startedAt: run.startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      status: fatal ? 'failed' : run.stages.some((s) => s.status !== 'success') ? 'partial' : 'success',
      stages: run.stages,
      candidates: run.candidates || [],
      admission: run.admission || null,
    })
  }
}
