// Backfill the lane-specific primary-disclosure index from the immutable
// evidence archive. Records are not changed or deleted.
// Run with: node --env-file=.env scripts/backfill-primary-evidence-index.js
import { Redis } from '@upstash/redis'
import { createArchive } from '../src/server/research/archive.js'

const redis = Redis.fromEnv()
const archive = createArchive(redis)
const targetIndex = 'research:archive:v1:index:evidence:primary'
const reindexExisting = process.argv.includes('--existing-primary')
const sourceIndex = reindexExisting
  ? targetIndex
  : 'research:archive:v1:index:evidence'
const batchSize = 100
const since = Date.now() - 14 * 86400000
let offset = 0
let checked = 0
let indexed = 0
// Updating a sorted-set score can reorder the same set. Snapshot its members
// first in reindex mode so offset pagination cannot skip entries that move.
const snapshot = reindexExisting
  ? await redis.zrange(sourceIndex, since, Date.now(), { byScore: true })
  : null

while (true) {
  const keys = snapshot
    ? snapshot.slice(offset, offset + batchSize)
    : await redis.zrange(sourceIndex, since, Date.now(), { byScore: true, offset, count: batchSize })
  if (!keys.length) break
  for (let cursor = 0; cursor < keys.length; cursor += 20) {
    const slice = keys.slice(cursor, cursor + 20)
    const records = await Promise.all(slice.map((key) => archive.get('evidence', key.slice('research:archive:v1:evidence:'.length))))
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      checked += 1
      if (!record || record.strategyFamily === 'attention') continue
      await redis.zadd(targetIndex, { score: Date.parse(record.publicAt), member: slice[index] })
      indexed += 1
    }
  }
  offset += keys.length
  if (keys.length < batchSize) break
  if (checked % 500 === 0) console.log(JSON.stringify({ checked, indexed }))
}

console.log(JSON.stringify({ checked, indexed, complete: true }))
