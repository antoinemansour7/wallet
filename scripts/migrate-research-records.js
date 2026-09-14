// Move large immutable fact/evidence JSON records from Redis to private R2.
// R2 is read back and checksum-verified before each Redis value is replaced.
// Run with: node --env-file=.env scripts/migrate-research-records.js
import { Redis } from '@upstash/redis'
import { createArchive } from '../src/server/research/archive.js'

const options = new Map(process.argv.slice(2).map((argument) => argument.split('=')))
if (options.has('--help')) {
  console.log('node --env-file=.env scripts/migrate-research-records.js [--limit=10000] [--concurrency=20]')
  process.exit(0)
}

const limit = Number(options.get('--limit') ?? 10000)
const concurrency = Number(options.get('--concurrency') ?? 20)
if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Use a limit between 1 and 10000')
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) throw new Error('Use concurrency between 1 and 50')

const redis = Redis.fromEnv()
const archive = createArchive(redis)
const records = []
for (const kind of ['facts', 'evidence']) {
  let cursor = '0'
  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: `research:archive:v1:${kind}:*`, count: 500 })
    cursor = String(nextCursor)
    for (const key of keys) records.push({ kind, id: key.slice(`research:archive:v1:${kind}:`.length) })
  } while (cursor !== '0' && records.length < limit)
  if (records.length >= limit) break
}

let checked = 0
let migrated = 0
let bytesExternalized = 0
for (let offset = 0; offset < records.length; offset += concurrency) {
  const results = await Promise.all(records.slice(offset, offset + concurrency).map(({ kind, id }) => archive.migrateRecord(kind, id)))
  for (const result of results) {
    checked += 1
    migrated += Number(result.migrated)
    if (result.migrated) bytesExternalized += result.byteLength
  }
  if (checked % 500 < concurrency) console.log(JSON.stringify({ progress: checked, total: records.length, migrated, bytesExternalized }))
}

console.log(JSON.stringify({ checked, migrated, bytesExternalized, complete: records.length < limit }))
