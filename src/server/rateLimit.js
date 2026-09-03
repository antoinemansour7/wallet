// ─── Rate limiting for endpoints that spend real money ─────────────────────────
// /api/live-prices, /api/position-sizing, and /api/extract-pdf each call a
// metered third-party API (Polygon/Yahoo, Claude, Groq) on every request, with
// no cap on how often one caller can hit them. None of the three verify who is
// calling (that's #53, and it only covers /api/plaid so far), so the only key
// available is the caller's IP — worth having even though it's easy to rotate.
//
// Fails open when Upstash isn't configured, so local dev without those env
// vars still works; the same fallback runLog.js uses for the same reason.

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const limiters = new Map()

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

function getLimiter(name, requests, window) {
  if (limiters.has(name)) return limiters.get(name)

  const redis = getRedis()
  const limiter = redis
    ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(requests, window),
      prefix: `ratelimit:${name}`,
    })
    : null

  limiters.set(name, limiter)
  return limiter
}

/** Best-effort caller identity: the first hop in x-forwarded-for, or the socket. */
function callerKey(req) {
  const forwarded = req.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

/**
 * Enforce a per-caller rate limit. If the caller is over it, writes a 429 and
 * returns true — the route should return immediately in that case. Returns
 * false (never limited) when Upstash isn't configured.
 *
 * @param {string} name a stable name for this endpoint's limiter (its own bucket)
 * @param {{ requests: number, window: string }} budget e.g. { requests: 10, window: '1 m' }
 */
export async function isRateLimited(req, res, name, { requests, window }) {
  const limiter = getLimiter(name, requests, window)
  if (!limiter) return false

  try {
    const { success } = await limiter.limit(callerKey(req))
    if (!success) {
      res.status(429).json({ error: 'Too many requests. Try again shortly.' })
      return true
    }
    return false
  } catch (err) {
    // Redis being briefly unavailable shouldn't take the endpoint down with it.
    console.error(`[rateLimit] ${name} check failed, allowing request:`, err.message)
    return false
  }
}
