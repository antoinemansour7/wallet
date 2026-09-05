import { HISTORY_LIMIT } from '../src/server/research/policy.js'
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
    const dates = await redis.lrange(HISTORY_INDEX_KEY, 0, HISTORY_LIMIT - 1)
    if (!dates || dates.length === 0) {
      return res.status(200).json({ entries: [] })
    }

    // Deduplicate dates (in case of multiple runs per day)
    const uniqueDates = [...new Set(dates)]

    const entries = []
    for (const date of uniqueDates) {
      const data = await redis.get(`research:history:${date}`)
      if (data && (data.picks?.length || Object.values(data.picksByHorizon || {}).some((picks) => picks.length))) {
        entries.push({
          date,
          generatedAt: data.generatedAt,
          signalCount: data.signalCount || 0,
          picksByHorizon: Object.fromEntries(Object.entries(data.picksByHorizon || { 5: data.picks || [] }).map(([horizon, picks]) => [horizon, picks.map((p) => ({ ticker: p.ticker, candidateId: p.candidateId, securityId: p.securityId, horizon: p.horizon || 5, strategyFamily: p.strategyFamily || 'attention', conviction: p.conviction, reason: p.reason, price: p.price }))])) ,
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
