import { Redis } from '@upstash/redis'
import { withRunLog } from '../src/server/runLog.js'

const RESEARCH_KEY = 'research:latest'
const EMPTY_RESPONSE = { empty: true, picks: [], articles: [], signalCount: 0, tweetCount: 0, queryCount: 0, generatedAt: null, errors: [] }

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
    const data = await redis.get(RESEARCH_KEY)
    // Market conditions moved to their own route (#68) — this no longer
    // carries `regime`.
    if (!data) {
      return res.status(200).json(EMPTY_RESPONSE)
    }
    return res.status(200).json(data)
  } catch (err) {
    console.error('[get-research] Redis error:', err.message)
    return res.status(200).json(EMPTY_RESPONSE)
  }
}

export default withRunLog('get-research', realHandler)
