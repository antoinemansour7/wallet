// ─── Signal History Tools ──────────────────────────────────────────────────────
// Functions that let any agent query past picks, track performance,
// and compute win rates. Powers the post-mortem feedback loop.
// ────────────────────────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis'

const PERFORMANCE_KEY = 'research:performance'
const PERFORMANCE_TTL = 30 * 24 * 60 * 60 // 30 days

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
 * This is the core of the feedback loop — these stats feed back into Claude's prompt.
 */
export async function getWinRateStats() {
  const records = await getAllPerformanceRecords()
  if (records.length === 0) return { totalPicks: 0, stats: null, message: 'No performance data yet' }

  // Aggregate by dimensions
  const bySetup = {}
  const byConviction = { high: { wins: 0, total: 0 }, medium: { wins: 0, total: 0 } }
  const byCatalyst = { verified: { wins: 0, total: 0 }, unverified: { wins: 0, total: 0 } }
  const byRisk = { highRisk: { wins: 0, total: 0 }, lowRisk: { wins: 0, total: 0 } }
  let totalWins = 0
  let totalReturns = 0
  let trackedCount = 0

  for (const record of records) {
    // Use day 3 return as the primary metric (if available), fallback to day 1
    const returnVal = record.return_day3 ?? record.return_day1
    if (returnVal == null) continue

    trackedCount++
    const win = returnVal >= 3
    if (win) totalWins++
    totalReturns += returnVal

    // By setup type
    const setup = record.setupType || 'unknown'
    if (!bySetup[setup]) bySetup[setup] = { wins: 0, total: 0, totalReturn: 0 }
    bySetup[setup].total++
    bySetup[setup].totalReturn += returnVal
    if (win) bySetup[setup].wins++

    // By conviction
    const convBucket = record.conviction >= 8 ? 'high' : 'medium'
    byConviction[convBucket].total++
    if (win) byConviction[convBucket].wins++

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

  return {
    totalPicks: trackedCount,
    overallWinRate: pct(totalWins, trackedCount),
    avgReturn: avg(totalReturns, trackedCount),
    bySetup: Object.fromEntries(
      Object.entries(bySetup).map(([setup, data]) => [
        setup,
        { winRate: pct(data.wins, data.total), avgReturn: avg(data.totalReturn, data.total), total: data.total },
      ])
    ),
    byConviction: {
      high: { winRate: pct(byConviction.high.wins, byConviction.high.total), total: byConviction.high.total },
      medium: { winRate: pct(byConviction.medium.wins, byConviction.medium.total), total: byConviction.medium.total },
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
}

/**
 * Format win rate stats as a text block for Claude's system prompt.
 * This is how the feedback loop closes — past performance informs future picks.
 */
export function formatStatsForPrompt(stats) {
  if (!stats || stats.totalPicks === 0) return ''

  const lines = [
    `## Historical Performance (${stats.totalPicks} tracked picks)`,
    `Overall win rate: ${stats.overallWinRate}% | Avg return: ${stats.avgReturn > 0 ? '+' : ''}${stats.avgReturn}%`,
    '',
    'Win rate by setup type:',
  ]

  for (const [setup, data] of Object.entries(stats.bySetup)) {
    if (data.total >= 2) {
      lines.push(`  ${setup}: ${data.winRate}% win rate (${data.total} picks, avg ${data.avgReturn > 0 ? '+' : ''}${data.avgReturn}%)`)
    }
  }

  if (stats.byCatalyst.verified.total >= 2 || stats.byCatalyst.unverified.total >= 2) {
    lines.push('')
    lines.push('Catalyst verification impact:')
    if (stats.byCatalyst.verified.total >= 2) lines.push(`  Verified catalyst: ${stats.byCatalyst.verified.winRate}% win rate`)
    if (stats.byCatalyst.unverified.total >= 2) lines.push(`  No verified catalyst: ${stats.byCatalyst.unverified.winRate}% win rate`)
  }

  if (stats.byConviction.high.total >= 2) {
    lines.push('')
    lines.push(`High conviction (8+): ${stats.byConviction.high.winRate}% win rate`)
    lines.push(`Medium conviction (6-7): ${stats.byConviction.medium.winRate}% win rate`)
  }

  if (stats.byRisk.highRisk.total >= 2) {
    lines.push('')
    lines.push(`High risk picks (contrarian risk ≥7): ${stats.byRisk.highRisk.winRate}% win rate`)
    lines.push(`Low risk picks (contrarian risk <7): ${stats.byRisk.lowRisk.winRate}% win rate`)
  }

  lines.push('')
  lines.push('Use these stats to calibrate your conviction scores and setup preferences. Favor setups with higher historical win rates.')

  return lines.join('\n')
}
