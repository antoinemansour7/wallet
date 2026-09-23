import { createOptionsAuditRecord } from './audit.js'
import { readCompletedOptionsStage, runBounded } from './scheduler.js'
import { optionsAuditRecord } from './auditStore.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'
import { createAlpacaOptionsAdapter } from './alpaca.js'
import { buildOptionsChain, OPTIONS_CHAIN_GATE_POLICY_VERSION } from './chainGates.js'
import { digest } from '../research/archive.js'

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
async function resolvePremarketCandidates({ redis, archive, tradingDate, policyVersion }) {
  const completion = await readCompletedOptionsStage(redis, { tradingDate, stage: 'premarket', policyVersion })
  if (!completion?.auditRecordId) return null
  const scanRecord = await optionsAuditRecord(archive, 'scan', completion.auditRecordId)
  const decisionRecordId = scanRecord?.payload?.metrics?.decisionRecordId
  if (!decisionRecordId) return null
  const decisionRecord = await optionsAuditRecord(archive, 'decision', decisionRecordId)
  return decisionRecord?.payload?.candidates || null
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
  return { chain, attempts, rawInputHash: digest(observation) }
}

function finalizeChain(chain) {
  const stillPending = chain.pending.map((contract) => ({ rawId: contract.rawId, contractId: contract.contractId, reason: 'series_not_yet_open' }))
  return { underlying: chain.underlying, contracts: chain.contracts, rejected: [...chain.rejected, ...stillPending] }
}

function unavailableChain(security, direction, reason) {
  return {
    underlying: { securityId: security.securityId, issuerId: security.issuerId, ticker: security.ticker, direction, regularOpenAt: null },
    contracts: [],
    rejected: [{ rawId: `unavailable:${security.ticker}`, contractId: `unavailable:${security.ticker}`, reason }],
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
  const candidates = await resolvePremarketCandidates({ redis, archive, tradingDate, policyVersion: window.policyVersion })
  if (!candidates || !candidates.length) {
    return { status: 'complete', records: [], metrics: { premarketShortlistAvailable: false, securityCount: 0, acceptedCount: 0, rejectedCount: 0 } }
  }

  const bySecurityId = new Map(watchlist.securities.map((security) => [security.securityId, security]))
  let alpaca, alpacaAvailable = true
  try { alpaca = createAlpaca() } catch { alpacaAvailable = false }

  const expiration = expirationRange(tradingDate)
  const records = []
  let acceptedCount = 0, rejectedCount = 0, retriedCount = 0, primaryCount = 0, edgeCount = 0

  await runBounded(candidates, 3, async (candidate) => {
    const security = bySecurityId.get(candidate.securityId)
    if (!security) return
    let final, rawInputHash
    if (!alpacaAvailable) {
      final = unavailableChain(security, candidate.direction, 'alpaca_unavailable')
      rawInputHash = digest({ unavailable: security.ticker })
    } else {
      try {
        const fetched = await fetchChainWithRetry({ alpaca, security, direction: candidate.direction, tradingDate, expiration, deadlineAt, maxRetries, retryDelayMs, sleep, now })
        final = finalizeChain(fetched.chain)
        rawInputHash = fetched.rawInputHash
        if (fetched.attempts > 1) retriedCount += 1
      } catch {
        final = unavailableChain(security, candidate.direction, 'chain_fetch_unavailable')
        rawInputHash = digest({ unavailable: security.ticker })
      }
    }

    acceptedCount += final.contracts.length
    rejectedCount += final.rejected.length
    for (const contract of final.contracts) { if (contract.cohort === 'primary') primaryCount += 1; else edgeCount += 1 }

    const prefilterManifest = { policyVersion: OPTIONS_CHAIN_GATE_POLICY_VERSION, tradingDate, direction: candidate.direction, ...expiration }
    const payload = { underlying: final.underlying, contracts: final.contracts, rejected: final.rejected, prefilter: { manifestHash: digest(prefilterManifest), ...prefilterManifest } }
    records.push(createOptionsAuditRecord({
      type: 'chain', scanId, availableAt: new Date(now()).toISOString(),
      source: { provider: 'alpaca', feed: 'options-chain-gates', session: 'opening', entitlement: 'basic-free' },
      versions: { code: OPENING_WORKER_VERSION, model: 'deterministic-no-model', policy: OPTIONS_CHAIN_GATE_POLICY_VERSION },
      inputHashes: [rawInputHash], payload, missing: findNulls(payload),
    }))
  })

  return {
    status: 'complete',
    records,
    metrics: {
      premarketShortlistAvailable: true, securityCount: candidates.length, alpacaAvailable,
      acceptedCount, rejectedCount, retriedCount, primaryCount, edgeCount,
    },
  }
}
