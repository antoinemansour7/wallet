/**
 * Daily coverage snapshots, so the engine can ask how much a ticker's
 * attention changed rather than only how much of it exists today.
 *
 * Same Redis-or-nothing pattern as quoteCache.js and securitiesReferenceCache.js:
 * with no Upstash env configured every read returns an empty history, which
 * leaves every ticker "new" and unadjusted. Degrading to "no opinion" is the
 * correct failure here — see the feed-health note below.
 *
 * ## Why this counts documents, not mentions
 *
 * Each run looks *backwards* over a window, and the window is longer than the
 * gap between runs: X posts within 30h (`SIGNAL_MAX_AGE_MS`), everything
 * non-context capped at 48h (`ARTICLE_MAX_AGE_MS`), Exa articles published
 * within two days, Yahoo RSS at 48h — while `nightly-research` runs every 24h.
 *
 * So consecutive runs overlap by 6 to 24 hours and see many of the same posts
 * twice. Counting raw mentions per run would compare two overlapping trailing
 * windows and call the difference a daily change: a genuine 0-to-9 jump would
 * read smaller than it is, and coverage that stopped yesterday would keep
 * counting today, so a fade would surface a day late.
 *
 * Each document is therefore counted on the date it is *first seen*. A post
 * already counted yesterday adds nothing today, which makes each day's number
 * new coverage rather than a trailing total, and makes two consecutive days
 * genuinely comparable.
 *
 * The counts are taken from the raw board before ranking, quote verification or
 * any gate. This is coverage, not quality: the question is how loudly the feeds
 * were talking about each name, not how good the idea was.
 */

import { Redis } from '@upstash/redis'

const KEY_PREFIX = 'research:coverage'
// Must outlive the comparison window with room to spare. The window itself is
// short (a few days, matching the pipeline's 3-5 session horizon); the TTL is
// long enough that a few missed runs do not empty the history.
const TTL_SECONDS = 14 * 24 * 60 * 60
const DEFAULT_WINDOW_DAYS = 3
// The document ledger only has to cover the longest input window (96h for the
// widest context account) plus the weekend gap, since anything older cannot
// appear in today's fetch anyway. Bounded so one busy day cannot grow the key
// without limit.
const SEEN_WINDOW_DAYS = 5
const MAX_DOCUMENTS_PER_DAY = 4000

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

async function readSnapshots(redis, dateKeys) {
  const values = await Promise.all(dateKeys.map((dateKey) => redis.get(keyFor(dateKey))))
  return values.filter((snapshot) => snapshot && typeof snapshot === 'object')
}

/**
 * Today's coverage, counting each document only on the day it first appears.
 *
 * `seenDocuments` is the set of document keys already counted on an earlier
 * date. A board item with no document keys at all falls back to its raw counts
 * rather than reporting zero coverage — silently under-reporting would look
 * exactly like a fade.
 *
 * Exported separately from the write so it can be tested without Redis, and so
 * a caller can see exactly what is about to be stored.
 */
export function coverageSnapshotFrom(board = [], { seenDocuments = new Set() } = {}) {
  const counts = {}
  const documents = new Set()

  for (const item of board) {
    const ticker = String(item?.ticker || '').trim().toUpperCase()
    if (!ticker) continue

    const keys = Array.isArray(item.documentKeys) ? item.documentKeys.filter(Boolean) : []
    let fresh
    if (keys.length > 0) {
      fresh = 0
      for (const key of keys) {
        documents.add(key)
        if (!seenDocuments.has(key)) fresh += 1
      }
    } else {
      const signals = Number.isFinite(item.signalCount) ? Math.max(0, item.signalCount) : 0
      const articles = Number.isFinite(item.articleCount) ? Math.max(0, item.articleCount) : 0
      fresh = signals + articles
    }

    // A ticker can legitimately appear twice if a caller concatenated boards.
    counts[ticker] = (counts[ticker] || 0) + fresh
  }

  return { counts, documents: [...documents].slice(0, MAX_DOCUMENTS_PER_DAY) }
}

/**
 * Document keys already counted on an earlier date, so today counts only what
 * is new. Returns an empty set when nothing is stored, which makes every
 * document look fresh — correct on a first run, where there is no history to
 * compare against and acceleration reports "new" and scores nothing either way.
 */
export async function loadSeenDocuments({ days = SEEN_WINDOW_DAYS, from = new Date() } = {}) {
  const redis = getRedis()
  if (!redis) return new Set()
  try {
    const snapshots = await readSnapshots(redis, previousDateKeys(days, from))
    return new Set(snapshots.flatMap((snapshot) => (Array.isArray(snapshot.documents) ? snapshot.documents : [])))
  } catch (err) {
    console.error('[researchCoverageStore] seen-document read failed:', err.message)
    return new Set()
  }
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
export async function recordCoverageSnapshot(board, { healthy = true, date = new Date(), seenDocuments = new Set() } = {}) {
  if (!healthy) {
    console.warn('[researchCoverageStore] discovery degraded this run — not recording coverage, since missing is not zero')
    return null
  }
  const redis = getRedis()
  if (!redis) return null

  const snapshot = coverageSnapshotFrom(board, { seenDocuments })
  if (Object.keys(snapshot.counts).length === 0) return null

  const dateKey = dateKeyFor(date)
  try {
    await redis.set(keyFor(dateKey), snapshot, { ex: TTL_SECONDS })
    console.log(
      `[researchCoverageStore] recorded ${dateKey}: ${Object.keys(snapshot.counts).length} tickers`
      + `, ${snapshot.documents.length} documents`,
    )
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
 * not measure, and the cron does not run at weekends. A ticker missing from a
 * day that *was* measured does count as zero — the feeds ran and did not
 * mention it, which is a real observation.
 */
export async function loadCoverageHistory({ days = DEFAULT_WINDOW_DAYS, from = new Date() } = {}) {
  const redis = getRedis()
  if (!redis) return new Map()

  let measured = []
  try {
    measured = await readSnapshots(redis, previousDateKeys(days, from))
  } catch (err) {
    console.error('[researchCoverageStore] history read failed:', err.message)
    return new Map()
  }
  if (measured.length === 0) return new Map()

  const countsPerDay = measured.map((snapshot) => snapshot.counts || {})
  const tickers = new Set(countsPerDay.flatMap((counts) => Object.keys(counts)))
  const history = new Map()
  for (const ticker of tickers) {
    history.set(ticker, countsPerDay.map((counts) => {
      const value = Number(counts[ticker])
      return Number.isFinite(value) && value >= 0 ? value : 0
    }))
  }
  return history
}
