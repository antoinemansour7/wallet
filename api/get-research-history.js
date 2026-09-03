import { Redis } from '@upstash/redis'
import { withRunLog } from '../src/server/runLog.js'

const HISTORY_INDEX_KEY = 'research:history-index'

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

async function realHandler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200')

  const redis = getRedis()
  if (!redis) {
    return res.status(200).json({ entries: [] })
  }

  try {
    const dates = await redis.lrange(HISTORY_INDEX_KEY, 0, 29)
    if (!dates || dates.length === 0) {
      return res.status(200).json({ entries: [] })
    }

    // Deduplicate dates (in case of multiple runs per day)
    const uniqueDates = [...new Set(dates)]

    const entries = []
    for (const date of uniqueDates) {
      const data = await redis.get(`research:history:${date}`)
      if (data && data.picks && data.picks.length > 0) {
        entries.push({
          date,
          generatedAt: data.generatedAt,
          signalCount: data.signalCount || 0,
          picks: data.picks.map((p) => ({
            ticker: p.ticker,
            conviction: p.conviction,
            reason: p.reason,
            setupType: p.setupType,
            price: p.price,
            report: p.report ? p.report.match(/overall buy score[^\d]*(\d+)\s*\/\s*10/i)?.[1] || null : null,
          })),
        })
      }
    }

    return res.status(200).json({ entries })
  } catch (err) {
    console.error('[get-research-history] error:', err.message)
    return res.status(200).json({ entries: [] })
  }
}

export default withRunLog('get-research-history', realHandler)
