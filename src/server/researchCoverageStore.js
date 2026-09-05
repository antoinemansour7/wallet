/**
 * Daily coverage snapshots, so the engine can ask how much a ticker's
 * attention changed rather than only how much of it exists today.
 *
 * Same Redis-or-nothing pattern as quoteCache.js and securitiesReferenceCache.js:
 * with no Upstash env configured every read returns an empty history, which
 * leaves every ticker "new" and unadjusted. Degrading to "no opinion" is the
 * correct failure here — see the feed-health note below.
 *
 * What is stored is the pre-scoring mention count (signals + articles) for each
 * ticker on a research date. That is coverage, not quality: it is taken from
 * the raw board before ranking, quote verification or any gate, because the
 * question is how loudly the feeds were talking, not how good the idea was.
 */

import { Redis } from '@upstash/redis'

const KEY_PREFIX = 'research:coverage'
// Must outlive the comparison window with room to spare. The window itself is
// short (a few days, matching the pipeline's 3-5 session horizon); the TTL is
// long enough that a few missed runs do not empty the history.
const TTL_SECONDS = 14 * 24 * 60 * 60
const DEFAULT_WINDOW_DAYS = 3

const keyFor = (dateKey) => `${KEY_PREFIX}:${dateKey}`

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

export function dateKeyFor(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function previousDateKeys(days, from = new Date()) {
  const keys = []
  for (let i = 1; i <= days; i += 1) {
    const d = new Date(from)
    d.setUTCDate(d.getUTCDate() - i)
    keys.push(dateKeyFor(d))
  }
  return keys
}

/**
 * Turn a ranked or raw board into the counts worth persisting.
 *
 * Exported separately from the write so it can be tested without Redis, and so
 * a caller can see exactly what is about to be stored.
 */
export function coverageSnapshotFrom(board = []) {
  const counts = {}
  for (const item of board) {
    const ticker = String(item?.ticker || '').trim().toUpperCase()
    if (!ticker) continue
    const signals = Number.isFinite(item.signalCount) ? Math.max(0, item.signalCount) : 0
    const articles = Number.isFinite(item.articleCount) ? Math.max(0, item.articleCount) : 0
    // A ticker can legitimately appear twice if a caller concatenated boards.
    counts[ticker] = (counts[ticker] || 0) + signals + articles
  }
  return counts
}

/**
 * Record today's coverage.
 *
 * `healthy` says whether the discovery feeds actually ran. A run where Exa or X
 * failed produces low counts for every ticker, and storing that as though it
 * were real would make the next run read a market-wide collapse in attention
 * that never happened. An unhealthy run is not written at all: the correct
 * value for coverage we could not measure is unknown, not zero.
 */
export async function recordCoverageSnapshot(board, { healthy = true, date = new Date() } = {}) {
  if (!healthy) {
    console.warn('[researchCoverageStore] discovery degraded this run — not recording coverage, since missing is not zero')
    return null
  }
  const redis = getRedis()
  if (!redis) return null

  const counts = coverageSnapshotFrom(board)
  if (Object.keys(counts).length === 0) return null

  const dateKey = dateKeyFor(date)
  try {
    await redis.set(keyFor(dateKey), counts, { ex: TTL_SECONDS })
    console.log(`[researchCoverageStore] recorded coverage for ${Object.keys(counts).length} tickers on ${dateKey}`)
    return dateKey
  } catch (err) {
    console.error('[researchCoverageStore] snapshot write failed:', err.message)
    return null
  }
}

/**
 * Prior daily counts per ticker, most recent first, excluding today.
 *
 * Days with no stored snapshot are skipped rather than counted as zero, for the
 * same reason a degraded run is never written: an absent day is a day we did
 * not measure. A ticker missing from a day that *was* measured does count as
 * zero — the feeds ran and did not mention it, which is a real observation.
 */
export async function loadCoverageHistory({ days = DEFAULT_WINDOW_DAYS, from = new Date() } = {}) {
  const redis = getRedis()
  if (!redis) return new Map()

  const dateKeys = previousDateKeys(days, from)
  let snapshots = []
  try {
    snapshots = await Promise.all(dateKeys.map((dateKey) => redis.get(keyFor(dateKey))))
  } catch (err) {
    console.error('[researchCoverageStore] history read failed:', err.message)
    return new Map()
  }

  const measured = snapshots.filter((snapshot) => snapshot && typeof snapshot === 'object')
  if (measured.length === 0) return new Map()

  const tickers = new Set(measured.flatMap((snapshot) => Object.keys(snapshot)))
  const history = new Map()
  for (const ticker of tickers) {
    history.set(ticker, measured.map((snapshot) => {
      const value = Number(snapshot[ticker])
      return Number.isFinite(value) && value >= 0 ? value : 0
    }))
  }
  return history
}
