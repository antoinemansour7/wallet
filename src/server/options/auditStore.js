import { digest } from '../research/archive.js'
import { OPTIONS_RECORD_TYPES, validateOptionsAuditRecord } from './audit.js'

export const OPTIONS_LATEST_POINTER_KEY = 'research:options:latest:v1'
export const OPTIONS_SCAN_LOCK_KEY = 'research:options:scan:lock:v1'

const PUBLISH_LUA = "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('set', KEYS[2], ARGV[2]) return 1"

export async function archiveOptionsAuditRecord(archive, record) {
  validateOptionsAuditRecord(record)
  const definition = OPTIONS_RECORD_TYPES[record.recordType]
  return archive.put(definition.kind, record.recordId, record,
    [`options-records:${record.recordType}`, `options-records:scan:${record.scanId}`], record.availableAt)
}
export async function commitOptionsScan({ archive, redis, records, scanId, availableAt, lockKey = OPTIONS_SCAN_LOCK_KEY, lockToken } = {}) {
  if (!archive || !redis || !Array.isArray(records) || !records.length) throw new Error('Options scan commit requires archive, Redis and records')
  if (!lockToken || await redis.get(lockKey) !== lockToken) throw new Error('Options scan publication lock is not owned')
  if (records.some((record) => record.scanId !== scanId)) throw new Error('Options scan records do not share the manifest scanId')
  const recordTypes = new Set()
  for (const record of records) {
    if (recordTypes.has(record.recordType)) throw new Error(`Duplicate options record batch: ${record.recordType}`)
    recordTypes.add(record.recordType)
    await archiveOptionsAuditRecord(archive, record)
  }

  const manifestBase = {
    schemaVersion: 'options-scan-manifest-v1',
    scanId,
    availableAt,
    records: records.map((record) => ({ type: record.recordType, kind: record.archiveKind, id: record.recordId,
      byteLength: record.byteLength, count: Array.isArray(record.payload.contracts) ? record.payload.contracts.length
        : Array.isArray(record.payload.candidates) ? record.payload.candidates.length : null })),
    inputHashes: [...new Set(records.flatMap((record) => record.inputHashes))],
    storage: {
      recordBatches: records.length,
      uncompressedBytes: records.reduce((sum, record) => sum + record.byteLength, 0),
      redisShape: 'one pointer per immutable batch plus one manifest and one latest pointer',
    },
    retention: records.map((record) => ({ type: record.recordType, ...record.retention })),
  }
  const manifest = { ...manifestBase, manifestId: digest(manifestBase) }
  await archive.put('options-manifest', manifest.manifestId, manifest, 'options-manifests', availableAt)

  const pointer = JSON.stringify({ schemaVersion: 'options-latest-pointer-v1', scanId, manifestId: manifest.manifestId, availableAt })
  const published = await redis.eval(PUBLISH_LUA, [lockKey, OPTIONS_LATEST_POINTER_KEY], [lockToken, pointer])
  if (Number(published) !== 1) throw new Error('Options scan publication lock was lost')
  return { manifest, pointer: JSON.parse(pointer) }
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
