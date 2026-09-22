import { digest } from '../research/archive.js'

export const OPTIONS_AUDIT_SCHEMA_VERSION = 'options-audit-envelope-v1'
export const OPTIONS_RETENTION_POLICY_VERSION = 'options-retention-v1'

export const OPTIONS_RECORD_TYPES = Object.freeze({
  scan: Object.freeze({ kind: 'options-scan', schema: 'options-scan-v1', requiredPayload: ['stage', 'status'] }),
  evidence: Object.freeze({ kind: 'options-evidence', schema: 'options-evidence-v1', requiredPayload: ['securities'] }),
  chain: Object.freeze({ kind: 'options-chain', schema: 'options-chain-v1', requiredPayload: ['underlying', 'contracts', 'rejected', 'prefilter'] }),
  decision: Object.freeze({ kind: 'options-decision', schema: 'options-decision-v1', requiredPayload: ['candidates', 'rejected'] }),
  score: Object.freeze({ kind: 'options-score', schema: 'options-score-v1', requiredPayload: ['scores'] }),
  scenario: Object.freeze({ kind: 'options-scenario', schema: 'options-scenario-v1', requiredPayload: ['scenarios'] }),
  outcome: Object.freeze({ kind: 'options-outcome', schema: 'options-outcome-v1', requiredPayload: ['outcomes'] }),
  policy: Object.freeze({ kind: 'options-policy', schema: 'options-policy-v1', requiredPayload: ['policy'] }),
  diagnostic: Object.freeze({ kind: 'options-diagnostic', schema: 'options-diagnostic-v1', requiredPayload: ['category', 'message'] }),
})

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
const sha256Pattern = /^[a-f0-9]{64}$/
const nanosecondKey = /(?:timestamp.*ns|nanosecond|sipTimestamp)$/i

function assertTimestamp(value, field) {
  if (typeof value !== 'string' || !timestampPattern.test(value)) throw new Error(`${field} must be an RFC3339 timestamp string`)
  const millisecondCompatible = value.replace(/(\.\d{3})\d+/, '$1')
  if (!Number.isFinite(Date.parse(millisecondCompatible))) throw new Error(`${field} must be a valid timestamp`)
}

function validateNumbers(value, path = 'payload') {
  if (typeof value === 'bigint') throw new Error(`${path} cannot contain BigInt; preserve provider integers as strings`)
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error(`${path} contains an unsafe integer`)
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (nanosecondKey.test(key) && child !== null && (typeof child !== 'string' || !/^\d+$/.test(child))) {
      throw new Error(`${path}.${key} must preserve nanoseconds as a decimal string`)
    }
    validateNumbers(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`)
  }
}

function nullPaths(value, path = 'payload', found = []) {
  if (value === null) { found.push(path); return found }
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) nullPaths(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, found)
  return found
}

function addDays(timestamp, days) {
  return new Date(Date.parse(timestamp.replace(/(\.\d{3})\d+/, '$1')) + days * 86400000).toISOString()
}

export function createOptionsRetention({
  availableAt,
  licenseId = 'alpaca-basic-indicative',
  rawPayloadAllowed = false,
  indexDays = 90,
  normalizedDays = 730,
  deletionMode = 'expire-index-then-review-object',
} = {}) {
  assertTimestamp(availableAt, 'availableAt')
  if (!licenseId || !Number.isInteger(indexDays) || indexDays < 1 || !Number.isInteger(normalizedDays) || normalizedDays < indexDays) {
    throw new Error('Invalid options retention policy')
  }
  return {
    policyVersion: OPTIONS_RETENTION_POLICY_VERSION,
    licenseId,
    rawPayloadAllowed: rawPayloadAllowed === true,
    indexExpiresAt: addDays(availableAt, indexDays),
    normalizedArchiveReviewAt: addDays(availableAt, normalizedDays),
    deletionMode,
  }
}

function validateSource(source) {
  for (const field of ['provider', 'feed', 'session', 'entitlement']) {
    if (typeof source?.[field] !== 'string' || !source[field]) throw new Error(`source.${field} is required`)
  }
}

function validateVersions(versions, schema) {
  for (const field of ['code', 'model', 'policy']) {
    if (typeof versions?.[field] !== 'string' || !versions[field]) throw new Error(`versions.${field} is required`)
  }
  if (versions.schema && versions.schema !== schema) throw new Error('versions.schema does not match record type')
}

function validateFieldTimes(fieldTimes) {
  for (const [path, times] of Object.entries(fieldTimes || {})) {
    if (!path || !times || typeof times !== 'object') throw new Error('Invalid fieldTimes entry')
    const present = ['marketAt', 'publicAt', 'availableAt', 'fetchedAt'].filter((field) => times[field] !== undefined)
    if (!present.length) throw new Error(`fieldTimes.${path} has no timestamps`)
    for (const field of present) assertTimestamp(times[field], `fieldTimes.${path}.${field}`)
  }
}

function validateMissing(payload, missing) {
  const reasons = new Map()
  for (const entry of missing || []) {
    if (!entry?.path || !entry?.reason) throw new Error('Missing-data entries require path and reason')
    if (reasons.has(entry.path)) throw new Error(`Duplicate missing-data reason for ${entry.path}`)
    reasons.set(entry.path, entry.reason)
  }
  for (const path of nullPaths(payload)) if (!reasons.has(path)) throw new Error(`Null value requires a missing-data reason: ${path}`)
}

function validatePayload(type, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload must be an object')
  for (const field of OPTIONS_RECORD_TYPES[type].requiredPayload) {
    if (!Object.hasOwn(payload, field)) throw new Error(`${type} payload requires ${field}`)
  }
  if (type === 'chain') {
    if (!payload.underlying?.securityId || !payload.underlying?.issuerId || !payload.underlying?.ticker) throw new Error('chain payload requires normalized underlying identity')
    if (!Array.isArray(payload.contracts) || !Array.isArray(payload.rejected)) throw new Error('chain contracts and rejected must be arrays')
    for (const contract of payload.contracts) {
      if (!contract.rawId || !contract.contractId) throw new Error('chain contracts require rawId and contractId')
      if (contract.openInterest !== undefined && contract.openInterest !== null && !/^\d{4}-\d{2}-\d{2}$/.test(contract.openInterestDate || '')) {
        throw new Error('chain contract open interest requires an as-of date')
      }
    }
    for (const rejection of payload.rejected) if (!rejection.rawId || !rejection.reason) throw new Error('chain rejections require rawId and reason')
    if (!payload.prefilter?.manifestHash || !sha256Pattern.test(payload.prefilter.manifestHash)) throw new Error('chain prefilter requires a manifest hash')
  }
}

export function createOptionsAuditRecord({
  type,
  scanId,
  availableAt,
  source,
  versions,
  inputHashes = [],
  payload,
  fieldTimes = {},
  missing = [],
  retention,
} = {}) {
  const definition = OPTIONS_RECORD_TYPES[type]
  if (!definition) throw new Error(`Unsupported options record type: ${type}`)
  if (typeof scanId !== 'string' || !scanId) throw new Error('scanId is required')
  assertTimestamp(availableAt, 'availableAt')
  validateSource(source)
  validateVersions(versions, definition.schema)
  if (!Array.isArray(inputHashes) || inputHashes.some((hash) => !sha256Pattern.test(hash))) throw new Error('inputHashes must contain SHA-256 values')
  validatePayload(type, payload)
  validateNumbers(payload)
  validateFieldTimes(fieldTimes)
  validateMissing(payload, missing)
  const resolvedRetention = retention || createOptionsRetention({ availableAt })
  if (resolvedRetention.policyVersion !== OPTIONS_RETENTION_POLICY_VERSION) throw new Error('Unsupported options retention policy')
  if (resolvedRetention.rawPayloadAllowed !== true && payload.rawProviderPayload !== undefined) throw new Error('Retention policy forbids raw provider payloads')

  const record = {
    envelopeVersion: OPTIONS_AUDIT_SCHEMA_VERSION,
    recordType: type,
    archiveKind: definition.kind,
    recordSchemaVersion: definition.schema,
    scanId,
    availableAt,
    source,
    versions: { ...versions, schema: definition.schema },
    inputHashes,
    fieldTimes,
    missing,
    retention: resolvedRetention,
    payload,
  }
  return { ...record, recordId: digest(record), byteLength: Buffer.byteLength(JSON.stringify(record)) }
}

export function validateOptionsAuditRecord(record) {
  const rebuilt = createOptionsAuditRecord({ ...record, type: record.recordType })
  if (record.recordId !== rebuilt.recordId || record.byteLength !== rebuilt.byteLength || record.archiveKind !== rebuilt.archiveKind) {
    throw new Error('Options audit record integrity check failed')
  }
  return record
}
