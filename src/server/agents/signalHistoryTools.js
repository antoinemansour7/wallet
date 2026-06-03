// ─── Signal History Tools ──────────────────────────────────────────────────────
// Functions that let any agent query past picks, track performance,
// and compute win rates. Powers the post-mortem feedback loop.
// ────────────────────────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis'

const PERFORMANCE_KEY = 'research:performance'
const PERFORMANCE_TTL = 30 * 24 * 60 * 60 // 30 days
const STATS_CACHE_KEY = 'research:performance:stats'
const STATS_CACHE_TTL = 6 * 60 * 60 // 6 hours

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

/**
 * Get past picks from history index.
 * Returns the last N days of picks.
 */
export async function getPastPicks(days = 7) {
  const redis = getRedis()
  if (!redis) return []

  const historyIndex = await redis.lrange('research:history-index', 0, days - 1)
  if (!historyIndex || historyIndex.length === 0) return []

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
          reason: p.reason,
          riskScore: p.riskScore,
          catalystVerified: p.catalystVerified,
          bearCase: p.bearCase,
          technicals: p.technicals,
        })),
      }
    })
  )

  return entries.filter(Boolean)
}

/**
 * Store performance data for a pick after checking its current price.
 * Called by the daily performance tracker cron.
 */
export async function storePickPerformance(pickDate, ticker, entryPrice, currentPrice, daysHeld) {
  const redis = getRedis()
  if (!redis) return

  const returnPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0
  const win = returnPct >= 3 // +3% threshold for a "win"

  const key = `${PERFORMANCE_KEY}:${pickDate}:${ticker}`
  const existing = await redis.get(key) || {}

  const updated = {
    ...existing,
    ticker,
    pickDate,
    entryPrice,
    [`price_day${daysHeld}`]: currentPrice,
    [`return_day${daysHeld}`]: Number(returnPct.toFixed(2)),
    [`win_day${daysHeld}`]: win,
    lastChecked: new Date().toISOString(),
  }

  await redis.set(key, updated, { ex: PERFORMANCE_TTL })
  return updated
}

/**
 * Get performance records for all tracked picks.
 */
export async function getAllPerformanceRecords() {
  const redis = getRedis()
  if (!redis) return []

  // Get all history dates
  const historyIndex = await redis.lrange('research:history-index', 0, 29)
  if (!historyIndex || historyIndex.length === 0) return []

  const records = []
  for (const dateKey of historyIndex) {
    const history = await redis.get(`research:history:${dateKey}`)
    if (!history?.picks) continue

    for (const pick of history.picks) {
      const perfKey = `${PERFORMANCE_KEY}:${dateKey}:${pick.ticker}`
      const perf = await redis.get(perfKey)
      if (perf) {
        records.push({
          ...perf,
          setupType: pick.setupType,
          conviction: pick.conviction,
          catalystVerified: pick.catalystVerified || false,
          riskScore: pick.riskScore || null,
        })
      }
    }
  }

  return records
}

/**
 * Compute win rate statistics broken down by setup type, conviction level,
 * catalyst verification, and other dimensions.
 * Results are cached in Redis for 6h to avoid recomputing on every run.
 */
export async function getWinRateStats() {
  const redis = getRedis()

  // Check cache first
  if (redis) {
    try {
      const cached = await redis.get(STATS_CACHE_KEY)
      if (cached) {
        const stats = typeof cached === 'string' ? JSON.parse(cached) : cached
        if (stats.totalPicks > 0) return stats
      }
    } catch { /* cache miss */ }
  }

  const records = await getAllPerformanceRecords()
  if (records.length === 0) return { totalPicks: 0, stats: null, message: 'No performance data yet' }

  const now = Date.now()
  // Aggregate by dimensions
  const bySetup = {}
  const byConviction = { high: { wins: 0, total: 0, weightedWins: 0, weightedTotal: 0 }, medium: { wins: 0, total: 0, weightedWins: 0, weightedTotal: 0 } }
  const byCatalyst = { verified: { wins: 0, total: 0 }, unverified: { wins: 0, total: 0 } }
  const byRisk = { highRisk: { wins: 0, total: 0 }, lowRisk: { wins: 0, total: 0 } }
  let totalWins = 0
  let totalReturns = 0
  let trackedCount = 0
  let maxDrawdown = 0
  let recentWins = 0
  let recentTotal = 0

  for (const record of records) {
    // Use day 3 return as the primary metric (if available), fallback to day 1
    const returnVal = record.return_day3 ?? record.return_day1
    if (returnVal == null) continue

    trackedCount++
    const win = returnVal >= 3
    if (win) totalWins++
    totalReturns += returnVal
    if (returnVal < maxDrawdown) maxDrawdown = returnVal

    // Recency weight: picks from last 7 days count 2x
    const pickAge = record.pickDate ? (now - new Date(record.pickDate).getTime()) / (24 * 60 * 60 * 1000) : 30
    const recencyWeight = pickAge <= 7 ? 2 : pickAge <= 14 ? 1.5 : 1
    const isRecent = pickAge <= 7
    if (isRecent) { recentTotal++; if (win) recentWins++ }

    // By setup type
    const setup = record.setupType || 'unknown'
    if (!bySetup[setup]) bySetup[setup] = { wins: 0, total: 0, totalReturn: 0, weightedWins: 0, weightedTotal: 0 }
    bySetup[setup].total++
    bySetup[setup].totalReturn += returnVal
    bySetup[setup].weightedTotal += recencyWeight
    if (win) { bySetup[setup].wins++; bySetup[setup].weightedWins += recencyWeight }

    // By conviction
    const convBucket = record.conviction >= 8 ? 'high' : 'medium'
    byConviction[convBucket].total++
    byConviction[convBucket].weightedTotal += recencyWeight
    if (win) { byConviction[convBucket].wins++; byConviction[convBucket].weightedWins += recencyWeight }

    // By catalyst
    const catBucket = record.catalystVerified ? 'verified' : 'unverified'
    byCatalyst[catBucket].total++
    if (win) byCatalyst[catBucket].wins++

    // By risk score
    const riskBucket = (record.riskScore || 0) >= 7 ? 'highRisk' : 'lowRisk'
    byRisk[riskBucket].total++
    if (win) byRisk[riskBucket].wins++
  }

  const pct = (wins, total) => total > 0 ? Number(((wins / total) * 100).toFixed(1)) : 0
  const avg = (sum, total) => total > 0 ? Number((sum / total).toFixed(2)) : 0
  const wpct = (wWins, wTotal) => wTotal > 0 ? Number(((wWins / wTotal) * 100).toFixed(1)) : 0

  const result = {
    totalPicks: trackedCount,
    overallWinRate: pct(totalWins, trackedCount),
    avgReturn: avg(totalReturns, trackedCount),
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    recentWinRate: pct(recentWins, recentTotal),
    recentTotal,
    bySetup: Object.fromEntries(
      Object.entries(bySetup).map(([setup, data]) => [
        setup,
        {
          winRate: pct(data.wins, data.total),
          weightedWinRate: wpct(data.weightedWins, data.weightedTotal),
          avgReturn: avg(data.totalReturn, data.total),
          total: data.total,
        },
      ])
    ),
    byConviction: {
      high: {
        winRate: pct(byConviction.high.wins, byConviction.high.total),
        weightedWinRate: wpct(byConviction.high.weightedWins, byConviction.high.weightedTotal),
        total: byConviction.high.total,
      },
      medium: {
        winRate: pct(byConviction.medium.wins, byConviction.medium.total),
        weightedWinRate: wpct(byConviction.medium.weightedWins, byConviction.medium.weightedTotal),
        total: byConviction.medium.total,
      },
    },
    byCatalyst: {
      verified: { winRate: pct(byCatalyst.verified.wins, byCatalyst.verified.total), total: byCatalyst.verified.total },
      unverified: { winRate: pct(byCatalyst.unverified.wins, byCatalyst.unverified.total), total: byCatalyst.unverified.total },
    },
    byRisk: {
      highRisk: { winRate: pct(byRisk.highRisk.wins, byRisk.highRisk.total), total: byRisk.highRisk.total },
      lowRisk: { winRate: pct(byRisk.lowRisk.wins, byRisk.lowRisk.total), total: byRisk.lowRisk.total },
    },
  }

  // Cache the computed stats
  if (redis) {
    try { await redis.set(STATS_CACHE_KEY, result, { ex: STATS_CACHE_TTL }) } catch { /* non-critical */ }
  }

  return result
}

/**
 * Format win rate stats as a text block for Claude's system prompt.
 * This is how the feedback loop closes — past performance informs future picks.
 */
export function formatStatsForPrompt(stats) {
  if (!stats || stats.totalPicks === 0) return ''

  const lines = [
    `## Historical Performance (${stats.totalPicks} tracked picks)`,
    `Overall win rate: ${stats.overallWinRate}% | Avg return: ${stats.avgReturn > 0 ? '+' : ''}${stats.avgReturn}% | Max drawdown: ${stats.maxDrawdown}%`,
  ]

  if (stats.recentTotal >= 2) {
    lines.push(`Recent (7 days): ${stats.recentWinRate}% win rate (${stats.recentTotal} picks) ← weight this heavily`)
  }

  lines.push('', 'Win rate by setup type (weighted = recency-adjusted):')

  const sortedSetups = Object.entries(stats.bySetup)
    .filter(([, data]) => data.total >= 2)
    .sort((a, b) => b[1].weightedWinRate - a[1].weightedWinRate)

  for (const [setup, data] of sortedSetups) {
    lines.push(`  ${setup}: ${data.weightedWinRate}% weighted (${data.winRate}% raw, ${data.total} picks, avg ${data.avgReturn > 0 ? '+' : ''}${data.avgReturn}%)`)
  }

  if (stats.byCatalyst.verified.total >= 2 || stats.byCatalyst.unverified.total >= 2) {
    lines.push('')
    lines.push('Catalyst verification impact:')
    if (stats.byCatalyst.verified.total >= 2) lines.push(`  Verified catalyst: ${stats.byCatalyst.verified.winRate}% win rate`)
    if (stats.byCatalyst.unverified.total >= 2) lines.push(`  No verified catalyst: ${stats.byCatalyst.unverified.winRate}% win rate`)
  }

  if (stats.byConviction.high.total >= 2) {
    lines.push('')
    lines.push(`High conviction (8+): ${stats.byConviction.high.weightedWinRate}% weighted (${stats.byConviction.high.winRate}% raw)`)
    lines.push(`Medium conviction (6-7): ${stats.byConviction.medium.weightedWinRate}% weighted (${stats.byConviction.medium.winRate}% raw)`)
  }

  if (stats.byRisk.highRisk.total >= 2) {
    lines.push('')
    lines.push(`High risk picks (contrarian risk ≥7): ${stats.byRisk.highRisk.winRate}% win rate`)
    lines.push(`Low risk picks (contrarian risk <7): ${stats.byRisk.lowRisk.winRate}% win rate`)
  }

  lines.push('')
  lines.push('INSTRUCTIONS: Favor setups with high weighted win rates. If recent performance diverges from overall, trust the recent data. Avoid setups with <30% win rate unless catalyst confidence is very high. IMPORTANT: Prioritize fresh tickers you have NOT picked in the last 2–3 days. Repetition kills alpha — the market already priced in yesterday\'s thesis. Only re-pick a ticker if the catalyst is materially different or stronger today.')

  return lines.join('\n')
}
