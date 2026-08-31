import { Redis } from '@upstash/redis'
import { storePickPerformance, invalidateStatsCache } from '../src/server/agents/signalHistoryTools.js'

/**
 * Map days-held to a tracking checkpoint. Tolerant windows instead of exact
 * matches so one missed cron run doesn't permanently lose a checkpoint —
 * storePickPerformance is idempotent per slot, so the earliest day in the
 * window wins.
 */
export function checkpointSlot(daysHeld) {
  if (daysHeld >= 1 && daysHeld <= 2) return 1
  if (daysHeld >= 3 && daysHeld <= 4) return 3
  if (daysHeld >= 5 && daysHeld <= 7) return 5
  if (daysHeld >= 10 && daysHeld <= 12) return 10
  return null
}

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return false
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
}

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

async function fetchCurrentPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    return meta?.regularMarketPrice || null
  } catch {
    return null
  }
}

/**
 * Pure: find the open/high of the first trading day AFTER pickDate in a set
 * of daily candles ({date, open, high}). Powers the honest day-1 metrics —
 * what a buyer at the next open could actually have captured.
 */
export function firstSessionAfter(candles, pickDate) {
  for (const candle of candles || []) {
    if (candle.date > pickDate && Number.isFinite(candle.open)) {
      return { day1Open: candle.open, day1High: Number.isFinite(candle.high) ? candle.high : null }
    }
  }
  return null
}

async function fetchRecentDailyCandles(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1mo`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const data = await res.json()
    const result = data?.chart?.result?.[0]
    const quote = result?.indicators?.quote?.[0]
    return (result?.timestamp || []).map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: quote?.open?.[i],
      high: quote?.high?.[i],
    }))
  } catch {
    return []
  }
}

function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1)
  const d2 = new Date(dateStr2)
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24))
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const redis = getRedis()
  if (!redis) {
    return res.status(503).json({ error: 'Redis not configured' })
  }

  const startedAt = Date.now()
  const today = new Date().toISOString().slice(0, 10)
  const errors = []
  let tracked = 0

  // Get history index — check picks far enough back to cover the day-10
  // checkpoint's tolerance window (up to 12 days)
  const historyIndex = await redis.lrange('research:history-index', 0, 12)

  async function trackPicks(dateKey, picks, daysHeld, { shadow = false } = {}) {
    for (const pick of picks) {
      if (!pick.ticker || !pick.price) continue

      try {
        const currentPrice = await fetchCurrentPrice(pick.ticker)
        if (currentPrice == null) continue

        // Day-1 checkpoint also records the next session's open/high so the
        // feedback loop scores achievable (open→close) returns, not phantom
        // close-to-close ones.
        let extras = { shadow }
        if (daysHeld === 1) {
          const session = firstSessionAfter(await fetchRecentDailyCandles(pick.ticker), dateKey)
          if (session) extras = { ...extras, ...session }
        }

        await storePickPerformance(dateKey, pick.ticker, pick.price, currentPrice, daysHeld, extras)
        tracked++
      } catch (err) {
        errors.push({ ticker: pick.ticker, date: dateKey, error: err.message })
      }
    }
  }

  for (const dateKey of historyIndex) {
    const daysHeld = checkpointSlot(daysBetween(dateKey, today))
    if (daysHeld === null) continue

    const history = await redis.get(`research:history:${dateKey}`)
    if (history?.picks) await trackPicks(dateKey, history.picks, daysHeld)

    // Shadow board candidates — never shown to the user, tracked purely to
    // feed the setup/source win-rate learning loop
    const shadowEntry = await redis.get(`research:shadow:${dateKey}`)
    if (shadowEntry?.picks) await trackPicks(dateKey, shadowEntry.picks, daysHeld, { shadow: true })
  }

  console.log(`[track-performance] tracked ${tracked} pick-price updates`)

  try {
    const { recordRun } = await import('../src/server/runLog.js')
    await recordRun('track-performance', startedAt, { errors, tracked, checkedDates: historyIndex.length })
  } catch (err) {
    console.error('[track-performance] run log failed:', err.message)
  }

  // Fresh outcomes recorded — make the next research run recompute stats
  // instead of serving the 6h-cached version
  if (tracked > 0) {
    try { await invalidateStatsCache() } catch { /* non-critical */ }
  }

  return res.status(200).json({
    tracked,
    checkedDates: historyIndex.length,
    errors,
  })
}
