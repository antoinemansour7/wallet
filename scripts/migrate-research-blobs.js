// Run with Node's --env-file flag; never print storage credentials or documents.
import { Redis } from '@upstash/redis'
import { createArchive } from '../src/server/research/archive.js'

const options = new Map(process.argv.slice(2).map((arg) => arg.split('=')))
if (options.has('--help')) {
  console.log('node --env-file=.env.local scripts/migrate-research-blobs.js [--offset=0] [--limit=100] [--delete-redis-chunks]')
} else {
  const offset = Number(options.get('--offset') ?? 0)
  const limit = Number(options.get('--limit') ?? 100)
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Use offset >= 0 and limit between 1 and 1000')
  const archive = createArchive(Redis.fromEnv())
  const documents = await archive.list('documents', Date.now(), { offset, count: limit })
  let migrated = 0, deletedChunks = 0
  for (const document of documents) {
    // The archive verifies a complete R2 readback before switching pointers or
    // deleting anything. Retry a failed batch with the same offset; it is safe.
    const result = await archive.migrateDocumentBlob(document.id, { deleteRedisChunks: options.has('--delete-redis-chunks') })
    migrated += Number(result.migrated)
    deletedChunks += result.deletedChunks
  }
  console.log(JSON.stringify({ checked: documents.length, migrated, deletedChunks, nextOffset: offset + documents.length, complete: documents.length < limit }))
}
