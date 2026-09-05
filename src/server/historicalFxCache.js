/**
 * Redis-backed cache for historical FX rates, in the `getMany`/`setMany`
 * shape `getRatesForDates` expects.
 *
 * Follows the pattern already established in quoteCache.js and
 * portfolioSeries.js — Redis if the Upstash env vars are set, `null`
 * otherwise, so a deployment with nothing configured still works and simply
 * fetches from the Bank of Canada every time. Unlike a quote cache there is
 * no TTL: a published historical rate never changes, so it is cached
 * permanently rather than expired and re-fetched.
 */

import { Redis } from '@upstash/redis'

const CACHE_VERSION = 'v1'
const keyFor = (date) => `fx:boc:usdcad:${CACHE_VERSION}:${date}`

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

export function historicalFxCache() {
  const redis = getRedis()
  if (!redis) return null

  return {
    async getMany(dates) {
      const result = new Map()
      if (!dates.length) return result

      const values = await redis.mget(...dates.map(keyFor))
      dates.forEach((date, i) => {
        if (values[i] != null) result.set(date, values[i])
      })
      return result
    },

    async setMany(entries) {
      if (!entries.length) return
      // No TTL: see the module comment. A published rate is permanently
      // reusable, so there is nothing to expire.
      const pipeline = redis.pipeline()
      for (const [date, value] of entries) pipeline.set(keyFor(date), value)
      await pipeline.exec()
    },
  }
}
