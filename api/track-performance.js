import { evaluationHistory } from '../src/server/research/history.js'
import { HISTORY_LIMIT } from '../src/server/research/policy.js'
import { allResearchPicks } from '../src/server/research/review.js'
import { loadFoundation } from '../src/server/research/foundation.js'

import { Redis } from '@upstash/redis'
import { storePickPerformance, invalidateStatsCache } from '../src/server/agents/signalHistoryTools.js'
import { sessionCheckpoints, LEGACY_EVALUATION_VERSION } from '../src/server/researchPerformance.js'

/**
 * Map days-held to a tracking checkpoint. Tolerant windows instead of exact
 * matches so one missed cron run doesn't permanently lose a checkpoint —
 * storePickPerformance is idempotent per slot, so the earliest day in the
 * window wins.
 */
export function checkpointSlot(daysHeld) {
  if (daysHeld >= 1 && daysHeld <= 2) return 1
  if (daysHeld >= 3 && daysHeld <= 4) return 3
  if (daysHeld >= 5 && daysHeld <= 7) return 5
  if (daysHeld >= 10 && daysHeld <= 12) return 10
  return null
}

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

/**
 * Pure: find the open/high of the first trading day AFTER pickDate in a set
 * of daily candles ({date, open, high}). Powers the honest day-1 metrics —
 * what a buyer at the next open could actually have captured.
 */
export function firstSessionAfter(candles, pickDate) {
  for (const candle of candles || []) {
    if (candle.date > pickDate && Number.isFinite(candle.open)) {
      return { day1Open: candle.open, day1High: Number.isFinite(candle.high) ? candle.high : null }
    }
  }
  return null
}

async function fetchRecentDailyCandles(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2y`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const data = await res.json()
    const result = data?.chart?.result?.[0]
    const quote = result?.indicators?.quote?.[0]
    return (result?.timestamp || []).map((ts, i) => ({
      timestamp: ts * 1000,
      currency: result?.meta?.currency,
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: quote?.open?.[i],
      high: quote?.high?.[i],
      close: quote?.close?.[i],
    }))
  } catch {
    return []
  }
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

  const startedAt = Date.now()
  const errors = []
  let tracked = 0
  let master = null
  try { master = (await loadFoundation({ redis, refresh: false })).master }
  catch (error) { errors.push({ stage: 'identity', error: error.message }) }

  const histories = await evaluationHistory(redis, startedAt)
  const historyIndex = [...new Set(histories.map((h) => h.date))]
  // One request per symbol per run, reused across dates and shadow records.
  const candlesByTicker = new Map()
  const candlesFor = (ticker) => {
    if (!candlesByTicker.has(ticker)) candlesByTicker.set(ticker, fetchRecentDailyCandles(ticker))
    return candlesByTicker.get(ticker)
  }
  const benchmark = await candlesFor('SPY')

  async function trackPicks(dateKey, picks, generatedAt, { shadow = false } = {}) {
    // Old histories without an issuance timestamp cannot establish a fill.
    if (!generatedAt) return
    for (const pick of picks) {
      if (!pick.ticker) continue
      try {
        // Never fetch a reused ticker as though it were the original security.
        // Renames/delistings need an identity-aware historical price adapter;
        // record the gap explicitly until that adapter is available.
        if (pick.securityId) {
          const matches = master?.resolve({ ticker: pick.ticker }) || []
          if (matches.length !== 1 || matches[0].securityId !== pick.securityId) throw new Error('Historical price identity unavailable for renamed, delisted or reused ticker')
        }
        const candles = await candlesFor(pick.ticker)
        const sameCurrencyBenchmark = candles[0]?.currency === 'USD' ? benchmark : []
        const issuedAt = pick.generatedAt || generatedAt
        const issuedDate = issuedAt?.slice(0, 10) || dateKey
        for (const checkpoint of sessionCheckpoints(candles, issuedAt, startedAt, sameCurrencyBenchmark, undefined, { ...pick, evaluationVersion: pick.evaluationVersion || LEGACY_EVALUATION_VERSION })) {
          await storePickPerformance(issuedDate, pick.ticker, checkpoint.entryPrice, checkpoint.exitPrice, checkpoint.horizon, {
            ...checkpoint, shadow, day1Open: checkpoint.entryPrice,
            candidateId: pick.candidateId, securityId: pick.securityId, issuerId: pick.issuerId,
            strategyFamily: pick.strategyFamily, declaredHorizon: pick.horizon, horizonPolicyVersion: pick.horizonPolicyVersion,
            earliestActionAt: pick.earliestActionAt,
            modelVersion: pick.modelVersion || 'legacy',
          })
          tracked++
        }
      } catch (err) {
        errors.push({ ticker: pick.ticker, date: dateKey, error: err.message })
      }
    }
  }

  for (const history of histories) {
    if (history?.picks) await trackPicks(history.date, allResearchPicks(history), history.generatedAt)
  }
  const shadowDates = [...new Set(await redis.lrange('research:shadow-index', 0, HISTORY_LIMIT - 1) || [])]
  for (const dateKey of shadowDates) {
    const shadowEntry = await redis.get(`research:shadow:${dateKey}`)
    if (shadowEntry?.picks) await trackPicks(dateKey, shadowEntry.picks, shadowEntry.generatedAt, { shadow: true })
  }

  console.log(`[track-performance] tracked ${tracked} pick-price updates`)

  try {
    const { recordRun } = await import('../src/server/runLog.js')
    await recordRun('track-performance', startedAt, { errors, tracked, checkedDates: historyIndex.length })
  } catch (err) {
    console.error('[track-performance] run log failed:', err.message)
  }

  // Fresh outcomes recorded — make the next research run recompute stats
  // instead of serving the 6h-cached version
  if (tracked > 0) {
    try { await invalidateStatsCache() } catch { /* non-critical */ }
  }

  return res.status(200).json({
    tracked,
    checkedDates: historyIndex.length,
    errors,
  })
}
