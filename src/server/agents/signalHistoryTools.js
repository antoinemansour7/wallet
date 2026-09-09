import { evaluationHistory } from '../research/history.js'
import { HISTORY_LIMIT, HISTORY_RETENTION_SECONDS } from '../research/policy.js'
import { allResearchPicks } from '../research/review.js'

// ─── Signal History Tools ──────────────────────────────────────────────────────
// Functions that let any agent query past picks, track performance,
// and compute win rates. Powers the post-mortem feedback loop.
// ────────────────────────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis'
import { computeLearningStats, EVALUATION_VERSION, RESEARCH_MODEL_VERSION } from '../researchPerformance.js'

const PERFORMANCE_KEY = 'research:performance'
const PERFORMANCE_TTL = HISTORY_RETENTION_SECONDS
const STATS_CACHE_KEY = `research:performance:stats:${RESEARCH_MODEL_VERSION}`
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
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) return

  const returnPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0
  const win = returnPct >= 3 // +3% threshold for a "win"

  const prefix = extras.shadow ? `${PERFORMANCE_KEY}:shadow` : PERFORMANCE_KEY
  const key = `${prefix}:${pickDate}:${extras.candidateId || ticker}`
  const existing = await redis.get(key) || {}

  // Idempotent per checkpoint: a tolerant tracking window may map several
  // calendar days to the same slot — the first recorded price wins.
  if (existing[`return_day${daysHeld}`] != null && (!extras.evaluationVersion || existing.evaluationVersion === extras.evaluationVersion)) return existing

  const updated = {
    // Never mix old calendar-day checkpoints into the session-based record.
    ...(extras.evaluationVersion && existing.evaluationVersion !== extras.evaluationVersion ? {} : existing),
    ticker,
    pickDate,
    entryPrice,
    [`price_day${daysHeld}`]: currentPrice,
    [`return_day${daysHeld}`]: Number(returnPct.toFixed(2)),
    [`win_day${daysHeld}`]: win,
    lastChecked: new Date().toISOString(),
  }

  if (extras.evaluationVersion) {
    Object.assign(updated, {
      evaluationVersion: extras.evaluationVersion,
      modelVersion: extras.modelVersion,
      costBps: extras.costBps,
      candidateId: extras.candidateId, securityId: extras.securityId, issuerId: extras.issuerId,
      strategyFamily: extras.strategyFamily, horizon: extras.declaredHorizon, horizonPolicyVersion: extras.horizonPolicyVersion,
      earliestActionAt: extras.earliestActionAt,
      entryDate: extras.entryDate,
      [`exit_date_day${daysHeld}`]: extras.exitDate,
      [`net_return_day${daysHeld}`]: extras.netReturn,
      [`benchmark_return_day${daysHeld}`]: extras.benchmarkReturn,
      [`excess_return_day${daysHeld}`]: extras.excessReturn,
    })
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

  const entries = await evaluationHistory(redis)
  const records = []
  const seen = new Set()
  for (const history of entries) {
    for (const pick of allResearchPicks(history)) {
      const dateKey = pick.generatedAt?.slice(0, 10) || history.date
      const perfKey = `${PERFORMANCE_KEY}:${dateKey}:${pick.candidateId || pick.ticker}`
      if (seen.has(perfKey)) continue
      seen.add(perfKey)
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
  const shadowIndex = await redis.lrange('research:shadow-index', 0, HISTORY_LIMIT - 1)
  for (const dateKey of new Set(shadowIndex || [])) {
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
    if ((record.horizon || 5) !== 5) continue // Legacy headline remains the attention baseline.
    // Primary metric: next-session open→close (what a real buyer captures).
    // Falls back to legacy close-to-close day 1, then day 3.
    const ocReturn = record.return_day1_oc
    const returnVal = ocReturn ?? record.return_day1 ?? record.return_day3
    if (!Number.isFinite(returnVal)) continue

    // Day-1 open→close wins at +1.5%; legacy multi-day records keep +3%
    const win = ocReturn != null ? returnVal >= 1.5 : returnVal >= 3

    if (!record.shadow && Number.isFinite(record.mfe_day1)) { mfeSum += record.mfe_day1; mfeCount++ }

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
    for (const source of new Set(record.sources || [])) {
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
    learning: computeLearningStats(records, now, { horizon: 5, strategyFamily: 'attention' }),
    learningByHorizon: Object.fromEntries([5, 20, 60].map((horizon) => [horizon, computeLearningStats(records, now, { horizon })])),
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
        if (stats.totalPicks > 0 && stats.learning?.evaluationVersion === EVALUATION_VERSION) return stats
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
  const learning = stats?.learning
  if (!learning?.total) return '## Historical evaluation\nNo comparable completed five-session results for this model yet. Do not infer a proven edge from legacy win rates or a small sample.'
  const lines = [
    `## Historical evaluation (${learning.total} picks across ${learning.distinctDates} dates)`,
    `Hypothetical first-open entry, fifth-session close; ${learning.costBps} bps estimated round-trip costs. USD price returns compared with SPY over the same dates.`,
    `Average net return: ${learning.avgNetReturn.toFixed(2)}%; average excess return: ${learning.avgExcessReturn.toFixed(2)}%. Worst individual return: ${learning.worstReturn.toFixed(2)}% (not portfolio drawdown).`,
    'These observations are not probabilities of profit. Same-day outcomes are correlated. Shadow candidates and legacy/model-mismatched results do not train this ranking.',
  ]
  for (const [label, groups] of [['Setup', learning.bySetup], ['Source', learning.bySource]]) {
    for (const [name, group] of Object.entries(groups || {})) {
      if (group.total < 20 || group.distinctDates < 10) continue
      lines.push(`${label} ${name}: ${group.total} picks / ${group.distinctDates} dates, mean net ${group.avgNetReturn.toFixed(2)}%, excess ${group.avgExcessReturn.toFixed(2)}%.`)
    }
  }
  lines.push('Do not optimize for win rate alone: average gains, losses, costs and benchmark performance all matter. Keep an eligible recent pick when its evidence remains stronger than alternatives.')
  return lines.join('\n')
}
