/**
 * Redis-backed cache for securities reference data.
 *
 * Same pattern as quoteCache.js, portfolioSeries.js, and historicalFxCache.js
 * — Redis if the Upstash env vars are set, `null` otherwise, so a deployment
 * with nothing configured just fetches fresh every time.
 *
 * A much longer TTL than a price quote, and different by field: a trailing
 * yield is meaningful to a day's precision, while exchange, fund composition,
 * and a FIGI change on the order of months or never. One conservative TTL
 * covers all of them here — long enough that this module's two fragile
 * dependencies (Yahoo's crumb handshake, OpenFIGI's public endpoint) are
 * hit rarely, short enough that a yield eventually catches up to reality.
 */

import { Redis } from '@upstash/redis'

const CACHE_VERSION = 'v1'
const TTL_SECONDS = Number(process.env.SECURITIES_REFERENCE_TTL_SECONDS ?? 24 * 60 * 60)

const keyFor = (kind, symbol) => `secref:${CACHE_VERSION}:${kind}:${symbol.toUpperCase()}`

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

export function securitiesReferenceCache() {
  const redis = getRedis()
  if (!redis) return null

  return {
    async get(kind, symbol) {
      return redis.get(keyFor(kind, symbol))
    },
    async set(kind, symbol, value) {
      await redis.set(keyFor(kind, symbol), value, { ex: TTL_SECONDS })
    },
  }
}
