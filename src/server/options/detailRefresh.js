import { digest } from '../research/archive.js'
import { createOptionsAuditRecord } from './audit.js'
import { archiveOptionsAuditRecord, optionsAuditRecord } from './auditStore.js'
import { createAlpacaOptionsAdapter } from './alpaca.js'
import { buildOptionsChain, OPTIONS_CHAIN_GATE_POLICY_VERSION } from './chainGates.js'
import { OPTIONS_PUBLICATION_POLICY_VERSION } from './publication.js'

function findNulls(value, path = 'payload', found = []) {
  if (value === null) { found.push({ path, reason: 'not_observed_at_refresh' }); return found }
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) findNulls(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, found)
  return found
}

async function morningContract(archive, manifest, contractId, readRecord) {
  const selected = manifest.publication?.selected?.find((item) => item.contractId === contractId)
  const finalChainId = selected?.revalidation?.chainRecordId
  for (const reference of manifest.records.filter((item) => item.type === 'chain' && (!finalChainId || item.id === finalChainId))) {
    const record = await readRecord(archive, 'chain', reference.id)
    const contract = record?.payload?.contracts?.find((item) => item.contractId === contractId)
    if (contract) return { record, contract }
  }
  return null
}

export async function refreshOptionsContractDetail({
  archive, manifest, contractId,
  createAlpaca = createAlpacaOptionsAdapter,
  readRecord = optionsAuditRecord,
  archiveRecord = archiveOptionsAuditRecord,
  now = Date.now,
} = {}) {
  if (!archive || !manifest?.manifestId || !contractId) throw new Error('Detail refresh requires an archived morning contract')
  const original = await morningContract(archive, manifest, contractId, readRecord)
  if (!original) throw Object.assign(new Error('Morning contract not found'), { code: 'contract_not_found' })
  const underlying = original.record.payload.underlying
  const security = { securityId: underlying.securityId, issuerId: underlying.issuerId, ticker: underlying.ticker }
  const refreshedAt = new Date(now()).toISOString()
  const observation = await createAlpaca().optionChain({
    security,
    expirationDateGte: original.contract.expirationDate,
    expirationDateLte: original.contract.expirationDate,
    type: original.contract.type,
    deadline: new Date(now() + 15000).toISOString(),
  })
  const gated = buildOptionsChain({
    security, direction: original.contract.type, tradingDate: refreshedAt.slice(0, 10), optionChainObservation: observation,
  })
  const refreshed = gated.contracts.find((item) => item.contractId === contractId) || null
  const rejection = gated.rejected.find((item) => item.contractId === contractId)
    || (gated.pending.some((item) => item.contractId === contractId) ? { rawId: original.contract.rawId, contractId, reason: 'series_not_yet_open' } : null)
    || (!refreshed ? { rawId: original.contract.rawId, contractId, reason: 'contract_absent_from_refresh' } : null)
  const prefilter = {
    policyVersion: OPTIONS_CHAIN_GATE_POLICY_VERSION,
    publicationPolicyVersion: OPTIONS_PUBLICATION_POLICY_VERSION,
    revision: 'detail-refresh',
    supersedesRecordId: original.record.recordId,
    morningManifestId: manifest.manifestId,
    contractId,
  }
  const payload = {
    underlying: { ...underlying, regularOpenAt: gated.underlying.regularOpenAt, observation: observation.underlying || null },
    contracts: refreshed ? [refreshed] : [],
    rejected: rejection ? [rejection] : [],
    prefilter: { manifestHash: digest(prefilter), ...prefilter },
  }
  const record = createOptionsAuditRecord({
    type: 'chain', scanId: `${manifest.scanId}:detail:${refreshedAt}`,
    availableAt: observation.fetchedAt || refreshedAt,
    source: { provider: 'alpaca', feed: 'owner-detail-refresh', session: 'detail', entitlement: 'basic-free' },
    versions: { code: 'options-detail-refresh-v1', model: 'deterministic-no-model', policy: OPTIONS_CHAIN_GATE_POLICY_VERSION },
    inputHashes: [digest(observation), original.record.recordId, manifest.manifestId],
    payload, missing: findNulls(payload),
  })
  await archiveRecord(archive, record)
  return {
    morning: {
      manifestId: manifest.manifestId, recordId: original.record.recordId,
      availableAt: original.record.availableAt, contract: original.contract,
    },
    refresh: {
      recordId: record.recordId, availableAt: record.availableAt,
      status: refreshed ? 'accepted' : 'rejected', contract: refreshed,
      reason: rejection?.reason || null,
    },
  }
}
