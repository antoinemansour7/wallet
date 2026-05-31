import { Redis } from '@upstash/redis'

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const redis = getRedis()
  if (!redis) {
    return res.status(503).json({ error: 'Redis not configured' })
  }

  try {
    const historyIndex = await redis.lrange('research:history-index', 0, 29)
    if (!historyIndex || historyIndex.length === 0) {
      return res.status(200).json({ entries: [], stats: null })
    }

    const entries = await Promise.all(
      historyIndex.map(async (dateKey) => {
        const data = await redis.get(`research:history:${dateKey}`)
        if (!data) return null
        return {
          date: dateKey,
          generatedAt: data.generatedAt,
          picks: (data.picks || []).map((p) => ({
            ticker: p.ticker,
            conviction: p.conviction,
            setupType: p.setupType,
            price: p.price,
            catalystVerified: p.catalystVerified || false,
            riskScore: p.riskScore || null,
          })),
          signalCount: data.signalCount,
        }
      })
    )

    const validEntries = entries.filter(Boolean)

    // Compute aggregate stats
    const allPicks = validEntries.flatMap((e) => e.picks)
    const tickerFrequency = {}
    const setupCounts = {}
    for (const pick of allPicks) {
      tickerFrequency[pick.ticker] = (tickerFrequency[pick.ticker] || 0) + 1
      setupCounts[pick.setupType] = (setupCounts[pick.setupType] || 0) + 1
    }

    const stats = {
      totalDays: validEntries.length,
      totalPicks: allPicks.length,
      avgConviction: allPicks.length > 0
        ? Number((allPicks.reduce((s, p) => s + p.conviction, 0) / allPicks.length).toFixed(1))
        : 0,
      topRepeaters: Object.entries(tickerFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([ticker, count]) => ({ ticker, count })),
      setupBreakdown: setupCounts,
    }

    return res.status(200).json({ entries: validEntries, stats })
  } catch (err) {
    console.error('[signal-history] failed:', err.message)
    return res.status(500).json({ error: 'Failed to load signal history' })
  }
}
