import { Redis } from '@upstash/redis'
import { storePickPerformance } from '../src/server/agents/signalHistoryTools.js'

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

  const today = new Date().toISOString().slice(0, 10)
  const errors = []
  let tracked = 0

  // Get history index — check picks from last 10 days
  const historyIndex = await redis.lrange('research:history-index', 0, 9)

  for (const dateKey of historyIndex) {
    const daysHeld = daysBetween(dateKey, today)

    // Only track at day 1, 3, 5, and 10
    if (![1, 3, 5, 10].includes(daysHeld)) continue

    const history = await redis.get(`research:history:${dateKey}`)
    if (!history?.picks) continue

    for (const pick of history.picks) {
      if (!pick.ticker || !pick.price) continue

      try {
        const currentPrice = await fetchCurrentPrice(pick.ticker)
        if (currentPrice == null) continue

        await storePickPerformance(dateKey, pick.ticker, pick.price, currentPrice, daysHeld)
        tracked++
        console.log(`[track-performance] ${pick.ticker} from ${dateKey}: entry=$${pick.price} → now=$${currentPrice} (day ${daysHeld})`)
      } catch (err) {
        errors.push({ ticker: pick.ticker, date: dateKey, error: err.message })
      }
    }
  }

  console.log(`[track-performance] tracked ${tracked} pick-price updates`)

  return res.status(200).json({
    tracked,
    checkedDates: historyIndex.length,
    errors,
  })
}
