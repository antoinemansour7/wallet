import { Redis } from '@upstash/redis'
import { getMarketRegime } from '../src/server/marketRegime.js'

const RESEARCH_KEY = 'research:latest'
const EMPTY_RESPONSE = { empty: true, picks: [], articles: [], signalCount: 0, tweetCount: 0, queryCount: 0, generatedAt: null, errors: [] }

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

// Computed live rather than read out of the overnight payload. The tape this
// describes moves during the session, so a score frozen at 03:00 UTC would be
// stale by the open — and tying it to the nightly meant it showed nothing at all
// until the next cron fired. getMarketRegime caches for an hour, so this is a
// Redis read on nearly every request. Never fatal: the picks matter more than
// the gauge above them.
//
// Each pick still carries the regimeScore it was made under, so the historical
// record for calibration is unaffected by showing the current one here.
async function safeRegime() {
  try {
    return await getMarketRegime()
  } catch (err) {
    console.error('[get-research] regime failed:', err.message)
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Run-log history: GET /api/get-research?logs=1 (cron monitoring)
  if (req.query?.logs) {
    try {
      const { getRecentRuns } = await import('../src/server/runLog.js')
      return res.status(200).json({ runs: await getRecentRuns(30) })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')

  const redis = getRedis()
  if (!redis) {
    return res.status(200).json(EMPTY_RESPONSE)
  }

  try {
    const [data, regime] = await Promise.all([redis.get(RESEARCH_KEY), safeRegime()])
    // Market conditions are worth showing even on a day with no picks.
    if (!data) {
      return res.status(200).json({ ...EMPTY_RESPONSE, regime })
    }
    return res.status(200).json({ ...data, regime })
  } catch (err) {
    console.error('[get-research] Redis error:', err.message)
    return res.status(200).json(EMPTY_RESPONSE)
  }
}
