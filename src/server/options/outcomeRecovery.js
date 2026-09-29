import { archiveOptionsAuditRecord, optionsAuditRecord } from './auditStore.js'
import { createOutcomeCaptureAuditRecord, createOutcomeCapturePlan } from './observations.js'

// Mornings published before chain contracts carried their security identity
// stored an outcome record with no plans, so none of their picks was ever
// observed. Published records are immutable; a recovery is a second outcome
// record for the same scan, indexed on its own so readers can find it without
// mistaking the original for one.
export const OUTCOME_RECOVERY_FEED = 'outcome-plan-recovery'
const recoveryIndex = (scanId) => `options-outcome-recovery:${scanId}`

export function archiveOutcomeRecovery(archive, record) {
  if (record?.source?.feed !== OUTCOME_RECOVERY_FEED) throw new Error('Only an outcome plan recovery can be archived as one')
  return archiveOptionsAuditRecord(archive, record, { indexes: [recoveryIndex(record.scanId)] })
}

/** Plans recovered for one published scan, with the scan they belong to. */
export async function recoveredOutcomePlans(archive, scanId, asOf = Date.now()) {
  const records = await archive.list(recoveryIndex(scanId), asOf)
  return records.flatMap((record) => (record.payload?.outcomes || []).map((plan) => ({ ...plan, scanId: record.scanId })))
}

/**
 * The recovery record for one manifest: a plan for every published contract
 * that has none, built exactly as the opening scan now builds it. A contract
 * that cannot be planned is reported, never dropped silently.
 */
export async function buildOutcomeRecovery({ archive, manifest, availableAt, readRecord = optionsAuditRecord }) {
  const publication = manifest?.publication
  if (!publication?.selected?.length) return { plans: [], unrecoverable: [], record: null }
  const refs = manifest.records || []
  const read = async (type) => (await Promise.all(refs.filter((ref) => ref.type === type).map((ref) => readRecord(archive, type, ref.id)))).filter(Boolean)
  const [chains, outcomes] = await Promise.all([read('chain'), read('outcome')])
  const planned = new Set([
    ...outcomes.flatMap((record) => record.payload.outcomes || []),
    ...await recoveredOutcomePlans(archive, manifest.scanId),
  ].map((plan) => plan.contract.contractId))

  const plans = [], unrecoverable = [], evidence = new Set()
  for (const selected of publication.selected) {
    if (planned.has(selected.contractId)) continue
    const chain = selected.revalidation?.chainRecordId
      ? chains.find((record) => record.recordId === selected.revalidation.chainRecordId)
      : chains.find((record) => record.payload.contracts.some((item) => item.contractId === selected.contractId))
    const contract = chain?.payload.contracts.find((item) => item.contractId === selected.contractId)
    const { securityId, issuerId } = chain?.payload.underlying || {}
    if (!contract) { unrecoverable.push({ contractId: selected.contractId, reason: 'chain_evidence_unavailable' }); continue }
    if (!securityId || !issuerId) { unrecoverable.push({ contractId: selected.contractId, reason: 'security_identity_unavailable' }); continue }
    plans.push(createOutcomeCapturePlan({
      scanId: manifest.scanId, tradingDate: publication.tradingDate,
      entryAt: selected.quoteMarketAt || publication.availableAt,
      contract: { ...contract, securityId, issuerId },
    }))
    evidence.add(chain.recordId)
  }
  const record = plans.length ? createOutcomeCaptureAuditRecord({
    scanId: manifest.scanId, availableAt, plans, inputHashes: [...evidence], feed: OUTCOME_RECOVERY_FEED,
  }) : null
  return { plans, unrecoverable, record }
}
