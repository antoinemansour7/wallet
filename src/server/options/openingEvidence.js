import { createOptionsAuditRecord } from './audit.js'
import { readCompletedOptionsStage, runBounded } from './scheduler.js'
import { optionsAuditRecord } from './auditStore.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'
import { createAlpacaOptionsAdapter } from './alpaca.js'
import { buildOptionsChain, OPTIONS_CHAIN_GATE_POLICY_VERSION } from './chainGates.js'
import { digest } from '../research/archive.js'
import {
  compareRevalidatedQuote, createOpeningAuditRecords, OPTIONS_PUBLICATION_POLICY,
  scoreOpeningChains, scoreOpeningContract,
} from './publication.js'
import { rankOptionsScores } from './scoring.js'

const DAY = 86400000
const DTE_MIN = 7
const DTE_MAX = 60
const OPENING_WORKER_VERSION = 'options-opening-chain-worker-v1'

// Same pattern as premarketEvidence.js's findNulls: createOptionsAuditRecord
// requires every null in the payload to have a matching missing-path entry.
function findNulls(value, path = 'payload', found = []) {
  if (value === null) { found.push({ path, reason: 'not_observed_at_freeze' }); return found }
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) findNulls(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, found)
  return found
}

function expirationRange(tradingDate) {
  const base = Date.parse(`${tradingDate}T00:00:00Z`)
  return {
    expirationDateGte: new Date(base + DTE_MIN * DAY).toISOString().slice(0, 10),
    expirationDateLte: new Date(base + DTE_MAX * DAY).toISOString().slice(0, 10),
  }
}

// #208's frozen premarket decision is found the same way its own spec
// documents: completion pointer -> scan audit record -> metrics.decisionRecordId -> decision record.
async function resolvePremarketContext({ redis, archive, tradingDate, policyVersion }) {
  const completion = await readCompletedOptionsStage(redis, { tradingDate, stage: 'premarket', policyVersion })
  if (!completion?.auditRecordId) return null
  const scanRecord = await optionsAuditRecord(archive, 'scan', completion.auditRecordId)
  const decisionRecordId = scanRecord?.payload?.metrics?.decisionRecordId
  const evidenceRecordId = scanRecord?.payload?.metrics?.evidenceRecordId
  if (!decisionRecordId || !evidenceRecordId) return null
  const decisionRecord = await optionsAuditRecord(archive, 'decision', decisionRecordId)
  const evidenceRecord = await optionsAuditRecord(archive, 'evidence', evidenceRecordId)
  if (!decisionRecord?.payload?.candidates || !evidenceRecord?.payload?.securities) return null
  return {
    candidates: decisionRecord.payload.candidates,
    featuresBySecurity: new Map(evidenceRecord.payload.securities.map((record) => [record.security.securityId, record])),
    recordIds: [completion.auditRecordId, decisionRecordId, evidenceRecordId],
  }
}

// A contract "pending" only on the regular-open timing gets retried in
// place -- the whole chain is refetched (metadata rarely changes, snapshots
// do) since Alpaca has no cheaper single-contract requote endpoint.
async function fetchChainWithRetry({ alpaca, security, direction, tradingDate, expiration, deadlineAt, maxRetries, retryDelayMs, sleep, now }) {
  let observation = await alpaca.optionChain({ security, ...expiration, type: direction, deadline: deadlineAt })
  let chain = buildOptionsChain({ security, direction, tradingDate, optionChainObservation: observation })
  let attempts = 1
  while (chain.pending.length && attempts <= maxRetries && Date.parse(deadlineAt) - now() > retryDelayMs + 5000) {
    await sleep(retryDelayMs)
    observation = await alpaca.optionChain({ security, ...expiration, type: direction, deadline: deadlineAt })
    chain = buildOptionsChain({ security, direction, tradingDate, optionChainObservation: observation })
    attempts += 1
  }
  return { chain, observation, attempts, rawInputHash: digest(observation) }
}

function finalizeChain(chain, observation = null) {
  const stillPending = chain.pending.map((contract) => ({ rawId: contract.rawId, contractId: contract.contractId, reason: 'series_not_yet_open' }))
  return {
    underlying: { ...chain.underlying, observation: observation?.underlying || null },
    contracts: chain.contracts,
    rejected: [...chain.rejected, ...stillPending],
  }
}

function unavailableChain(security, direction, reason) {
  return {
    underlying: { securityId: security.securityId, issuerId: security.issuerId, ticker: security.ticker, direction, regularOpenAt: null, observation: null },
    contracts: [],
    rejected: [{ rawId: `unavailable:${security.ticker}`, contractId: `unavailable:${security.ticker}`, reason }],
  }
}

function chainAuditRecord({ final, direction, tradingDate, scanId, availableAt, rawInputHash, expiration, revision = 'opening' }) {
  const prefilterManifest = { policyVersion: OPTIONS_CHAIN_GATE_POLICY_VERSION, tradingDate, direction, revision, ...expiration }
  const payload = {
    underlying: final.underlying, contracts: final.contracts, rejected: final.rejected,
    prefilter: { manifestHash: digest(prefilterManifest), ...prefilterManifest },
  }
  return createOptionsAuditRecord({
    type: 'chain', scanId, availableAt,
    source: { provider: 'alpaca', feed: revision === 'opening' ? 'options-chain-gates' : 'selected-quote-revalidation', session: 'opening', entitlement: 'basic-free' },
    versions: { code: OPENING_WORKER_VERSION, model: 'deterministic-no-model', policy: OPTIONS_CHAIN_GATE_POLICY_VERSION },
    inputHashes: [rawInputHash], payload, missing: findNulls(payload),
  })
}

function rejectScoreForRevalidation(score, reason) {
  return {
    ...score,
    status: 'ineligible', score: null, componentPoints: null, penaltyPoints: null,
    components: [], penalties: [], inapplicablePenalties: [],
    blockers: [{ code: 'final_quote_revalidation_failed', detail: reason }],
    missing: score.missing || [],
  }
}

export async function runOptionsOpeningStage({
  window, deadlineAt, archive, redis,
  watchlist = OPTIONS_WATCHLIST_SNAPSHOT,
  createAlpaca = createAlpacaOptionsAdapter,
  maxRetries = 3, retryDelayMs = 20000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
} = {}) {
  const tradingDate = window.tradingDate
  const scanId = `${tradingDate}:opening:${window.policyVersion}`
  const premarket = await resolvePremarketContext({ redis, archive, tradingDate, policyVersion: window.policyVersion })
  if (!premarket) {
    return {
      status: 'incomplete', reason: 'premarket_stage_unavailable', records: [],
      metrics: { premarketShortlistAvailable: false, securityCount: 0, acceptedCount: 0, rejectedCount: 0 },
    }
  }
  const { candidates, featuresBySecurity } = premarket
  if (candidates.some((candidate) => !featuresBySecurity.has(candidate.securityId))) {
    return {
      status: 'incomplete', reason: 'premarket_feature_lineage_incomplete', records: [],
      metrics: { premarketShortlistAvailable: true, securityCount: candidates.length, acceptedCount: 0, rejectedCount: 0 },
    }
  }

  const bySecurityId = new Map(watchlist.securities.map((security) => [security.securityId, security]))
  let alpaca, alpacaAvailable = true
  try { alpaca = createAlpaca() } catch { alpacaAvailable = false }

  const expiration = expirationRange(tradingDate)
  let acceptedCount = 0, rejectedCount = 0, retriedCount = 0, primaryCount = 0, edgeCount = 0

  const fetchedEntries = await runBounded(candidates, 3, async (candidate) => {
    const security = bySecurityId.get(candidate.securityId)
    if (!security) return null
    let final, rawInputHash, underlying = null, available = true
    if (!alpacaAvailable) {
      final = unavailableChain(security, candidate.direction, 'alpaca_unavailable')
      rawInputHash = digest({ unavailable: security.ticker })
      available = false
    } else {
      try {
        const fetched = await fetchChainWithRetry({ alpaca, security, direction: candidate.direction, tradingDate, expiration, deadlineAt, maxRetries, retryDelayMs, sleep, now })
        final = finalizeChain(fetched.chain, fetched.observation)
        underlying = fetched.observation.underlying
        rawInputHash = fetched.rawInputHash
        if (fetched.attempts > 1) retriedCount += 1
      } catch {
        final = unavailableChain(security, candidate.direction, 'chain_fetch_unavailable')
        rawInputHash = digest({ unavailable: security.ticker })
        available = false
      }
    }

    acceptedCount += final.contracts.length
    rejectedCount += final.rejected.length
    for (const contract of final.contracts) { if (contract.cohort === 'primary') primaryCount += 1; else edgeCount += 1 }

    const availableAt = new Date(now()).toISOString()
    const record = chainAuditRecord({ final, direction: candidate.direction, tradingDate, scanId, availableAt, rawInputHash, expiration })
    return { security, direction: candidate.direction, chain: final, underlying, chainRecord: record, available }
  })

  const entries = fetchedEntries.filter(Boolean)
  const availableEntries = entries.filter((entry) => entry.available)
  if (candidates.length && !availableEntries.length) {
    return {
      status: 'incomplete', reason: 'opening_chain_unavailable', records: [],
      metrics: { premarketShortlistAvailable: true, securityCount: candidates.length, alpacaAvailable, acceptedCount, rejectedCount },
    }
  }

  let evaluation = scoreOpeningChains({ entries: availableEntries, featuresBySecurity, tradingDate })
  const initialScenarios = [...evaluation.scenarios]
  const observations = new Map()
  for (const entry of availableEntries) {
    for (const contract of entry.chain.contracts) observations.set(contract.contractId, { contract, underlying: entry.underlying, revalidation: null })
  }

  const revalidationRecords = []
  const refreshedGroups = new Map()
  let scores = [...evaluation.scores]
  let ranking = evaluation.ranking
  for (let pass = 1; pass <= OPTIONS_PUBLICATION_POLICY.maxRevalidationPasses; pass += 1) {
    const pending = ranking.displayed.filter((selected) => !observations.get(selected.contract.contractId)?.revalidation)
    if (!pending.length) break
    const groups = new Map()
    for (const selected of pending) {
      const key = `${selected.securityId}:${selected.direction}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(selected)
    }
    for (const [key, selectedScores] of groups) {
      const initial = availableEntries.find((entry) => `${entry.security.securityId}:${entry.direction}` === key)
      let refreshed = refreshedGroups.get(key)
      if (!refreshed && initial && alpacaAvailable) {
        try {
          const fetched = await fetchChainWithRetry({
            alpaca, security: initial.security, direction: initial.direction, tradingDate, expiration, deadlineAt,
            maxRetries: 0, retryDelayMs, sleep, now,
          })
          const final = finalizeChain(fetched.chain, fetched.observation)
          const availableAt = new Date(now()).toISOString()
          const record = chainAuditRecord({
            final, direction: initial.direction, tradingDate, scanId, availableAt,
            rawInputHash: fetched.rawInputHash, expiration, revision: `prepublication-${pass}`,
          })
          revalidationRecords.push(record)
          refreshed = { chain: final, underlying: fetched.observation.underlying, record }
        } catch {
          refreshed = { error: 'revalidation_fetch_unavailable' }
        }
        refreshedGroups.set(key, refreshed)
      }
      for (const selected of selectedScores) {
        const index = scores.findIndex((item) => item.contract.contractId === selected.contract.contractId)
        const original = observations.get(selected.contract.contractId)
        const contract = refreshed?.chain?.contracts.find((item) => item.contractId === selected.contract.contractId)
        if (!initial || !contract || !refreshed?.underlying) {
          scores[index] = rejectScoreForRevalidation(scores[index], refreshed?.error || 'contract_failed_refreshed_gates')
          observations.set(selected.contract.contractId, { ...original, revalidation: { status: 'rejected', pass, reason: refreshed?.error || 'contract_failed_refreshed_gates' } })
          continue
        }
        const comparison = compareRevalidatedQuote(original.contract, contract, original.underlying, refreshed.underlying)
        const rescored = scoreOpeningContract({
          security: initial.security, direction: initial.direction, contract, underlying: refreshed.underlying,
          feature: featuresBySecurity.get(initial.security.securityId), tradingDate,
        })
        rescored.scenario.purpose = 'revalidation_ranking'
        initialScenarios.push(rescored.scenario)
        scores[index] = rescored.score
        observations.set(contract.contractId, {
          contract, underlying: refreshed.underlying,
          revalidation: { status: comparison.material ? 'recomputed_material_change' : 'confirmed', pass, comparison, chainRecordId: refreshed.record.recordId },
        })
      }
    }
    ranking = rankOptionsScores(scores)
  }

  while (ranking.displayed.some((entry) => !observations.get(entry.contract.contractId)?.revalidation)) {
    for (const selected of ranking.displayed.filter((entry) => !observations.get(entry.contract.contractId)?.revalidation)) {
      const index = scores.findIndex((item) => item.contract.contractId === selected.contract.contractId)
      scores[index] = rejectScoreForRevalidation(scores[index], 'revalidation_budget_exhausted')
      observations.set(selected.contract.contractId, {
        ...observations.get(selected.contract.contractId),
        revalidation: { status: 'rejected', reason: 'revalidation_budget_exhausted' },
      })
    }
    ranking = rankOptionsScores(scores)
  }

  const fullScenarios = []
  for (const selected of ranking.displayed) {
    const initial = availableEntries.find((entry) => entry.security.securityId === selected.securityId && entry.direction === selected.direction)
    const observed = observations.get(selected.contract.contractId)
    if (!initial || !observed?.contract || !observed?.underlying) continue
    const detailed = scoreOpeningContract({
      security: initial.security, direction: initial.direction, contract: observed.contract, underlying: observed.underlying,
      feature: featuresBySecurity.get(initial.security.securityId), tradingDate, fullScenarios: true,
    })
    detailed.scenario.purpose = 'selected_full_matrix'
    fullScenarios.push(detailed.scenario)
  }

  const availableAt = new Date(now()).toISOString()
  const chainRecords = [...entries.map((entry) => entry.chainRecord), ...revalidationRecords]
  const built = createOpeningAuditRecords({
    scanId, tradingDate, availableAt, ranking, scenarios: [...initialScenarios, ...fullScenarios],
    chainRecordIds: chainRecords.map((record) => record.recordId), premarketRecordIds: premarket.recordIds,
    observations, completeness: entries.some((entry) => !entry.available) ? 'partial' : 'complete',
  })
  const records = [...chainRecords, built.scenarioRecord, built.scoreRecord, built.decisionRecord, built.outcomeRecord, built.publicationRecord]

  return {
    status: 'complete',
    scanId,
    availableAt,
    publication: built.publicationRecord.payload,
    records,
    metrics: {
      premarketShortlistAvailable: true, securityCount: candidates.length, alpacaAvailable,
      acceptedCount, rejectedCount, retriedCount, primaryCount, edgeCount,
      scoredCount: ranking.ranked.length, selectedCount: ranking.displayed.length,
      publicationRecordId: built.publicationRecord.recordId, scoreRecordId: built.scoreRecord.recordId,
      outcomeRecordId: built.outcomeRecord.recordId,
    },
  }
}
