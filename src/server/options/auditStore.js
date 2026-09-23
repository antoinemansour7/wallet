import { digest } from '../research/archive.js'
import { OPTIONS_RECORD_TYPES, validateOptionsAuditRecord } from './audit.js'
import { publicationProjection } from './publication.js'

export const OPTIONS_LATEST_POINTER_KEY = 'research:options:latest:v1'
export const OPTIONS_SCAN_LOCK_KEY = 'research:options:scan:lock:v1'

const PUBLISH_LUA = "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end local prior = redis.call('get', KEYS[3]) if prior then if prior == ARGV[3] then return 2 else return -1 end end redis.call('set', KEYS[2], ARGV[2]) redis.call('set', KEYS[3], ARGV[3]) return 1"

export async function archiveOptionsAuditRecord(archive, record) {
  validateOptionsAuditRecord(record)
  const definition = OPTIONS_RECORD_TYPES[record.recordType]
  return archive.put(definition.kind, record.recordId, record,
    [`options-records:${record.recordType}`, `options-records:scan:${record.scanId}`], record.availableAt)
}
export async function commitOptionsScan({
  archive, redis, records, scanId, availableAt, lockKey = OPTIONS_SCAN_LOCK_KEY, lockToken, requirePublication = false,
} = {}) {
  if (!archive || !redis || !Array.isArray(records) || !records.length) throw new Error('Options scan commit requires archive, Redis and records')
  if (!lockToken || await redis.get(lockKey) !== lockToken) throw new Error('Options scan publication lock is not owned')
  if (records.some((record) => record.scanId !== scanId)) throw new Error('Options scan records do not share the manifest scanId')
  const publicationRecords = records.filter((record) => publicationProjection(record))
  if (requirePublication && publicationRecords.length !== 1) throw new Error('Options scan publication requires exactly one publication record')
  const publication = publicationRecords.length === 1 ? publicationProjection(publicationRecords[0]) : null
  if (requirePublication) {
    const archivedIds = new Set(records.map((record) => record.recordId))
    for (const key of ['scenarioRecordId', 'scoreRecordId', 'decisionRecordId']) {
      if (!archivedIds.has(publicationRecords[0].payload.lineage?.[key])) throw new Error(`Options publication is missing ${key}`)
    }
    if (publication.result === 'candidates' && !records.some((record) => record.recordType === 'chain')) {
      throw new Error('Options publication with candidates requires chain evidence')
    }
  }
  for (const record of records) {
    await archiveOptionsAuditRecord(archive, record)
  }

  const manifestBase = {
    schemaVersion: 'options-scan-manifest-v1',
    scanId,
    availableAt,
    records: records.map((record) => ({ type: record.recordType, kind: record.archiveKind, id: record.recordId,
      byteLength: record.byteLength, count: Array.isArray(record.payload.contracts) ? record.payload.contracts.length
        : Array.isArray(record.payload.candidates) ? record.payload.candidates.length
          : Array.isArray(record.payload.scores) ? record.payload.scores.length
            : Array.isArray(record.payload.scenarios) ? record.payload.scenarios.length : null })),
    inputHashes: [...new Set(records.flatMap((record) => record.inputHashes))],
    storage: {
      recordBatches: records.length,
      uncompressedBytes: records.reduce((sum, record) => sum + record.byteLength, 0),
      redisShape: 'one pointer per immutable batch plus one manifest and one latest pointer',
    },
    retention: records.map((record) => ({ type: record.recordType, ...record.retention })),
    ...(publication ? { publication } : {}),
  }
  const manifest = { ...manifestBase, manifestId: digest(manifestBase) }
  await archive.put('options-manifest', manifest.manifestId, manifest, 'options-manifests', availableAt)

  const pointer = JSON.stringify({ schemaVersion: 'options-latest-pointer-v1', scanId, manifestId: manifest.manifestId, availableAt })
  const publicationKey = `research:options:publication:v1:${scanId}`
  const published = await redis.eval(PUBLISH_LUA, [lockKey, OPTIONS_LATEST_POINTER_KEY, publicationKey], [lockToken, pointer, manifest.manifestId])
  if (Number(published) === 0) throw new Error('Options scan publication lock was lost')
  if (Number(published) === -1) throw new Error('Options scan publication conflicts with an existing revision')
  if (![1, 2].includes(Number(published))) throw new Error('Options scan publication returned an unsafe state')
  return { manifest, pointer: JSON.parse(pointer), duplicate: Number(published) === 2 }
}

function parsePointer(value) {
  if (!value) return null
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { throw new Error('Invalid options latest pointer') }
  }
  return value
}

export async function latestOptionsManifest(archive, redis) {
  const pointer = parsePointer(await redis.get(OPTIONS_LATEST_POINTER_KEY))
  if (!pointer) return null
  const manifest = await archive.get('options-manifest', pointer.manifestId)
  if (!manifest || manifest.scanId !== pointer.scanId) throw new Error('Options latest pointer is inconsistent')
  return manifest
}

export async function optionsAuditRecord(archive, type, id) {
  const definition = OPTIONS_RECORD_TYPES[type]
  if (!definition || typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return null
  return archive.get(definition.kind, id)
}
