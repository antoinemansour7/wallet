import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createObjectStore } from './objectStore.js'

export const digest = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
const PREFIX = 'research:archive:v1'

// Append-only application storage: content-addressed blobs and SET NX records,
// with no TTL. Original bytes, revisions and indexes survive all test horizons.
// Redis holds metadata/indexes only; original bytes live in private R2 objects.
// Operators can still delete data; use bucket retention/backups for recovery.
export function createArchive(redis, { objectStore } = {}) {
  if (!redis) throw new Error('Disclosure archive requires persistent storage')
  const blobs = () => (objectStore ||= createObjectStore())
  async function put(kind, id, record, index = kind, availableAt = Date.now()) {
    const key = `${PREFIX}:${kind}:${id}`
    const result = await redis.set(key, record, { nx: true })
    const stored = result ? record : await redis.get(key)
    if (!stored) throw new Error('Archive write did not persist')
    await redis.zadd(`${PREFIX}:index:${index}`, { score: new Date(stored.availableAt ?? availableAt).getTime(), member: key })
    return stored
  }
  async function list(index, asOf = Date.now(), { offset = 0, count = Infinity, since = '-inf' } = {}) {
    const values = []
    const minimum = since === '-inf' ? since : new Date(since).getTime()
    for (let cursor = offset; cursor - offset < count;) {
      const size = Math.min(500, count - (cursor - offset))
      const keys = await redis.zrange(`${PREFIX}:index:${index}`, minimum, new Date(asOf).getTime(), { byScore: true, offset: cursor, count: size })
      for (let i = 0; i < keys.length; i += 50) values.push(...await Promise.all(keys.slice(i, i + 50).map((key) => redis.get(key))))
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
  async function latest(index, asOf = Date.now()) {
    const keys = await redis.zrange(`${PREFIX}:index:${index}`, new Date(asOf).getTime(), '-inf', { byScore: true, rev: true, offset: 0, count: 1 })
    return keys.length ? redis.get(keys[0]) : null
  }
  return { put, list, latest, putDocument, readDocument, migrateDocumentBlob, get: (kind, id) => redis.get(`${PREFIX}:${kind}:${id}`) }
}
