import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'

export const digest = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
const PREFIX = 'research:archive:v1'
const CHUNK_SIZE = 128000

// Append-only application storage: content-addressed blobs and SET NX records,
// with no TTL. Original bytes, revisions and indexes survive all test horizons.
// Redis operators can still delete data; use backups for disaster recovery.
export function createArchive(redis) {
  if (!redis) throw new Error('Disclosure archive requires persistent storage')
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
    const compressed = gzipSync(original).toString('base64')
    const chunks = Math.ceil(compressed.length / CHUNK_SIZE)
    for (let i = 0; i < chunks; i++) await redis.set(`${blobKey}:${i}`, compressed.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), { nx: true })
    await redis.set(blobKey, { chunks, byteLength: original.length, sha256 }, { nx: true })
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
    const parts = await Promise.all(Array.from({ length: blob.chunks }, (_, i) => redis.get(`${PREFIX}:blob:${record.sha256}:${i}`)))
    if (parts.some((part) => typeof part !== 'string')) throw new Error('Incomplete archived document blob')
    const bytes = gunzipSync(Buffer.from(parts.join(''), 'base64'))
    if (digest(bytes) !== record.sha256) throw new Error('Archived document checksum mismatch')
    return { ...record, bytes }
  }
  return { put, list, putDocument, readDocument, get: (kind, id) => redis.get(`${PREFIX}:${kind}:${id}`) }
}
