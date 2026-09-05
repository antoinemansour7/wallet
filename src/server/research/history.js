import { createArchive } from './archive.js'
import { HISTORY_LIMIT, HISTORY_RETENTION_SECONDS } from './policy.js'

// Immutable publications include every run, so rerunning on the same date
// cannot replace a losing decision in the evaluation sample. Daily projections
// are read only for histories created before the archive existed.
export async function evaluationHistory(redis, now = Date.now()) {
  const archive = createArchive(redis)
  const publications = await archive.list('publications', now, { since: now - HISTORY_RETENTION_SECONDS * 1000 })
  const entries = publications.map((p) => ({ ...p, date: p.generatedAt.slice(0, 10) }))
  const dates = [...new Set(await redis.lrange('research:history-index', 0, HISTORY_LIMIT - 1) || [])]
  for (const date of dates) {
    const daily = await redis.get(`research:history:${date}`)
    if (daily && !daily.publicationId && !publications.some((p) => p.generatedAt === daily.generatedAt)) entries.push({ ...daily, date })
  }
  return entries
}
