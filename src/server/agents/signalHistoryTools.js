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
 * Get tickers picked in the last N research days so the next run can enforce
 * freshness instead of relying only on prompt instructions.
 */
export async function getRecentPickedTickers(days = 3) {
  const entries = await getPastPicks(days)
  const tickers = new Set()

  for (const entry of entries) {
    for (const pick of entry.picks || []) {
      if (pick.ticker) tickers.add(String(pick.ticker).toUpperCase())
    }
  }

  return tickers
}

/**
 * Store performance data for a pick after checking its current price.
 * Called by the daily performance tracker cron.
 */
export async function storePickPerformance(pickDate, ticker, entryPrice, currentPrice, daysHeld, extras = {}) {
  const redis = getRedis()
  if (!redis) return

  const returnPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0
  const win = returnPct >= 3 // +3% threshold for a "win"

  const prefix = extras.shadow ? `${PERFORMANCE_KEY}:shadow` : PERFORMANCE_KEY
  const key = `${prefix}:${pickDate}:${ticker}`
  const existing = await redis.get(key) || {}

  // Idempotent per checkpoint: a tolerant tracking window may map several
  // calendar days to the same slot — the first recorded price wins.
  if (existing[`return_day${daysHeld}`] != null) return existing

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

  // Day-1 honesty metrics: what was achievable buying at the next open
  if (daysHeld === 1 && Number.isFinite(extras.day1Open) && extras.day1Open > 0) {
    updated.open_day1 = extras.day1Open
    updated.return_day1_oc = Number((((currentPrice - extras.day1Open) / extras.day1Open) * 100).toFixed(2))
    if (Number.isFinite(extras.day1High)) {
      updated.high_day1 = extras.day1High
      updated.mfe_day1 = Number((((extras.day1High - extras.day1Open) / extras.day1Open) * 100).toFixed(2))
    }
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
          sources: pick.sources || [],
        })
      }
    }
  }

  // Shadow picks (top-of-board candidates never shown to the user) feed the
  // setup/source learning loop with ~3x more outcomes per night.
  const shadowIndex = await redis.lrange('research:shadow-index', 0, 29)
  for (const dateKey of shadowIndex || []) {
    const shadowEntry = await redis.get(`research:shadow:${dateKey}`)
    if (!shadowEntry?.picks) continue
    for (const pick of shadowEntry.picks) {
      const perf = await redis.get(`${PERFORMANCE_KEY}:shadow:${dateKey}:${pick.ticker}`)
      if (perf) {
        records.push({
          ...perf,
          shadow: true,
          setupType: pick.setupType,
          conviction: null,
          catalystVerified: false,
          riskScore: null,
          sources: pick.sources || [],
        })
      }
    }
  }

  return records
}

/**
 * Drop the cached stats so the next research run recomputes them.
 * Called by the performance tracker after it records fresh price checkpoints.
 */
export async function invalidateStatsCache() {
  const redis = getRedis()
  if (!redis) return
  try { await redis.del(STATS_CACHE_KEY) } catch { /* non-critical */ }
}

/**
 * Compute win rate statistics broken down by setup type, conviction level,
 * catalyst verification, signal source, and other dimensions. Pure function
 * over performance records so it can be tested without Redis.
 */
export function computeWinRateStats(records, now = Date.now()) {
  if (records.length === 0) return { totalPicks: 0, stats: null, message: 'No performance data yet' }

  // Aggregate by dimensions
  const bySetup = {}
  const bySource = {}
  const byConviction = { high: { wins: 0, total: 0, weightedWins: 0, weightedTotal: 0 }, medium: { wins: 0, total: 0, weightedWins: 0, weightedTotal: 0 } }
  const byCatalyst = { verified: { wins: 0, total: 0 }, unverified: { wins: 0, total: 0 } }
  const byRisk = { highRisk: { wins: 0, total: 0 }, lowRisk: { wins: 0, total: 0 } }
  let totalWins = 0
  let totalReturns = 0
  let trackedCount = 0
  let maxDrawdown = 0
  let recentWins = 0
  let recentTotal = 0

  let mfeSum = 0
  let mfeCount = 0

  for (const record of records) {
    // Primary metric: next-session open→close (what a real buyer captures).
    // Falls back to legacy close-to-close day 1, then day 3.
    const ocReturn = record.return_day1_oc
    const returnVal = ocReturn ?? record.return_day1 ?? record.return_day3
    if (returnVal == null) continue

    // Day-1 open→close wins at +1.5%; legacy multi-day records keep +3%
    const win = ocReturn != null ? returnVal >= 1.5 : returnVal >= 3

    if (Number.isFinite(record.mfe_day1)) { mfeSum += record.mfe_day1; mfeCount++ }

    const isShadow = Boolean(record.shadow)
    if (!isShadow) {
      trackedCount++
      if (win) totalWins++
      totalReturns += returnVal
      if (returnVal < maxDrawdown) maxDrawdown = returnVal
    }

    // Recency weight: picks from last 7 days count 2x
    const pickAge = record.pickDate ? (now - new Date(record.pickDate).getTime()) / (24 * 60 * 60 * 1000) : 30
    const recencyWeight = pickAge <= 7 ? 2 : pickAge <= 14 ? 1.5 : 1
    const isRecent = pickAge <= 7
    if (isRecent && !isShadow) { recentTotal++; if (win) recentWins++ }

    // By setup type
    const setup = record.setupType || 'unknown'
    if (!bySetup[setup]) bySetup[setup] = { wins: 0, total: 0, totalReturn: 0, weightedWins: 0, weightedTotal: 0 }
    bySetup[setup].total++
    bySetup[setup].totalReturn += returnVal
    bySetup[setup].weightedTotal += recencyWeight
    if (win) { bySetup[setup].wins++; bySetup[setup].weightedWins += recencyWeight }

    // By conviction (real picks only — shadow picks carry no conviction)
    if (!isShadow) {
      const convBucket = record.conviction >= 8 ? 'high' : 'medium'
      byConviction[convBucket].total++
      byConviction[convBucket].weightedTotal += recencyWeight
      if (win) { byConviction[convBucket].wins++; byConviction[convBucket].weightedWins += recencyWeight }

      // By catalyst
      const catBucket = record.catalystVerified ? 'verified' : 'unverified'
      byCatalyst[catBucket].total++
      if (win) byCatalyst[catBucket].wins++
    }

    // By signal source (which X accounts / screeners / discovery feeds
    // actually produce winners — feeds back into pick ranking)
    for (const source of record.sources || []) {
      if (!bySource[source]) bySource[source] = { wins: 0, total: 0, totalReturn: 0, weightedWins: 0, weightedTotal: 0 }
      bySource[source].total++
      bySource[source].totalReturn += returnVal
      bySource[source].weightedTotal += recencyWeight
      if (win) { bySource[source].wins++; bySource[source].weightedWins += recencyWeight }
    }

    // By risk score (real picks only)
    if (!isShadow) {
      const riskBucket = (record.riskScore || 0) >= 7 ? 'highRisk' : 'lowRisk'
      byRisk[riskBucket].total++
      if (win) byRisk[riskBucket].wins++
    }
  }

  const pct = (wins, total) => total > 0 ? Number(((wins / total) * 100).toFixed(1)) : 0
  const avg = (sum, total) => total > 0 ? Number((sum / total).toFixed(2)) : 0
  const wpct = (wWins, wTotal) => wTotal > 0 ? Number(((wWins / wTotal) * 100).toFixed(1)) : 0

  const result = {
    totalPicks: trackedCount,
    overallWinRate: pct(totalWins, trackedCount),
    avgReturn: avg(totalReturns, trackedCount),
    avgIntradayPeak: mfeCount > 0 ? Number((mfeSum / mfeCount).toFixed(2)) : null,
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
    // Only sources with enough samples to mean anything
    bySource: Object.fromEntries(
      Object.entries(bySource)
        .filter(([, data]) => data.total >= 3)
        .map(([source, data]) => [
          source,
          {
            winRate: pct(data.wins, data.total),
            weightedWinRate: wpct(data.weightedWins, data.weightedTotal),
            avgReturn: avg(data.totalReturn, data.total),
            total: data.total,
          },
        ])
    ),
  }

  return result
}

/**
 * Load performance records and compute win rate stats.
 * Results are cached in Redis for 6h; the tracker cron invalidates the cache
 * whenever it records fresh checkpoints.
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
  const result = computeWinRateStats(records)

  // Cache the computed stats
  if (redis && result.totalPicks > 0) {
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
    `## Historical Performance (${stats.totalPicks} tracked picks; win = +1.5% captured by the day-1 open→close checkpoint)`,
    `Overall win rate: ${stats.overallWinRate}% | Avg day-1 open→close return: ${stats.avgReturn > 0 ? '+' : ''}${stats.avgReturn}% | Max drawdown: ${stats.maxDrawdown}%`,
    `(Day-1 is an EARLY read on a 3–5 day hold, not the finish line — a pick that is flat on day 1 can still work by day 3–5. Use it to judge follow-through, not to demand instant payoff.)`,
  ]

  if (stats.avgIntradayPeak != null) {
    lines.push(`Avg intraday peak (open→high day 1): +${stats.avgIntradayPeak}% — a first-day read on how much the move tends to carry, not a one-session ceiling.`)
  }

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

  const sourceEntries = Object.entries(stats.bySource || {})
    .sort((a, b) => b[1].weightedWinRate - a[1].weightedWinRate)
  if (sourceEntries.length >= 2) {
    lines.push('')
    lines.push('Signal source track record (weighted win rate, n≥3):')
    for (const [source, data] of sourceEntries.slice(0, 5)) {
      lines.push(`  ${source}: ${data.weightedWinRate}% (${data.total} picks, avg ${data.avgReturn > 0 ? '+' : ''}${data.avgReturn}%)`)
    }
    const losers = sourceEntries.filter(([, data]) => data.weightedWinRate <= 30)
    if (losers.length > 0) {
      lines.push(`  UNDERPERFORMING sources — discount their signals: ${losers.map(([s]) => s).join(', ')}`)
    }
  }

  lines.push('')
  lines.push('INSTRUCTIONS: Favor setups with high weighted win rates. If recent performance diverges from overall, trust the recent data. Avoid setups with <30% win rate unless catalyst confidence is very high. IMPORTANT: Prioritize fresh tickers you have NOT picked in the last 2–3 days. Repetition kills alpha — the market already priced in yesterday\'s thesis. Only re-pick a ticker if the catalyst is materially different or stronger today.')

  return lines.join('\n')
}
