import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createObjectStore } from './objectStore.js'
import { EXTERNAL_RECORD_KINDS, IMMUTABLE_BATCH_KINDS } from './archiveKinds.js'

export const digest = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
const PREFIX = 'research:archive:v1'
const RECORD_STORAGE = 'r2-json-gzip-v1'
// Large immutable research artifacts belong in R2, not in Redis. Evaluation
// inputs/runs can each be several megabytes and were the main reason the free
// Upstash database reached its storage cap. Redis retains only small, indexed
// pointers; createArchive transparently reads the payload from R2.
export { EXTERNAL_RECORD_KINDS } from './archiveKinds.js'

export class ArchiveConflictError extends Error {
  constructor(kind, id) {
    super(`Immutable archive conflict for ${kind}:${id}`)
    this.name = 'ArchiveConflictError'
    this.code = 'ARCHIVE_CONFLICT'
  }
}

// Append-only application storage: content-addressed blobs and SET NX records,
// with no TTL. Original bytes, revisions and indexes survive all test horizons.
// Redis holds metadata/indexes only; original bytes live in private R2 objects.
// Operators can still delete data; use bucket retention/backups for recovery.
export function createArchive(redis, { objectStore } = {}) {
  if (!redis) throw new Error('Disclosure archive requires persistent storage')
  // Most unit tests use an in-memory Redis alone. Keep those fixtures inline
  // unless a test supplies an object store explicitly; production still fails
  // closed if R2 is not configured.
  const externalStorageAvailable = Boolean(objectStore) || process.env.NODE_ENV !== 'test'
  const blobs = () => (objectStore ||= createObjectStore())
  const isRecordPointer = (value) => value?.storage === RECORD_STORAGE && typeof value.key === 'string' && typeof value.sha256 === 'string'
  async function readStoredRecord(value) {
    if (!isRecordPointer(value)) return value
    const original = gunzipSync(await blobs().get(value.key))
    if (digest(original) !== value.sha256) throw new Error('Archived record checksum mismatch')
    return JSON.parse(original.toString('utf8'))
  }
  async function externalizeRecord(kind, record) {
    const original = Buffer.from(JSON.stringify(record))
    const sha256 = digest(original)
    const key = `research/records/v1/${kind}/${sha256}.json.gz`
    await blobs().putIfAbsent(key, gzipSync(original))
    return { storage: RECORD_STORAGE, key, sha256, byteLength: original.length }
  }
  async function put(kind, id, record, index = kind, availableAt = Date.now()) {
    const key = `${PREFIX}:${kind}:${id}`
    const redisValue = EXTERNAL_RECORD_KINDS.has(kind) && externalStorageAvailable ? await externalizeRecord(kind, record) : record
    const result = await redis.set(key, redisValue, { nx: true })
    const stored = result ? record : await readStoredRecord(await redis.get(key))
    if (!stored) throw new Error('Archive write did not persist')
    if (!result && IMMUTABLE_BATCH_KINDS.has(kind) && digest(stored) !== digest(record)) throw new ArchiveConflictError(kind, id)
    for (const entry of Array.isArray(index) ? index : [index]) {
      const indexName = typeof entry === 'string' ? entry : entry.name
      const indexTime = typeof entry === 'string' ? stored.availableAt ?? availableAt : entry.score
      await redis.zadd(`${PREFIX}:index:${indexName}`, { score: new Date(indexTime).getTime(), member: key })
    }
    return stored
  }
  async function list(index, asOf = Date.now(), { offset = 0, count = Infinity, since = '-inf' } = {}) {
    const values = []
    const minimum = since === '-inf' ? since : new Date(since).getTime()
    for (let cursor = offset; cursor - offset < count;) {
      const size = Math.min(500, count - (cursor - offset))
      const keys = await redis.zrange(`${PREFIX}:index:${index}`, minimum, new Date(asOf).getTime(), { byScore: true, offset: cursor, count: size })
      // One bounded Redis read per page instead of one REST request per record.
      // Keep object-store decoding at 50 records to bound concurrent R2 reads.
      const page = keys.length && redis.mget ? await redis.mget(...keys) : null
      for (let i = 0; i < keys.length; i += 50) {
        const stored = page ? page.slice(i, i + 50) : await Promise.all(keys.slice(i, i + 50).map((key) => redis.get(key)))
        // A single unreadable object (transient R2 fetch failure, or a
        // corrupt record) should thin the results, not fail the whole batch
        // via Promise.all.
        values.push(...await Promise.all(stored.map(async (value) => {
          try { return await readStoredRecord(value) }
          catch (error) { console.error(`[archive] skipping unreadable record: ${error.message}`); return null }
        })))
      }
      if (keys.length < size) break
      cursor += keys.length
    }
    return values.filter(Boolean)
  }
  async function putDocument({ bytes, ...metadata }) {
    const original = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const sha256 = digest(original)
    const blobKey = `${PREFIX}:blob:${sha256}`
    const existing = await redis.get(blobKey)
    if (!existing) {
      const key = `research/documents/v1/${sha256}.gz`
      await blobs().putIfAbsent(key, gzipSync(original))
      // Publish the pointer only after the immutable object is durable, and only
      // ever with NX: ingestion appends, it never rewrites. A pre-existing
      // chunked pointer is left for migrateDocumentBlob, and readDocument keeps
      // serving it from Redis until that runs.
      await redis.set(blobKey, { storage: 'r2', key, byteLength: original.length, sha256 }, { nx: true })
    }
    const id = digest([metadata.issuerId, metadata.accession || metadata.eventId, metadata.url, sha256])
    const record = { ...metadata, id, sha256, byteLength: original.length, availableAt: metadata.firstSeenAt }
    const stored = await put('document', id, record, `documents:${metadata.issuerId}`, metadata.firstSeenAt)
    await redis.zadd(`${PREFIX}:index:documents`, { score: Date.parse(stored.firstSeenAt), member: `${PREFIX}:document:${id}` })
    return stored
  }
  async function readDocument(id) {
    const record = await redis.get(`${PREFIX}:document:${id}`)
    if (!record) return null
    const blob = await redis.get(`${PREFIX}:blob:${record.sha256}`)
    if (!blob) throw new Error('Missing archived document blob')
    let compressed
    if (blob.storage === 'r2') compressed = await blobs().get(blob.key)
    else {
      // Read compatibility for archives written before the R2 migration.
      const parts = await Promise.all(Array.from({ length: blob.chunks }, (_, i) => redis.get(`${PREFIX}:blob:${record.sha256}:${i}`)))
      if (parts.some((part) => typeof part !== 'string')) throw new Error('Incomplete archived document blob')
      compressed = Buffer.from(parts.join(''), 'base64')
    }
    const bytes = gunzipSync(compressed)
    if (digest(bytes) !== record.sha256) throw new Error('Archived document checksum mismatch')
    return { ...record, bytes }
  }
  async function migrateDocumentBlob(id, { deleteRedisChunks = false } = {}) {
    const document = await readDocument(id)
    if (!document) throw new Error('Missing archived document')
    const blobKey = `${PREFIX}:blob:${document.sha256}`
    const previous = await redis.get(blobKey)
    const chunks = previous.chunks || previous.legacyChunks || 0
    const key = `research/documents/v1/${document.sha256}.gz`
    if (previous.storage !== 'r2') await blobs().putIfAbsent(key, gzipSync(document.bytes))
    const verified = gunzipSync(await blobs().get(key))
    if (digest(verified) !== document.sha256) throw new Error('Migrated document checksum mismatch')
    const pointer = { storage: 'r2', key, byteLength: document.byteLength, sha256: document.sha256 }
    await redis.set(blobKey, { ...pointer, ...(chunks ? { legacyChunks: chunks } : {}) })
    if (deleteRedisChunks && chunks) {
      for (let i = 0; i < chunks; i++) await redis.del(`${blobKey}:${i}`)
      await redis.set(blobKey, pointer)
    }
    return { id, sha256: document.sha256, migrated: previous.storage !== 'r2', deletedChunks: deleteRedisChunks ? chunks : 0 }
  }
  async function migrateRecord(kind, id) {
    if (!EXTERNAL_RECORD_KINDS.has(kind)) throw new Error(`Record kind ${kind} is not configured for external storage`)
    const redisKey = `${PREFIX}:${kind}:${id}`
    const previous = await redis.get(redisKey)
    if (!previous) throw new Error('Missing archived record')
    if (isRecordPointer(previous)) return { kind, id, migrated: false, byteLength: previous.byteLength }
    const pointer = await externalizeRecord(kind, previous)
    // A complete R2 readback and digest check must succeed before Redis is
    // replaced. Retrying after any failure is safe because objects are immutable.
    const verified = await readStoredRecord(pointer)
    if (digest(Buffer.from(JSON.stringify(verified))) !== pointer.sha256) throw new Error('Migrated record checksum mismatch')
    await redis.set(redisKey, pointer)
    return { kind, id, migrated: true, byteLength: pointer.byteLength }
  }
  async function latest(index, asOf = Date.now()) {
    const keys = await redis.zrange(`${PREFIX}:index:${index}`, new Date(asOf).getTime(), '-inf', { byScore: true, rev: true, offset: 0, count: 1 })
    return keys.length ? readStoredRecord(await redis.get(keys[0])) : null
  }
  return { put, list, latest, putDocument, readDocument, migrateDocumentBlob, migrateRecord,
    get: async (kind, id) => readStoredRecord(await redis.get(`${PREFIX}:${kind}:${id}`)) }
}
