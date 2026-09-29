import { digest } from '../research/archive.js'
import { resolvePremarketContext } from './openingEvidence.js'
import { runBounded } from './scheduler.js'
import { createAlpacaOptionsAdapter } from './alpaca.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'
import { buildOptionsChain } from './chainGates.js'
import { scoreOpeningContract } from './publication.js'
import { rankOptionsScores } from './scoring.js'
import { createOutcomeCapturePlan, OPTIONS_OBSERVATION_POLICY } from './observations.js'
import { STEP1_EXPERIMENT_POLICY, buildStep1Experiments } from './step1Experiments.js'
import { accumulateProviderStats, emptyProviderStats, finalizeProviderStats } from './operations.js'

const keyFor = (item) => `${item.securityId}:${item.direction}`
const dateOffset = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

export function removeRegimePoints(score) {
  const points = score.components?.flatMap((component) => component.features || [])
    .filter((feature) => feature.feature === 'marketRegimeAgreement').reduce((sum, feature) => sum + feature.points, 0) || 0
  return { ...score, score: Math.max(0, Math.min(100, score.componentPoints - points - score.penaltyPoints)) }
}

function endpointPlan({ scanId, contract, tradingDate, entryAt }) {
  const full = createOutcomeCapturePlan({ scanId, contract, tradingDate, entryAt,
    policy: { ...OPTIONS_OBSERVATION_POLICY, endpointSessions: [0, 1, 3, 5], pathSampleMinutes: 390 } })
  const { planId: _id, ...base } = full
  const plan = { ...base, policyVersion: STEP1_EXPERIMENT_POLICY.version,
    endpointTargets: full.endpointTargets.filter((target) => target.kind === 'endpoint_close'),
    pathSampling: { ...full.pathSampling, samples: [], limitation: 'Close checkpoints only. Intraday target hits and drawdowns are not measured.' } }
  return { ...plan, planId: digest(plan) }
}

export async function runOptionsExperimentStage({ window, deadlineAt, redis, archive, checkpoint = null, attempt = 1,
  watchlist = OPTIONS_WATCHLIST_SNAPSHOT, createAlpaca = createAlpacaOptionsAdapter,
  resolveContext = resolvePremarketContext, scoreContract = scoreOpeningContract, now = Date.now,
  policy = STEP1_EXPERIMENT_POLICY } = {}) {
  const startedAt = now(), tradingDate = window.tradingDate
  const context = await resolveContext({ redis, archive, tradingDate, policyVersion: window.policyVersion })
  if (!context?.snapshot?.snapshotId) return { status: 'incomplete', reason: 'premarket_stage_unavailable', records: [], metrics: {} }
  const frozen = buildStep1Experiments({ snapshot: context.snapshot, watchlist })
  const scanId = `${tradingDate}:shadow:${policy.version}`
  const adapter = createAlpaca()
  const stats = emptyProviderStats()
  const universe = [...new Map(frozen.arms.flatMap((arm) => arm.requested).map((item) => [keyFor(item), item])).values()]
    // A rotating deterministic order avoids systematically starving Z tickers
    // if the external provider or the compute budget runs out.
    .sort((a, b) => digest([tradingDate, keyFor(a)]).localeCompare(digest([tradingDate, keyFor(b)])))
  // Pricing every contract of ~50 chains is ~2 minutes of CPU on a laptop, so
  // a scan that runs out of function time checkpoints the chains it finished
  // and the QStash retry continues from there. Only the same frozen snapshot
  // resumes; failed or unscanned chains are tried again.
  const resumed = checkpoint?.featureSnapshotId === frozen.featureSnapshotId ? checkpoint.entries || [] : []
  const done = new Map(resumed.map((entry) => [keyFor(entry), entry]))
  // The scheduler abandons the attempt, checkpoint and all, at `deadlineAt`.
  // Scanning (including in-flight chain requests) therefore ends early enough
  // to hand back the checkpoint; a 10 s margin was overrun on 2026-09-28/29.
  const scanDeadline = new Date(Date.parse(deadlineAt) - policy.returnReserveMs).toISOString()
  const outOfTime = () => now() >= Date.parse(scanDeadline)
  const scanned = await runBounded(universe.filter((item) => !done.has(keyFor(item))), policy.maxConcurrency, async (candidate) => {
    const security = watchlist.securities.find((item) => item.securityId === candidate.securityId)
    const missing = (reason) => ({ ...candidate, status: 'unavailable', reason, selections: {} })
    if (outOfTime()) return missing('shadow_budget_exhausted')
    try {
      const observation = await adapter.optionChain({ security, type: candidate.direction,
        expirationDateGte: dateOffset(tradingDate, 7), expirationDateLte: dateOffset(tradingDate, 60), deadline: scanDeadline })
      accumulateProviderStats(stats, observation)
      const chain = buildOptionsChain({ security, direction: candidate.direction, tradingDate, optionChainObservation: observation })
      const scored = [], contracts = new Map()
      for (const item of chain.contracts) {
        if (outOfTime()) return missing('shadow_scoring_budget_exhausted')
        const contract = { ...item, securityId: security.securityId, issuerId: security.issuerId, underlyingTicker: security.ticker }
        const result = scoreContract({ security, direction: candidate.direction, contract, underlying: observation.underlying,
          feature: context.featuresBySecurity.get(security.securityId), tradingDate })
        scored.push(result.score)
        contracts.set(contract.contractId, contract)
      }
      const selections = {}
      for (const [variant, scores] of [['current', scored], ['no_regime', scored.map((score) => score.status === 'scored' ? removeRegimePoints(score) : score)]]) {
        const best = rankOptionsScores(scores, { maxPerUnderlyingDirection: 1 }).displayed[0]
        if (!best) continue
        const contract = contracts.get(best.contract.contractId)
        const entryAt = contract.fetchedAt || observation.fetchedAt || contract.quote.marketAt
        const plan = endpointPlan({ scanId, contract, tradingDate, entryAt })
        const quote = observation.underlying?.quote
        selections[variant] = { contract, plan, score: best.score,
          entry: { quote: contract.quote, underlyingPrice: quote ? (quote.bid + quote.ask) / 2 : null,
            iv: contract.analytics?.impliedVolatility ?? null, volume: contract.volume?.value ?? null },
          rawReferenceHash: observation.rawReferenceHash || digest(observation) }
      }
      return { ...candidate, status: 'complete', reason: Object.keys(selections).length ? null : 'no_eligible_contract', selections,
        acceptedContracts: chain.contracts.length, scoredContracts: scored.filter((score) => score.status === 'scored').length,
        rejectedContracts: chain.rejected.length, pendingContracts: chain.pending.length }
    } catch (error) {
      return missing(error?.code || 'shadow_chain_unavailable')
    }
  })
  const entries = [...done.values(), ...scanned.filter(Boolean)]
  const finished = entries.filter((entry) => entry.status === 'complete')
  const progress = { securities: new Set(universe.map((item) => item.securityId)).size, directions: universe.length,
    availableDirections: finished.length, resumedDirections: done.size, attempt, elapsedMs: now() - startedAt, ...finalizeProviderStats(stats) }
  if (finished.length < universe.length && attempt < policy.maxAttempts && Date.parse(window.deadlineAt) - now() > policy.minRetryWindowMs) {
    return { status: 'incomplete', reason: 'shadow_scan_continues', records: [], metrics: progress,
      checkpoint: { featureSnapshotId: frozen.featureSnapshotId, entries: finished } }
  }
  const byKey = new Map(entries.map((entry) => [keyFor(entry), entry]))
  const observations = new Map()
  const arms = frozen.arms.map((arm) => {
    const variant = arm.id === 'no_regime_both' ? 'no_regime' : 'current'
    const rows = arm.requested.map((candidate) => {
      const entry = byKey.get(keyFor(candidate)), selected = entry?.selections[variant]
      if (!selected) return { ...candidate, status: entry?.status === 'complete' ? 'ineligible' : 'unavailable', reason: entry?.reason || 'shadow_not_scanned', observationId: null }
      const observationId = selected.plan.planId
      // Both Step 2 variants may pick the same contract: one observation, with
      // each variant's score kept rather than whichever arm wrote last.
      const prior = observations.get(observationId)
      const scores = { ...prior?.scores, [variant]: selected.score }
      observations.set(observationId, { ...selected, observationId, score: scores.current ?? selected.score, scores })
      return { ...candidate, status: 'selected', reason: null, observationId }
    })
    return { ...arm, rows }
  })
  const availableAt = new Date(now()).toISOString()
  const experiment = { schemaVersion: 'options-step1-experiment-run-v1', ...frozen, scanId, availableAt,
    policy, arms, observations: [...observations.values()],
    status: finished.length < universe.length ? 'partial' : 'complete',
    entryBasis: 'Fresh indicative quotes after the live scan; all controls share these same observations. One best Step 2 contract per stock and direction.',
    captureBasis: 'Closes at 0, 1, 3 and 5 sessions; +3 is the primary result. No intraday target-hit claim.',
    metrics: { ...progress, selectedContracts: observations.size } }
  return { status: 'complete', scanId, availableAt, records: [], experiment: { ...experiment, experimentId: digest(experiment) },
    metrics: experiment.metrics }
}

export async function archiveOptionsExperiment(archive, experiment) {
  return archive.put('options-experiment', experiment.experimentId, experiment, 'options-experiments', experiment.availableAt)
}
